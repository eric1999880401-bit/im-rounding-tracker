// Prompt builders for all AI callables. Extracted from index.ts (Phase 3 refactor).
import type { DocumentType, ExistingPatientForBatch, PatientBatchImportMode, SourceType } from "./types";
import { sanitizeUserStyleProfile, truncateString } from "./sanitize";

export const planSpecificityPromptRules = [
  "- Plan/task specificity: every follow-up, monitoring, or review line must name the exact lab test, study, drug, or threshold, never a bare organ system or vague verb.",
  "- Examples: write 'f/u BUN/Cr, K' not 'review renal function'; 'f/u Na/K/Ca/Mg/P' not 'monitor electrolytes'; 'f/u CBC (Hb/WBC/Plt)' not 'trend blood counts'; 'f/u AST/ALT/T-bil, INR' not 'review liver function'; 'f/u SpO2/O2 demand, ABG if worsening' not 'monitor respiratory status'; 'f/u fever curve, WBC/CRP, B/C result' not 'follow infection status'.",
  "- Include timing/frequency when the source supports it, e.g. 'f/u CBC q6h', 'repeat K after 40 mEq KCl', 'CXR tomorrow after diuresis'.",
  "- Intervention specificity: treatment lines must be executable, not bare nouns. Preserve drug/fluid name, route, dose/rate, and duration whenever the source provides them.",
  "- If the source names only a vague intervention, stay grounded but concrete by naming the decision parameter and the response check: write 'IVF — clarify type/rate; recheck BP, UO' not 'hydration'; 'replete K/Mg, recheck lytes after repletion' not 'correct electrolytes'; 'titrate analgesics, reassess pain score' not 'optimize pain control'.",
  "- For hypotension, state the concrete response and escalation, e.g. 'IVF bolus per BP/UO response; recheck BP; vasopressor/ICU if MAP <65 despite fluids' instead of 'hydration' or 'BP support'. Do not add such thresholds when the source already sets different targets (e.g. stroke permissive HTN).",
  "- Naming the standard follow-up test for a problem already in the note is required specificity, not invention. Do not invent new treatments, doses, or workups the source does not support.",
];

export function makeBatchImportPrompt(
  rawText: string,
  existingPatients: ExistingPatientForBatch[],
  importMode: PatientBatchImportMode,
  targetPatient?: ExistingPatientForBatch,
) {
  const modeInstructions = importMode === "existingInpatient"
    ? [
        "Import mode: existing inpatient / transfer-in.",
        "- The pasted text may include old admission notes, two-week hospital course, weekly summaries, latest progress, labs, and image reports.",
        "- Prioritize compressed major hospital course, current active problems, last 24h changes, meaningful labs/images, current A/P, tasks, discharge barriers, and disposition.",
        "- admissionSummary should be a transfer-in course summary, not a full admission note. Avoid old resolved daily details unless they explain current risk or pending work.",
        "- Do not frame the patient as a new admission unless the source clearly says this is a new admission today.",
      ]
    : [
        "Import mode: new admissions / mixed list.",
        "- Prioritize why admitted, HPI/brief presentation, key PMH, initial active problems, initial A/P, immediate tasks, and disposition.",
      ];
  const targetInstructions = targetPatient
    ? [
        "",
        "Selected target patient:",
        JSON.stringify(targetPatient, null, 2),
        "",
        "Target-patient update rules:",
        "- The pasted clinical text belongs to this one selected existing patient.",
        "- Return exactly one draft unless the text is unusable.",
        "- Mark status updateCandidate and set matchPatientId to the selected target id.",
        "- Reuse target bed, patientCode, age/sex, attending/service, Dx, PMH, and active problems unless the pasted text clearly updates them.",
        "- Do not create a new patient because the pasted update lacks bed or patient code.",
        "- If the text is only an imaging/lab/consult report, put it in imageText/labText/todayUpdates as appropriate and leave admissionSummary empty unless there is enough course context.",
      ]
    : [];
  return [
    "Task:",
    "Extract a pasted inpatient internal medicine service list, handover, or admission batch into patient review cards.",
    ...modeInstructions,
    ...targetInstructions,
    "",
    "Existing active patients for duplicate matching:",
    JSON.stringify(existingPatients, null, 2),
    "",
    "Extraction rules:",
    "- Split the pasted text into distinct patients. Use bed, patient code, service headers, diagnosis blocks, or admission separators when present.",
    "- Never save or imply auto-save. These are review drafts only.",
    "- If bed or patientCode exactly matches an existing active patient, mark status updateCandidate and set matchPatientId to that existing id. Otherwise status new and matchPatientId empty.",
    "- Reuse existing IM Rounding Tracker fields: bed, patientCode, age, sex, attending, service, diagnosis, PMH, active problems, course, red flags, tasks, discharge/disposition.",
    "- Do not invent missing facts. Use empty strings/arrays when absent. Put uncertainty only for real ambiguity that blocks safe review.",
    ...admissionSummaryStyleBullets.map((line) => `- ${line}`),
    "- admissionSummary: use the structured admission brief format defined above (bed/age-sex lines, PHx:, CC:, PI:, ED Lab:, Image:, ED Course:, Imp: numbered), preserving the line breaks between sections; leave empty if there is no admission/course context.",
    "- oneLiner: one short diagnosis-oriented line.",
    "- todayUpdates: last 24h subjective/overnight/transfer status only.",
    "- vitalSigns: current meaningful V/S and O2 support.",
    "- physicalExam: clinically relevant PE only.",
    "- labText: latest meaningful lab panel/trends/cultures as compact raw lab text. Keep unusual but relevant labs, tumor markers, drug levels, cultures, coagulation, ABG/VBG, etc.",
    "- imageText: latest meaningful imaging/procedure reports as compact raw text.",
    "- underlyingDiseases: PMH/comorbidities only. activeProblems: current inpatient problems only. Do not duplicate PMH into active problems unless it is actively managed now.",
    "- underlyingDiseases must list each disease exactly once: never both the full name and its abbreviation (write 'DM' once, not 'diabetes mellitus' and 'DM'). Prefer standard abbreviations (DM, HTN, HLD, CAD, CKD stage, COPD, AF, old CVA) and keep s/p procedure/date qualifiers with their disease.",
    "- hospitalCourseHighlights: key prior events/treatments/procedures/consult decisions only, not every trivial daily note.",
    "- importantRedFlags: immediate safety or call-threshold issues only. Include concrete trigger/threshold when available.",
    "- tasks: concrete actions only, usually starting with f/u, repeat, call, consult, order, hold, resume, taper, arrange, educate, DC.",
    "- antibioticsProceduresConsults: concise list of Abx/procedures/consults when available.",
    "- dischargePlan and disposition should capture target, barriers, placement, OPD, home O2, meds/certificates, and reminders when available.",
    "",
    "Clinical rule starter pack:",
    "- Stroke/neuro: include neuro deficit, dysphagia/NPO, antiplatelet/anticoag, statin, image pending, rehab/dispo. For acute ischemic stroke without tPA/EVT/ICH/ACS/aortic dissection, do not label BP as urgent uncontrolled if SBP <220 and DBP <120; instead note permissive HTN/BP goal only if useful.",
    "- Infection/sepsis: prioritize fever, suspected source, cultures pending, antibiotics, lactate, shock/hypotension, source control.",
    "- Cardio: prioritize HF volume status/O2/diuresis, ACS chest pain/troponin/ECG, AF/RVR rate/anticoag, BNP when useful.",
    "- Renal: prioritize AKI/CKD, Cr trend, K, I/O, contrast exposure, ACEi/ARB/diuretic cautions, nephro tasks.",
    "- Endocrine: prioritize hypo/hyperglycemia, DKA/HHS signals, insulin changes, glucose monitoring tasks.",
    "- GI/anemia: prioritize active bleeding, Hb trend, transfusion, endoscopy, anticoag/antiplatelet decisions.",
    "- Pulmonary: prioritize O2 requirement, pneumonia Abx, COPD/asthma exacerbation, PE concern, respiratory failure/escalation.",
    "",
    "Quality rules:",
    "- Keep fragments short and clinically useful. Avoid copied full lab panels, copied PMH paragraphs, duplicated diagnoses, and boilerplate.",
    "- Do not write generic filler such as monitor closely, continue current management, clinical correlation, or stable condition unless paired with a concrete trigger or action.",
    ...planSpecificityPromptRules,
    "- Do not repeat patient names, full MRNs, birthdays, phone numbers, addresses, or identifiable details.",
    "",
    "Pasted de-identified text:",
    rawText,
  ].join("\n");
}

export function makePrompt(sourceType: SourceType, rawText: string, patientContext: Record<string, unknown> | undefined) {
  const workflowIntent =
    sourceType === "dailyUpdate"
      ? [
          "Workflow intent:",
          "Today update mode. The clinician may paste mixed V/S, labs, image reports, progress snippets, consults, and nursing notes.",
          "Use the existing context as yesterday's baseline only. Return only new or changed clinically relevant items from the pasted text.",
          "If pasted V/S are stable, include them in objective.vitals only when useful for recordkeeping and keep isImportant false; do not create S/O/A/P from stable V/S.",
          "If labs/images are unchanged or non-actionable, omit A/P and red flags unless they change today's management.",
          "If a new diagnosis, complication, discharge blocker, pending task, or safety issue appears, surface it clearly and mark it important.",
          "",
        ].join("\n")
      : "";
  const clinicalRoutingRules = [
    "Clinical routing rules:",
    "- Think like an inpatient IM resident preparing handover: classify each fact into the one place where it is most useful; do not scatter the same fact across multiple fields.",
    "- First decide CURRENT status from the latest dated progress note, V/S, labs, and active orders. Historical ED/admission events belong in course only unless they are still active today.",
    "- If shock/hypotension occurred on arrival but later BP recovered, off pressor, or latest BP is stable, do not put shock in current V/S, redFlags, tasks, or A/P. If relevant, mention only as 'initial fluid-responsive hypotension/shock, resolved' in course/admission summary.",
    "- Subjective: patient-reported symptoms, new complaints, family concerns, and overnight events only. Do not put labs, imaging, plans, or consultant recommendations here.",
    "- Objective: V/S, bedside sugar, PE, labs, and imaging only. PE is bedside exam only; never put CT/MRI/CXR/EGD/report/impression text in PE. Mark isImportant true only for abnormal, changing, management-relevant, or handoff-relevant data.",
    "- A/P: active problems that change today's management or attending-level understanding. Each problem should have a short label, evidence/course, and concrete plan. Do not create A/P for stable routine values.",
    "- Tasks: actionable work for today or overnight, including f/u labs/images/cultures, consult calls, orders, family communication, discharge paperwork, and reminders.",
    "- Red flags: immediate safety or call-threshold items only, such as unstable V/S, active bleeding, sepsis/shock concern, ACS/stroke concern, worsening oxygenation, dangerous electrolyte/glucose/renal changes, or high-risk pending result.",
    "- Stroke/neuro: for suspected acute ischemic stroke without tPA/EVT/ICH/ACS/aortic dissection context, permissive hypertension is expected; do not call BP urgently uncontrolled unless SBP >=220, DBP >=120, or another strict indication is present.",
    "- Discharge issues: barriers, target date, placement, home oxygen, OPD/follow-up, medications, certificates, or family/social issues affecting discharge.",
    "- Thinking prompts: questions for clinician review only when the text suggests a real diagnostic or management uncertainty; avoid generic textbook prompts.",
    "- Consult/nursing notes often become tasks, red flags, discharge issues, or overnight events; do not promote them to confirmed diagnoses unless supported by the source text or existing context.",
    "- Lab-only or image-only input should usually produce objective findings plus tasks/red flags if needed, not a new admissionSummary or broad SOAP rewrite.",
    "- Prefer short hand-written clinical fragments over polished prose. Examples: 'AKI on CKD, Cr 2.1 from 1.4, hold ACEi, f/u I/O'; 'CXR RLL opacity, cont ceftriaxone, f/u sputum Cx'.",
    "",
  ].join("\n");
  const intakeTargets = [
    "Messy chart extraction target:",
    "- Product target is SOAP-first: pasted data should become one readable physician SOAP note, not many independent cards.",
    "- Compose every SOAP-facing field so it can be printed in this exact order: header context, S, O with V/S/PE/Lab/Image, A/P with '# problem' logic, then Tasks/DC.",
    "- Do not rely on rule labels as clinical judgment. Avoid labels such as Heme/Onc safety, TLS/onc safety, Cardio/HF/rhythm unless the source clearly supports the specific active problem.",
    "- Lab text should preserve source values, dates, arrows/trends, and clinically meaningful abnormalities. Do not let generic lab categories override the pasted lab line.",
    "- First fill clinicalReasoning before composing SOAP-facing text.",
    "- clinicalReasoning.primaryRisk must answer: what would a covering IM physician need to know first, and what could deteriorate or change management today/overnight?",
    "- clinicalReasoning.whyThisMatters must cite short source facts from the pasted text or allowed context; every important conclusion needs a visible basis.",
    "- clinicalReasoning.activeProblemsRanked must rank problems by current clinical risk and management relevance, not by diagnosis order in the chart.",
    "- clinicalReasoning.missingDataNeeded should list key facts needed for safe handoff, e.g. ANC when WBC is very low, culture status, fever curve, O2 requirement, I/O, Cr/K trend, anticoag plan, discharge blocker.",
    "- clinicalReasoning.noiseToIgnore should list stable normals, duplicated history, boilerplate, and stale issues that should not appear in SOAP.",
    "- Treat pasted text as unordered chart fragments; remove duplicated, stale, administrative, and low-signal lines.",
    "- Keep current problems separate from resolved course. Do not revive a resolved ICU/ED problem as today's red flag just because the word appears in history.",
    "- Surface only information that changes rounding, orders, handoff safety, discharge planning, or attending-level understanding.",
    "- Prioritize: why admitted, important PMH, active problems, major prior hospital course, today's meaningful updates, tasks/pending items/red flags, key labs/images/antibiotics/procedures/consults/disposition.",
    "- Keep all output concise and scannable. Use common IM abbreviations when unambiguous.",
    "- Compression target is complete but compressed: preserve active problems, abnormal trends, Abx/procedure/consult status, pending tasks, and DC barriers while shortening wording.",
    "- Prefer common shorthand: w/, w/o, s/p, c/f, r/o, f/u, cont, Abx, Cx, B/C, U/C, Sputum Cx, PNA, UTI, AKI/CKD/ESRD/HD, RF, CHF/HF, AF, CAD, DM, HTN, COPD, SpO2/O2, NC/RA, CXR/CT/MRI/U/S, EGD, OPD.",
    "- Use DC for discharge; reserve d/c only for discontinue. Avoid rare or ambiguous abbreviations.",
    ...admissionSummaryStyleBullets.map((line) => `- ${line}`),
    "- admissionSummary: use the structured admission brief format defined above (bed/age-sex lines, PHx:, CC:, PI:, ED Lab:, Image:, ED Course:, Imp: numbered), preserving the line breaks between sections; leave empty if there is no admission/course context.",
    "- isbarHandoff: concise SBAR with headings exactly Situation, Background, Assessment, Recommendation. Include red flags, pending tasks, contingency/call parameters, and disposition. Leave empty only if there is too little patient context.",
    "- Remove boilerplate and generic phrases like monitor closely, continue current management, clinical correlation, and stable condition unless tied to a concrete trigger, action, or call threshold.",
    ...planSpecificityPromptRules,
    "- For vitals/lab/image-only source types, do not fabricate admissionSummary or isbarHandoff from isolated data; leave those fields empty unless the pasted text includes enough broader context.",
    "",
  ].join("\n");

  return [
    "Source type:",
    sourceType,
    "",
    workflowIntent,
    clinicalRoutingRules,
    intakeTargets,
    "Allowed patient context, if provided:",
    JSON.stringify(patientContext ?? {}, null, 2),
    "",
    "De-identified clinical text:",
    rawText,
  ].join("\n");
}

export function documentTypeLabel(documentType: DocumentType) {
  const labels: Record<DocumentType, string> = {
    admissionNote: "Admission note",
    admissionSummary: "Admission summary for quick attending rounds",
    dischargeHospitalCourse: "Discharge hospital course",
    weeklySummary: "Weekly progress summary",
    isbar: "SBAR handoff note",
  };
  return labels[documentType];
}

export const admissionSummaryZh = {
  because: "\u56e0",
  admitted: "\u4f4f\u9662",
  background: "\u80cc\u666f",
  arrivalOrTransfer: "\u5230\u9662/\u8f49\u5165\u6642",
  through: "\u7d93",
  after: "\u5f8c",
  nowFocus: "\u76ee\u524d\u91cd\u9ede",
  todayPending: "\u4eca\u65e5\u5f85",
};

export const admissionSummaryStyleBullets = [
  "Admission brief format: a structured English case brief with labeled sections, each label starting its own line, in exactly this order: age+sex line (e.g. '90F'); 'PHx:'; 'CC:'; 'PI:'; 'ED Lab:' (or 'Lab [date]:' for non-ED data); 'Image:'; 'ED Course:' when ED events/resuscitation/empiric treatment exist; 'Imp:'. Do not add bed/room as a brief line because the app header already shows it. Omit Plan unless the user explicitly asks for an initial plan.",
  "English only with standard clinician Latin shorthand allowed (c for with, s/p, r/o, f/u). No Chinese connectives, no headings other than the section labels above.",
  "PHx: one comma-separated line of comorbidities in abbreviations (T2DM c prior DKA, prior UTI, pAF, dementia). Never list both a full name and its abbreviation.",
  "CC: the acute presenting complaint with duration ('fever up to 38.8°C x 1 d'), not an incidental finding or the admission-sentence narrative.",
  "PI: 3-6 short lines telling the story: onset/duration ('Fever x 1 d + vomiting since tonight.'), the key local finding with pertinent negatives ('Lt thigh redness/swelling x several days, no trauma, no obvious wound, no local tenderness → favor cellulitis.'), and other relevant symptoms/negatives ('D x2 after ED arrival. No oliguria. Abd soft, no guarding.'). Inline clinical judgment with '→ favor [dx]' is encouraged when the source supports it.",
  "ED Lab: compact panels without units, k-suffix for counts, one theme per line (CBC/diff; chem/glucose; ketone/gas; lactate trend; UA; stool). Show trends and verdicts inline with '→': 'VBG pH 7.42 → 7.38 → no DKA', 'Lactate 26.9 → 20.6'. Include only labs present in the source.",
  "Image: one line per study, 'CXR: mild ↑ Rt infiltrate, similar to [date] film' style; keep sizes/locations/comparisons when present.",
  "ED Course: hemodynamic events, bedside findings, resuscitation response, and empiric treatment started: 'BP down to 84/45. Bedside echo: IVC ~0.5 cm c >50% variation → suspect volume depletion.' / 's/p LR hydration. Started IV Curam + clindamycin.'",
  "Imp: a NUMBERED problem list ranked by acuity; each line is problem + short qualifier/judgment: '1. Fever/sepsis, likely Lt thigh cellulitis' / '2. Hypotension, favor hypovolemia-related, lactate improved after hydration' / '5. T2DM, no DKA this time'. Include relevant pertinent-negative problems ('no DKA this time').",
  "Do not use markdown syntax, asterisks for bold, or app color markup such as [[yellow:...]] in the admission brief. The saved text must be plain clinical text.",
  "Every value/date/finding must come from the source. If a section has no source data, omit the section and its label entirely.",
  "Do not add isolation reminders, per-shift tasks, assessment paragraphs, or instruction wording such as 'partially improved but still unsafe'. Never copy phrases from these instructions into the brief.",
  "If a 1-min ultra-short brief is explicitly requested, keep only the age/sex line, PHx, CC, a 1-2 line PI, one key lab line with its '→' verdict, and a shortened numbered Imp.",
  "Example shape (fake data; follow the format and density exactly):\n90F\nPHx: T2DM c prior DKA, prior UTI, volume depletion, pAF, dementia\nCC: fever up to 38.8°C x 1 d\n\nPI:\nFever x 1 d + vomiting since tonight.\nLt thigh redness/swelling x several days, no trauma, no obvious wound, no local tenderness → favor cellulitis.\nD x2 after ED arrival. No oliguria. Abd soft, no guarding.\n\nED Lab:\nWBC 9.6k, Neu 93.5%\nBUN/Cr 33/0.63, Glu 169\nSerum ketone 0.5, VBG pH 7.42 → 7.38 → no DKA\nLactate 26.9 → 20.6 mg/dL\nUA: WBC 26/HPF, RBC 18/HPF, LE +/-, nitrite (-)\nStool: WBC/RBC/OB all (-)\n\nImage:\nCXR: mild ↑ Rt infiltrate, similar to 2026/03 film\nKUB: moderate fecal components\n\nED Course:\nBP down to 84/45. Bedside echo: IVC ~0.5 cm c >50% variation → suspect volume depletion component.\ns/p LR hydration. Started IV Curam + clindamycin.\n\nImp:\n1. Fever/sepsis, likely Lt thigh cellulitis\n2. Hypotension, favor hypovolemia-related, lactate improved after hydration\n3. Pyuria/hematuria, r/o UTI\n4. Diarrhea, stool exam negative; r/o infectious gastroenteritis\n5. T2DM, no DKA this time",
];

export function documentInstructions(documentType: DocumentType) {
  const shared = [
    "First fill clinicalReasoning before composing document sections.",
    "clinicalReasoning.primaryRisk must state what a covering IM physician needs to know first, including partially improved but still unsafe states.",
    "clinicalReasoning.activeProblemsRanked must rank by current clinical risk and management relevance, not by the order of source notes.",
    "clinicalReasoning.whyThisMatters must cite short source facts and implications so the clinician can independently review the basis.",
    "clinicalReasoning.noiseToIgnore should name stable normals, duplicated history, and boilerplate that should not enter the final note.",
    "Final document text must be a concise projection of clinicalReasoning, not generic AI prose.",
    "Use concise inpatient IM style with common unambiguous medical abbreviations.",
    "Every follow-up or monitoring statement must name the exact test, study, or parameter: write 'f/u BUN/Cr, K' instead of 'review renal function', 'f/u CBC (Hb/Plt)' instead of 'trend blood counts', 'f/u AST/ALT/T-bil, INR' instead of 'review liver function'.",
    "Do not invent missing data; mark absent or unclear details in uncertainty.",
    "Preserve dates, lab values, units, medication names, image findings, and pending items exactly when available.",
    "Use de-identified content only; do not repeat names, full MRNs, IDs, birthday, phone, address, or identifiable image details.",
    "Do not use bullet lists unless the requested document type is SBAR.",
  ];

  const byType: Record<DocumentType, string[]> = {
    admissionNote: [
      "Return exactly two sections: C.C and PI.",
      "C.C must be one short paragraph, not a list.",
      "PI must be a clinical case-history paragraph, not bullet points.",
      "Do not create PMH, Baseline, V/S, PE, Lab, Image, Assessment, Plan, Early course, or Pending sections.",
      "If PMH, V/S, lab, image, consult, or nursing data are clinically relevant to the admission story, weave them into the PI paragraph.",
      "Use conciseSummary as a one-sentence admission summary.",
    ],
    admissionSummary: [
      ...admissionSummaryStyleBullets,
      "Put the complete structured brief in ONE section with heading 'Admission Brief', preserving the line breaks between section labels exactly as in the example.",
      "Use conciseSummary for a single one-liner only (age/sex + key PMH + working Dx), not the whole brief.",
      "Exclude trivial daily stable updates unless they affect management, safety, discharge, or handoff.",
    ],
    dischargeHospitalCourse: [
      "Return exactly one section with heading Hospital Course.",
      "Write one hospital-course paragraph only, not bullet points and not problem-by-problem headings.",
      "Start the paragraph exactly with: After admission,",
      "Be specific: preserve source-grounded dates, key lab values/trends, culture results, oxygen status, image/procedure names, antibiotics, consultations, complications, and treatment response when available.",
      "End the paragraph with: under relative stable condition, the patient was discharged w/ [disposition/follow-up/DC meds/OPD plan if available].",
      "Do not write separate discharge medication, follow-up appointment, assessment/plan, or problem headings unless the detail is essential inside the course paragraph.",
      "Keep followUpItems empty unless an item is critical to mention separately.",
    ],
    weeklySummary: [
      "Return one section with heading Weekly Summary.",
      "Write a usable weekly hospital-course/interim summary for the next covering physician, not a generic paragraph.",
      "Paragraph format only: no bullet lists, numbered lists, problem headings, or separate A/P section.",
      "Use 5-8 short source-grounded clinical sentences in this order: 1) why admitted/why still here, 2) this week's trajectory with dated milestones and exact values, 3) current active problems/status, 4) pending work, contingencies, and disposition barrier.",
      "Preserve concrete anchors when available: dates, VS/O2 trend, WBC/Hb/Cr/K/LFT/INR/CRP/lactate trend, culture results, Abx name/day, procedure/date/result, image study/date/key finding, consult recommendation, and DC barrier.",
      "Problem content should be synthesized by active issue and trajectory; do not copy the daily A/P forward or list every task.",
      "Use concise inpatient IM style with common abbreviations. Avoid generic phrases such as current focus, monitor closely, continue management, and needs clinical review unless paired with a specific action or missing data.",
      "Exclude stable inactive problems, routine normals, copied full lab panels, and completed tasks unless they explain current decisions.",
      "Weave pending labs/images/consults, discharge barriers, target disposition, follow-up needs, and if/then contingencies into the paragraph.",
      "Use followUpItems only for critical pending items not already captured in the paragraph.",
    ],
    isbar: [
      "Return exactly four sections in this exact order: Situation, Background, Assessment, Recommendation.",
      "Follow the standard SBAR pattern: current situation, pertinent background, clinical assessment, and requested/recommended action.",
      "Target total length: 8-12 short clinical lines, under 180 words when possible.",
      "Situation: lead with clinicalReasoning.primaryRisk. Include bed/code if available, age/sex, attending/service if relevant, current working Dx, why handoff is needed now, and current status; never use name, full MRN, birthday, phone, address, or ID.",
      "Background: include only high-yield PMH, important prior hospital events, key procedures, antibiotics, consults, and major image/lab findings that matter for handoff.",
      "Assessment: use ranked active problems from clinicalReasoning with evidence and severity; avoid vague labels without source facts.",
      "Recommendation: include today/overnight actions, pending labs/images/consults, contingency plans, call thresholds, discharge/disposition plan, and missing data from clinicalReasoning.",
      "Recommendation must not paste a medication order list. Convert order information into actions such as clarify Abx duration/Cx, hold/resume anticoagulation plan, glucose parameters, I/O or renal follow-up.",
      "Do not include routine normal data, duplicated diagnosis paragraphs, generic legal disclaimers, empty sections, long admission-note prose, copied full lab panels, or low-signal stable daily updates.",
      "Do not use generic filler such as monitor closely unless paired with a specific trigger, call threshold, or action.",
      "Put pending tasks and uncertainty inside Recommendation when possible; use followUpItems or uncertainty only if a critical item does not fit in the four sections.",
    ],
  };

  return [...shared, ...byType[documentType]].join(" ");
}

export function makeDocumentPrompt(params: {
  documentType: DocumentType;
  rawText: string;
  dateFrom: string;
  dateTo: string;
  patientContext: Record<string, unknown>;
  dailyNotes: Array<Record<string, unknown>>;
}) {
  return [
    "Document type:",
    documentTypeLabel(params.documentType),
    "",
    "Date range:",
    JSON.stringify({ from: params.dateFrom, to: params.dateTo }),
    "",
    "Allowed de-identified patient context:",
    JSON.stringify(params.patientContext, null, 2),
    "",
    "SOAP notes in requested range:",
    JSON.stringify(params.dailyNotes, null, 2),
    "",
    "Additional de-identified pasted text:",
    params.rawText || "(none)",
  ].join("\n");
}

export function makeRoundSoapPrompt(params: {
  sourceType: SourceType;
  workflowMode: string;
  selectedDate: string;
  rawText: string;
  currentSoapBaseline: string;
  patientContext: Record<string, unknown>;
  userStyleProfile?: ReturnType<typeof sanitizeUserStyleProfile>;
  dailyNotes: Array<Record<string, unknown>>;
}) {
  const modeInstruction =
    params.workflowMode === "dailyUpdate"
      ? [
          "Workflow mode: Daily update.",
          "- Treat the current reviewed SOAP baseline as already clinician-reviewed and generally correct.",
          "- Do not rewrite the whole note. Add or revise only new clinically meaningful V/S, labs, images, symptoms, course, A/P details, tasks, orders, and DC blockers from pasted fields.",
          "- If the pasted source contains only V/S, update only O/V/S unless those vitals create a new safety issue.",
          "- If the pasted source contains only Lab, update only O/Lab and, when needed, append a short status/plan phrase under the matching existing A/P problem title. Do not rebuild the whole A/P.",
          "- If the pasted source contains only Image, update only O/Image with study/date/key finding. Never move image reports into PE.",
          "- If the pasted source contains only orders/medications, update only Tasks/Order summaries. Do not create new A/P problems from orders alone.",
          "- Exception: if the order is a concrete antibiotic/culture update and an infection A/P already exists or is clearly supported, reflect drug/route/dose/frequency/start date/day count/indication/culture follow-up under the matching infection A/P.",
          "- If pasted text says a task/result is done or resolved, remove or update that task in the SOAP instead of carrying it forward.",
          "- Do not change diagnosis/PMH/A/P structure unless today's pasted data clearly changes the clinical problem list.",
          "- Preserve existing A/P problem titles by default. Only add a new problem if today's pasted text clearly supports a new active problem.",
          "- Preserve the baseline user's A/P title wording, shorthand, and line style. If a baseline title is '# PNA / bacteremia', do not rename it to a generic textbook title unless the pasted source proves the diagnosis changed.",
          "- Each changed line must be traceable to the pasted source. Do not add broad management boilerplate, generic differential diagnoses, or normal-stable chronic problems just because they exist in context.",
          "- It is acceptable for Daily update output to be nearly identical to baseline with only one O/Lab, O/V/S, task, order, or matching A/P line changed.",
          "- If pasted data is malformed, too narrow, or unrelated, preserve baseline sections and add a short warning instead of writing a full replacement note.",
          "- Do not add a separate 'clinical improvement' A/P problem. Merge improvement, response to Abx/procedure, culture updates, and lab trends under the matching existing problem.",
        ].join("\n")
      : params.workflowMode === "newSoap"
        ? [
            "Workflow mode: New SOAP.",
            "- This is the first inpatient SOAP after admission. Use admission context plus pasted V/S/labs/images/course to write a complete first SOAP.",
            "- Build a fresh A/P from active admission problems and today's objective data.",
            "- Keep admission history concise; do not copy the full admission note.",
          ].join("\n")
        : [
            "Workflow mode: Transfer / handoff SOAP.",
            "- This is the receiving team's first SOAP after transfer or handoff.",
            "- Synthesize admission context, prior SOAP/handoff, course, consults, labs, images, procedures, antibiotics, and current status into one usable SOAP.",
            "- Distinguish resolved prior events from active receiving-team problems.",
          ].join("\n");

  return [
    "Task:",
    "Update one clinician-reviewed inpatient IM SOAP note from the pasted de-identified source text.",
    "",
    "Output format requirements:",
    "- Follow stable SOAP contract ai-soap-v2. The app will validate and normalize this exact structure before display.",
    "- Return SOAP text only inside JSON soapText.",
    "- Use this exact section order and headings: optional header context lines, S:, O:, A/P:, Tasks:, DC:. Medication/order items still belong under Tasks: but should start with 'Order:' or a clear medication/order phrase so the editor can display them in the medication-order section.",
    "- Header should include bed/code/age-sex if known, Dx, PMH if high-yield, attending/date if useful.",
    "- The medication/order display section is called \u85e5\u56d1. Use 'Order:' for order-related lines; do not place medication summaries inside unrelated tasks.",
    "- O must use fixed order V/S, PE, Lab, Image. Put imaging reports under Image, never PE.",
    "- In O/Image, always preserve the study name/date/key finding when pasted imaging exists, e.g. 'Image: CXR 5/22 ...' or 'Image: CT A/P 5/21 ...'.",
    "- A/P must use '# problem' blocks, 3-5 active problems maximum.",
    "- Do not mechanically preserve source headings or split by every symptom/test/procedure. Choose the dominant active clinical problems the rounding physician would present.",
    "- Each A/P problem may have only 1-2 bullets. Merge status, key evidence, and concrete plan into compact clinician lines.",
    "- Do not split one clinical problem into separate A/P lines for symptom, procedure, image, current status, and drug; combine them under the same problem.",
    "- For respiratory failure, do not create separate A/P problems for MV/intubation/extubation/prone positioning/O2 weaning/CXR status. Merge these into one respiratory problem with current status and plan.",
    "- Do not repeat the same antibiotic, oxygen, culture, procedure, or monitoring sentence under multiple A/P problems. Put each treatment under the single matching problem only.",
    "- If O/Lab contains a new critical/high-risk value such as severe Na/K change, AKI/Cr rise, marked LFT/INR elevation, or Hb drop, it must appear as its own A/P problem or be explicitly merged under the matching renal/lyte, liver/coag, or anemia problem.",
    "- If antibiotics are present, the matching A/P problem must preserve drug name plus route/dose/frequency when available, start date/day count when available, indication/source, and culture follow-up/de-escalation plan. Example: '# MRSA/Enterococcus bacteremia' then '- Teicoplanin 400 mg IV qd 5/13- (D3) for B/C MRSA/Enterococcus; f/u B/C clearance/susceptibility, define duration/source.'",
    "- When compressing, do not omit active organ dysfunction or explanatory complications. Preserve supported elevated LFT/transaminitis/hyperbilirubinemia/coagulopathy, pleural effusion/chylothorax/hypoxemic RF, AKI/Cr change, infection/sepsis, bleeding/anemia, thrombus, or active cancer-treatment complications.",
    "- If a problem is supported by objective data, name it clinically instead of hiding it inside a vague symptom label. Example: write 'Malignant pleural effusion/chylothorax, RF improving' rather than only 'Dyspnea improving'.",
    "- Use common clear clinician abbreviations when they save space: w/, w/o, s/p, c/f, r/o, f/u, cont, Abx, Cx, B/C, U/C, Sputum Cx, PNA, UTI, AKI/CKD/ESRD/HD, RF, CHF/HF, AF, CAD, DM, HTN, COPD, SpO2/O2, NC/RA, CXR/CT/MRI/U/S, EGD, TTE, OPD.",
    "- Use DC for discharge; reserve d/c only for discontinue. Avoid rare or ambiguous abbreviations.",
    "- Compression means tighter wording, not omission: keep active problems, key abnormal trends, Abx/procedure/consult status, tasks, and DC barriers.",
    "- Tasks must be 2-5 maximum and only actionable/timed/pending items.",
    "- DC only if disposition, discharge blockers, OPD, meds, certificates, or placement are relevant.",
    "- The whole SOAP should be short enough for a rounding print list. Prefer one defensible short phrase over many low-value details.",
    "- Ignore text explicitly labeled as old duplicate, copy-noise, random noise, or 'ignore'. Do not carry that wording into SOAP.",
    "- Keep language concise, physician-style, and defensible. No rule labels, no dashboard tags, no code-like parser labels.",
    "- Do not write generic tasks such as monitor closely, review VTE risk, trend TLS labs unless the source supports the exact issue.",
    ...planSpecificityPromptRules,
    "",
    "User-calibrated SOAP style, learned from this user's reviewed edits:",
    "- Never create a generic '# Infection / Abx' or medication-dump A/P problem, and never paste raw HIS order lines (e.g. 'Acyclovir(針劑) 250mg/Vial 2 IVD Q8H 2026/07/02 2026/07/07') into A/P. Convert orders to clinician shorthand like 'acyclovir 250 mg q8h (7/2-)'. Each drug appears under exactly one problem.",
    "- A/P titles are short diagnosis labels: write '# Suspected disseminated zoster/varicella', not '# Suspected disseminated zoster/varicella, cutaneous lesions w/ pain/itching'. Symptom/course details belong in bullets.",
    "- Drug lines: name + dose + frequency + (start date-). Omit obvious route, and omit the planned stop date unless a duration/de-escalation decision is due.",
    "- Dates inside the SOAP body use MM-DD without the year (07-01), unless the year differs from the current admission.",
    "- Imaging lines keep only the actionable or changed finding: 'CXR 07-01 suspected mild L pleural effusion'. Drop chronic descriptors like tortuous aorta or cardiomegaly unless they change management.",
    "- Stable chronic problems are one short line each: '# HTN, stable' + 'cont [drug]'. No routine 'f/u BP', 'assess mentation/fall risk' boilerplate. A bare problem title with no bullet (e.g. '# Dementia') is acceptable for stable background problems.",
    "- S: 1-3 terse bullets; do not restate lesion locations or exam details that already live in PE.",
    "- Tasks are true to-dos or pending decisions only, 2-4 lines. Standing per-shift monitoring ('f/u rash extent each shift', routine 'f/u SpO2') is nursing routine, not a task. Write contingencies as 'repeat CXR if dyspnea or hypoxemia'.",
    "- DC is exactly one line. When discharge prep is pending, use the checklist form 'Meds □ / OPD □ / Cert □'. Never restate the same pending items in multiple phrasings.",
    "- Preserve exact lab values, dates, antibiotics, cultures, image study names/dates, procedures, consults, and pending items.",
    "- If lab parser/category would conflict with pasted lab line, trust pasted text and warn instead of rewriting values.",
    "- If source says shock/hypotension resolved or latest BP stable, do not create active shock red flag/A/P.",
    "- Red/high-risk facts can be marked with a leading ! in soapText; important therapies/pending items can be left as normal text.",
    "- If user style profile is provided, match the user's writing style: wording density, shorthand habit, A/P organization, section order, and task phrasing.",
    "- Treat styleSummary and preferredTerms as strong voice guidance: imitate the reviewed SOAP style and abbreviations when clinically safe, instead of defaulting to generic textbook prose.",
    "- If currentSoapBaseline exists, preserve its A/P title style, term choices, terse wording, and task phrasing unless the pasted source clearly requires a change.",
    "- Treat typical A/P problem count and line limit only as weak density hints, not as targets. Clinical correctness and the user's reviewed baseline style matter more than exact numbers.",
    "",
    modeInstruction,
    "",
    "Selected date:",
    params.selectedDate || "(not provided)",
    "",
    "Source type:",
    params.sourceType,
    "",
    "Workflow mode:",
    params.workflowMode,
    "",
    "Allowed patient context:",
    JSON.stringify(params.patientContext, null, 2),
    "",
    "User style profile, abstract only; do not infer patient facts from it:",
    JSON.stringify(params.userStyleProfile ?? {}, null, 2),
    "",
    "Recent saved daily notes, newest last or selected by date when available:",
    JSON.stringify(params.dailyNotes, null, 2),
    "",
    "Current reviewed SOAP baseline to update:",
    params.currentSoapBaseline || "(none)",
    "",
    "Pasted de-identified source text:",
    params.rawText,
  ].join("\n");
}
