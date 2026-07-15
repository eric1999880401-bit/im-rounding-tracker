import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "error",
  optimizeDeps: { noDiscovery: true },
  root: process.cwd(),
  server: { middlewareMode: true },
});

const { emptyDailyNote, emptyPatient, nowIso } = await server.ssrLoadModule("/src/utils.ts");
const {
  formatSoapDraft,
  getCanonicalSoapText,
  parseSoapText,
  patientToSoapDraft,
  soapTextToPatientPatch,
} = await server.ssrLoadModule("/src/soapDraft.ts");
const {
  formatMedicationOrderLinesForDisplay,
  parseMedicationOrders,
  summarizeMedicationOrders,
} = await server.ssrLoadModule("/src/medicationOrderParser.ts");
const { guardRoundSoapDelta } = await server.ssrLoadModule("/src/soapDeltaGuardrails.ts");
const { classifyClinicalLine } = await server.ssrLoadModule("/src/clinicalLineClassifier.ts");
const {
  buildUserAiStyleProfile,
  isDcSoapLineVisible,
  isLayoutSectionVisible,
  isObjectiveSoapLineVisible,
  isOrderSoapLine,
  isTaskSoapLineVisible,
  normalizeRoundingLayoutPreferences,
  visibleSectionsForPreset,
} = await server.ssrLoadModule("/src/userPreferences.ts");
const { isComplexPrintDraft, selectPriorityPrintItems } = await server.ssrLoadModule("/src/printPriority.ts");

const failures = [];

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertIncludes(value, pattern, label) {
  if (!pattern.test(value)) fail(`Expected ${label}: ${pattern}\n${value}`);
}

function assertNotIncludes(value, pattern, label) {
  if (pattern.test(value)) fail(`Unexpected ${label}: ${pattern}\n${value}`);
}

function makePatient(overrides) {
  return {
    ...emptyPatient(),
    id: overrides.id,
    bed: overrides.bed,
    patientCode: overrides.patientCode,
    age: overrides.age,
    sex: overrides.sex,
    attending: "Dr. Lin",
    teamOrService: "Team A",
    status: "active",
    ...overrides,
  };
}

function reviewedNote(date, soapText) {
  const now = nowIso();
  return {
    ...emptyDailyNote(date),
    soapText: soapText.trim(),
    soapStatus: "reviewed",
    soapUpdatedAt: now,
    soapVersion: 1,
    updatedAt: now,
  };
}

function saveReviewedSoap(patient, notes, date, soapText) {
  const patch = soapTextToPatientPatch(soapText, patient, date);
  const nextNote = {
    ...emptyDailyNote(date),
    ...patch.dailyNotePatch,
    soapText: soapText.trim(),
    soapStatus: "reviewed",
    soapUpdatedAt: nowIso(),
    soapVersion: 1,
  };
  return {
    patient: patch.patient,
    notes: [...notes.filter((note) => note.date !== date), nextNote].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function makeDefaultLayout(overrides = {}) {
  return normalizeRoundingLayoutPreferences({
    preset: "compactSoap",
    visibleSections: { ...visibleSectionsForPreset("compactSoap"), ...overrides.visibleSections },
    orderDisplayMode: "summary",
    apDisplayMode: "separate",
    printDensity: "normal",
    boardDensity: "compact",
    ...overrides,
  });
}

function surfaceSnapshot(patient, notes, date, layout = makeDefaultLayout()) {
  const canonical = getCanonicalSoapText(patient, notes, date);
  const draft = parseSoapText(canonical.text);
  const detailsText = formatSoapDraft(draft);
  const boardDraft = patientToSoapDraft(patient, notes, date);
  const boardText = formatSoapDraft(boardDraft);
  const visibleObjective = draft.oLines.filter((line) => isObjectiveSoapLineVisible(line, layout));
  const visibleOrderLines = isLayoutSectionVisible(layout, "orders")
    ? draft.taskLines.filter(isOrderSoapLine)
    : [];
  const visibleTaskLines = isLayoutSectionVisible(layout, "tasks")
    ? draft.taskLines.filter((line) => !isOrderSoapLine(line) && isTaskSoapLineVisible(line, layout))
    : [];
  const visibleDcLines = draft.dcLines.filter((line) => isDcSoapLineVisible(line, layout));
  const orderDisplay = formatMedicationOrderLinesForDisplay(visibleOrderLines, layout.orderDisplayMode, 6);
  const printApLabels = draft.apProblems.flatMap((problem) => [problem.title, ...problem.lines]).map((line) =>
    classifyClinicalLine(line, { fallbackKind: "ap", lockKind: true }).label,
  );
  const imageLines = draft.oLines.filter((line) => /^Image:/i.test(line)).map((line) => line.replace(/^Image:\s*/i, ""));
  const apPrintLines = draft.apProblems.map((problem) => [problem.title, ...problem.lines].filter(Boolean).join(": "));
  const taskPrintLines = [...orderDisplay, ...visibleTaskLines, ...visibleDcLines.map((line) => (/^Prep:/i.test(line) ? line : `DC: ${line}`))];
  const printPriorityText = [
    ...selectPriorityPrintItems(visibleObjective, { fallbackKind: "other", maxItems: 5, maxChars: 112 }),
    ...selectPriorityPrintItems(imageLines, { fallbackKind: "image", maxItems: 3, maxChars: 112 }),
    ...selectPriorityPrintItems(apPrintLines, { fallbackKind: "ap", maxItems: 5, maxChars: 136 }),
    ...selectPriorityPrintItems(taskPrintLines, { fallbackKind: "task", maxItems: 8, maxChars: 112 }),
  ].map((item) => item.text).join("\n");

  return {
    canonical,
    draft,
    detailsText,
    boardText,
    visibleObjective,
    visibleTaskLines,
    visibleDcLines,
    visibleOrderLines,
    orderDisplay,
    printApLabels,
    isComplexPrint: isComplexPrintDraft(draft),
    printPriorityText,
  };
}

function assertCanonicalSurfaces(snapshot, label) {
  assert(snapshot.canonical.source === "selected" || snapshot.canonical.source === "latest", `${label}: canonical SOAP should come from reviewed dailyNote.soapText`);
  assert(snapshot.detailsText.includes("A/P:"), `${label}: Details preview lost A/P`);
  assert(snapshot.boardText.includes("A/P:"), `${label}: Board preview lost A/P`);
  assert(snapshot.printApLabels.length > 0 && snapshot.printApLabels.every((value) => value === "A/P"), `${label}: Print A/P labels were not locked: ${snapshot.printApLabels.join(", ")}`);
}

function assertCompactAp(draft, label) {
  assert(draft.apProblems.length >= 2 && draft.apProblems.length <= 5, `${label}: A/P should be 2-5 real active problems, got ${draft.apProblems.length}`);
  draft.apProblems.forEach((problem) => {
    assert(problem.title.length <= 90, `${label}: A/P title too long: ${problem.title}`);
    assert(problem.lines.length <= 2, `${label}: A/P problem has too many lines: ${problem.title}`);
    assertNotIncludes(`${problem.title}\n${problem.lines.join("\n")}`, /\b(monitor closely|review VTE\/bleed risk|generic|rule label)\b/i, `${label}: generic A/P language`);
  });
}

function buildStyleProfile(patient, seedSoapText) {
  const seedNote = reviewedNote("2026-04-30", seedSoapText);
  const profile = buildUserAiStyleProfile([patient], { [patient.id]: [seedNote] });
  assert(profile.styleSummary.some((line) => /clinician|A\/P|Common terms/i.test(line)), `Style profile did not summarize voice: ${JSON.stringify(profile)}`);
  assert(profile.preferredTerms.includes("Abx") && profile.preferredTerms.includes("f/u"), `Style profile did not preserve shorthand terms: ${JSON.stringify(profile)}`);
  assert(profile.apVoice === "terse" || profile.apVoice === "balanced", `Style profile should prefer concise user voice: ${JSON.stringify(profile)}`);
  return profile;
}

function wardScenario() {
  let patient = makePatient({
    id: "synthetic-ward-complex",
    bed: "E2-011",
    patientCode: "SYN-WARD",
    age: 62,
    sex: "M",
    primaryDiagnosis: "PNA/sepsis w/ AKI",
    underlyingDiseases: "DM; CKD3; alcoholic liver disease",
  });
  let notes = [];
  const styleProfile = buildStyleProfile(
    patient,
    [
      "E2-011 SYN-WARD 62/M",
      "Dx: PNA/sepsis w/ AKI",
      "S:",
      "- cough better",
      "O:",
      "- V/S: afebrile, BP stable, SpO2 94% NC2L",
      "- Lab: WBC 13 from 18, Cr 1.8 from 2.4",
      "A/P:",
      "# PNA/sepsis, AKI improving",
      "- Abx, f/u Cx, trend WBC/Cr/K.",
      "# LFT/coag",
      "- INR improving, no bleed.",
      "Tasks:",
      "- f/u Cx/Abx duration",
    ].join("\n"),
  );

  const newSoap = [
    "E2-011 SYN-WARD 62/M",
    "Dx: PNA/sepsis w/ AKI/LFT-coag",
    "PMH: DM, CKD3, alcoholic liver disease",
    "Date: 2026-05-01",
    "",
    "S:",
    "- Fever/cough x3d, dyspnea improved after O2/IVF.",
    "",
    "O:",
    "- V/S: T 38.2, BP 92/55, HR 112, RR 22, SpO2 92% NC3L",
    "- PE: RLL crackles, no edema.",
    "- ! Lab: WBC 18.4, lactate 3.1, Cr 2.1 from 1.4, K 3.1, AST/ALT 180/122, INR 1.8, Hb 9.2",
    "- Image: CXR 5/1 RLL PNA; abd sono no biliary obstruction.",
    "",
    "A/P:",
    "# PNA/sepsis, BP/lactate improving",
    "- Ceftriaxone 5/1-, IVF done; f/u B/C/sputum Cx and de-escalation.",
    "# AKI on CKD + hypoK",
    "- Cr 2.1, K 3.1; renal-dose meds, I/O, replace K.",
    "# LFT/coag abnormal, no bleed",
    "- AST/ALT/INR elevated; trend LFT/INR, avoid hepatotoxin.",
    "# Anemia/chronic disease",
    "- Hb 9.2 stable, no overt bleed.",
    "",
    "Tasks:",
    "- f/u B/C/sputum Cx",
    "- Order: Ceftriaxone 5/1-, KCl replacement, VS q4h",
    "- trend WBC/Cr/K/LFT/INR",
    "",
    "DC:",
    "- Pending: afebrile, O2 off, Cx/Abx plan.",
  ].join("\n");
  ({ patient, notes } = saveReviewedSoap(patient, notes, "2026-05-01", newSoap));
  let snapshot = surfaceSnapshot(patient, notes, "2026-05-01");
  assertCanonicalSurfaces(snapshot, "Complex ward New SOAP");
  assertCompactAp(snapshot.draft, "Complex ward New SOAP");
  assertIncludes(snapshot.detailsText, /Ceftriaxone 5\/1-|B\/C|sputum/i, "ward new SOAP Abx/culture");
  assertIncludes(snapshot.detailsText, /LFT|INR|AST\/ALT/i, "ward new SOAP LFT/coag");

  const vitalsOnlyCandidate = [
    "E2-011 SYN-WARD 62/M",
    "Dx: new septic shock",
    "S:",
    "- Patient looks worse.",
    "O:",
    "- V/S: T 37.2, BP 116/70, HR 88, RR 18, SpO2 97% RA",
    "- Lab: WBC normal",
    "A/P:",
    "# Sepsis shock",
    "- Stop Abx, no cultures needed.",
    "Tasks:",
    "- no pending tasks",
  ].join("\n");
  const vitalsDelta = guardRoundSoapDelta({
    workflowMode: "dailyUpdate",
    baselineText: newSoap,
    candidateText: vitalsOnlyCandidate,
    sourceFields: { vitals: "5/2 T 37.2, BP 116/70, HR 88, RR 18, SpO2 97% RA" },
    candidateWarnings: ["synthetic AI tried unrelated rewrite"],
  });
  assertIncludes(vitalsDelta.acceptedText, /V\/S: T 37\.2, BP 116\/70, HR 88, RR 18, SpO2 97% RA/i, "vitals-only update");
  assertIncludes(vitalsDelta.acceptedText, /Ceftriaxone 5\/1-|f\/u B\/C/i, "vitals-only kept Abx/culture");
  assertNotIncludes(vitalsDelta.acceptedText, /Stop Abx|new septic shock|no pending tasks/i, "vitals-only blocked unrelated rewrite");
  assert(vitalsDelta.changedSections.some((section) => section.id === "ap" && section.blocked), "vitals-only should flag blocked A/P rewrite");

  const noisyOrders = [
    "2026/05/02 Ceftriaxone 2 g IV qd 5/1-",
    "Azithromycin 500 mg PO qd x3 days",
    "KCl replacement 20 mEq IV",
    "Normal saline 500 mL IV q12h",
    "Insulin regular sliding scale AC/HS",
    "Heparin SC hold due INR 1.8",
    "Pantoprazole 40 mg PO qd",
    "Senna 2# HS",
    "Vitamin B complex PO qd",
    "Acetaminophen 500 mg PO PRN fever",
    "VS q4h",
    "I/O q8h",
  ].join("\n");
  const parsedOrders = parseMedicationOrders(noisyOrders);
  const orderSummary = summarizeMedicationOrders(parsedOrders, { maxLines: 6, mode: "summary" });
  assert(orderSummary.length <= 6, `ward orders too long:\n${orderSummary.join("\n")}`);
  assert(orderSummary.some((line) => /Abx:.*Ceftriaxone.*Azithromycin/i.test(line)), `ward order summary lost Abx:\n${orderSummary.join("\n")}`);
  assert(!orderSummary.some((line) => /Pantoprazole|Senna|Vitamin/i.test(line)), `ward routine meds leaked:\n${orderSummary.join("\n")}`);

  const labImageOrdersCandidate = [
    "E2-011 SYN-WARD 62/M",
    "Dx: PNA/sepsis w/ AKI/LFT-coag",
    "PMH: DM, CKD3, alcoholic liver disease",
    "Date: 2026-05-02",
    "",
    "S:",
    "- Cough less, no fever overnight.",
    "",
    "O:",
    "- V/S: T 37.2, BP 116/70, HR 88, RR 18, SpO2 97% RA",
    "- PE: RLL crackles less, no edema.",
    "- Lab: WBC 12.8 from 18.4, Cr 1.7 from 2.1, K 3.4 from 3.1, AST/ALT 110/88, INR 1.5, Hb 9.0 stable",
    "- Image: CXR 5/2 RLL opacity improving, no effusion.",
    "",
    "A/P:",
    "# PNA/sepsis, improving",
    "- Ceftriaxone 5/1-, Azithro x3d; f/u B/C/sputum Cx and de-escalation.",
    "# AKI on CKD + hypoK",
    "- Cr/K improving; renal-dose meds, I/O, replace K.",
    "# LFT/coag abnormal, improving",
    "- AST/ALT/INR downtrend; no bleed, avoid hepatotoxin.",
    "# Anemia/chronic disease",
    "- Hb 9.0 stable, no overt bleed.",
    "",
    "Tasks:",
    ...orderSummary.map((line) => `- Order: ${line}`),
    "- f/u B/C/sputum Cx",
    "- trend WBC/Cr/K/LFT/INR",
    "",
    "DC:",
    "- Pending: off O2, Cx/Abx course, OPD/meds.",
  ].join("\n");
  const mixedDelta = guardRoundSoapDelta({
    workflowMode: "dailyUpdate",
    baselineText: vitalsDelta.acceptedText,
    candidateText: labImageOrdersCandidate,
    sourceFields: {
      labs: "WBC 12.8 from 18.4, Cr 1.7 from 2.1, K 3.4 from 3.1, AST/ALT 110/88, INR 1.5, Hb 9.0 stable",
      images: "CXR 5/2 RLL opacity improving, no effusion",
      orders: noisyOrders,
      other: "Cough less, no fever overnight. Pending off O2, Cx/Abx course, OPD/meds.",
    },
  });
  assertIncludes(mixedDelta.acceptedText, /Lab: WBC 12\.8 from 18\.4, Cr 1\.7 from 2\.1, K 3\.4/i, "ward lab trend");
  assertIncludes(mixedDelta.acceptedText, /Image: CXR 5\/2 RLL opacity improving/i, "ward image study/date");
  assertIncludes(mixedDelta.acceptedText, /Abx: Ceftriaxone.*Azithromycin/i, "ward order summary in SOAP");
  assertIncludes(mixedDelta.acceptedText, /LFT\/coag abnormal/i, "ward LFT A/P preserved");
  assertNotIncludes(mixedDelta.acceptedText, /Pantoprazole|Senna|Vitamin B/i, "ward routine orders hidden");

  ({ patient, notes } = saveReviewedSoap(patient, notes, "2026-05-02", mixedDelta.acceptedText));

  const dcCandidate = mixedDelta.acceptedText
    .replace("WBC 12.8 from 18.4", "WBC 8.9 from 12.8")
    .replace("Cr 1.7 from 2.1", "Cr 1.3 from 1.7")
    .replace("Pending: off O2, Cx/Abx course, OPD/meds.", "Ready: RA stable, B/C negative 48h, PO Abx plan, OPD booked, meds/certificate done.");
  const dcDelta = guardRoundSoapDelta({
    workflowMode: "dailyUpdate",
    baselineText: mixedDelta.acceptedText,
    candidateText: dcCandidate,
    sourceFields: {
      labs: "5/5 WBC 8.9 from 12.8, Cr 1.3 from 1.7",
      other: "RA stable, B/C negative 48h, switch to PO Abx, OPD booked, meds and certificate done, discharge tomorrow.",
    },
  });
  ({ patient, notes } = saveReviewedSoap(patient, notes, "2026-05-05", dcDelta.acceptedText));
  snapshot = surfaceSnapshot(patient, notes, "2026-05-05");
  assertCanonicalSurfaces(snapshot, "Complex ward discharge-ready Print");
  assertCompactAp(snapshot.draft, "Complex ward discharge-ready Print");
  assertIncludes(snapshot.detailsText, /Ready: RA stable|OPD booked|certificate done/i, "ward DC ready");
  assertIncludes(snapshot.orderDisplay.join("\n"), /Abx: Ceftriaxone/i, "ward print order display");
  assert(snapshot.isComplexPrint, "ward discharge-ready patient should auto-expand in Print");
  assertIncludes(snapshot.printPriorityText, /Ceftriaxone|Azithromycin/i, "ward priority print keeps Abx");
  assertIncludes(snapshot.printPriorityText, /B\/C negative|Cx/i, "ward priority print keeps cultures");
  assertIncludes(snapshot.printPriorityText, /Cr 1\.3|Cr 1\.7/i, "ward priority print keeps renal trend");
  assertIncludes(snapshot.printPriorityText, /CXR 5\/2/i, "ward priority print keeps image study/date");
  assertIncludes(snapshot.printPriorityText, /OPD booked|certificate done/i, "ward priority print keeps DC blockers/prep");
  assert(styleProfile.styleSummary.some((line) => /Common terms:.*f\/u/i.test(line)), "style profile should carry user shorthand into AI prompt context");
}

function icuTransferScenario() {
  let patient = makePatient({
    id: "synthetic-icu-transfer",
    bed: "ICU-T02",
    patientCode: "SYN-ICU",
    age: 76,
    sex: "F",
    primaryDiagnosis: "Cholangitis septic shock s/p ERCP, ICU transfer",
    underlyingDiseases: "CKD3b; COPD; HFrEF EF35%; AF on apixaban; old lacunar infarct",
  });
  let notes = [];

  const transferSoap = [
    "ICU-T02 SYN-ICU 76/F",
    "Dx: Cholangitis septic shock s/p ERCP, ICU transfer",
    "PMH: CKD3b, COPD, HFrEF EF35%, AF on apixaban, old lacunar infarct",
    "Date: 2026-05-17",
    "",
    "S:",
    "- ICU transfer; weak cough, intermittently confused, no fever.",
    "",
    "O:",
    "- V/S: BP 106/64, HR 104 irreg, RR 22, SpO2 93% NC2L",
    "- PE: weak cough, coarse BS RLL, mild delirium, no focal weakness.",
    "- ! Lab: WBC 13.2 from 25.4, Hb 8.4, Plt 64, Cr 2.7 from peak 5.8, K 5.3, Na 130, VBG pCO2 58, lactate 1.4",
    "- Image: CT AP 5/16 biliary stent in place, no abscess; CXR 5/17 RLL aspiration opacity improving; Head CT 5/16 no ICH.",
    "",
    "A/P:",
    "# Cholangitis sepsis s/p ERCP, shock resolved",
    "- Mero/Vanco from ICU; f/u B/C/bile Cx, de-escalate if stable, source control done.",
    "# AKI on CKD, off CRRT",
    "- Cr 2.7, K 5.3; trend Cr/K/UO, renal-dose meds, avoid nephrotoxin.",
    "# Aspiration PNA/COPD, hypercapnia risk",
    "- O2 NC2L, pCO2 58; bronchodilator, O2 wean, NIV threshold if CO2/LOC worse.",
    "# AF/HFrEF + AC/bleed tradeoff",
    "- HR 104 irreg, EF35; hold apixaban until Hb/Plt review, resume when safe.",
    "# Delirium/deconditioning, rehab/DC barrier",
    "- Swallow/rehab eval, remove lines/tubes as able.",
    "",
    "Tasks:",
    "- f/u B/C/bile/sputum Cx and Abx de-escalation",
    "- Order: Meropenem 5/14-, Vanco 5/14-, O2 NC2L, bronchodilator neb, renal-dose meds",
    "- trend Cr/K/UO, Hb/Plt before AC",
    "- swallow + rehab eval",
    "",
    "DC:",
    "- Barrier: O2/CO2, renal recovery, AC decision, rehab placement.",
  ].join("\n");
  const transferReview = guardRoundSoapDelta({
    workflowMode: "transferHandoff",
    baselineText: "",
    candidateText: transferSoap,
    sourceFields: {
      admission: "Cholangitis septic shock s/p ERCP stent, ICU course pressor/intubation/CRRT.",
      lastSoap: "ICU note: shock resolved, extubated, CRRT stopped.",
      vitals: "BP 106/64 HR 104 RR22 SpO2 93 NC2L",
      labs: "WBC 13.2 from 25.4, Cr 2.7 from 5.8, K 5.3, pCO2 58",
      images: "CT AP biliary stent no abscess; CXR aspiration improving; Head CT no ICH",
    },
  });
  assert(transferReview.acceptedText === transferReview.candidateText, "Transfer mode should allow full first SOAP draft");
  ({ patient, notes } = saveReviewedSoap(patient, notes, "2026-05-17", transferReview.acceptedText));
  let snapshot = surfaceSnapshot(patient, notes, "2026-05-17");
  assertCanonicalSurfaces(snapshot, "ICU transfer first SOAP");
  assertCompactAp(snapshot.draft, "ICU transfer first SOAP");
  assertIncludes(snapshot.detailsText, /shock resolved|source control done/i, "ICU transfer active/resolved sepsis distinction");
  assertIncludes(snapshot.detailsText, /AKI on CKD|Cr 2\.7|K 5\.3|UO/i, "ICU transfer renal");
  assertIncludes(snapshot.detailsText, /O2 NC2L|pCO2 58|NIV/i, "ICU transfer O2/CO2");
  assertIncludes(snapshot.detailsText, /AF\/HFrEF|hold apixaban|Hb\/Plt/i, "ICU transfer AC decision");

  const dailyCandidate = [
    "ICU-T02 SYN-ICU 76/F",
    "Dx: Cholangitis septic shock s/p ERCP, ICU transfer",
    "PMH: CKD3b, COPD, HFrEF EF35%, AF on apixaban, old lacunar infarct",
    "Date: 2026-05-18",
    "",
    "S:",
    "- More alert, cough better, O2 down.",
    "",
    "O:",
    "- V/S: BP 118/70, HR 92 irreg, RR 18, SpO2 96% NC1L",
    "- PE: coarse RLL less, delirium improving, weak gait.",
    "- Lab: WBC 10.4 from 13.2, Hb 8.6 stable, Plt 82 from 64, Cr 2.1 from 2.7, K 4.7 from 5.3, VBG pCO2 52 from 58",
    "- Image: CXR 5/18 aspiration opacity improved; no new edema.",
    "",
    "A/P:",
    "# Cholangitis sepsis s/p ERCP, shock resolved",
    "- Cx pending, de-escalate Mero/Vanco if sensitivity clear; no pressor.",
    "# AKI on CKD, off CRRT",
    "- Cr/K improving, UO adequate; renal-dose meds.",
    "# Aspiration PNA/COPD, hypercapnia improving",
    "- O2 NC1L, pCO2 down; wean O2, bronchodilator.",
    "# AF/HFrEF + AC/bleed tradeoff",
    "- Plt 82/Hb stable; decide apixaban restart after bleeding review.",
    "# Delirium/deconditioning, rehab/DC barrier",
    "- Swallow passed soft diet; rehab placement pending.",
    "",
    "Tasks:",
    "- f/u Cx/Abx de-escalation",
    "- Order: Meropenem 5/14-, Vanco 5/14-, O2 NC1L, bronchodilator neb, heparin hold, apixaban restart review",
    "- trend Cr/K/UO, Hb/Plt and AC timing",
    "- rehab placement",
    "",
    "DC:",
    "- Barrier: O2 wean, renal recovery, AC restart, rehab bed.",
  ].join("\n");
  const dailyReview = guardRoundSoapDelta({
    workflowMode: "dailyUpdate",
    baselineText: transferReview.acceptedText,
    candidateText: dailyCandidate,
    sourceFields: {
      vitals: "5/18 BP 118/70 HR 92 RR18 SpO2 96 NC1L",
      labs: "WBC 10.4 from 13.2, Plt 82 from 64, Cr 2.1 from 2.7, K 4.7, pCO2 52",
      images: "CXR 5/18 aspiration opacity improved; no edema",
      orders: "Meropenem 5/14-, Vanco 5/14-, O2 NC1L, bronchodilator neb, heparin hold, apixaban restart review",
      other: "More alert, cough better, O2 down, swallow passed soft diet, rehab placement pending, barrier O2/renal/AC/rehab.",
    },
  });
  assertIncludes(dailyReview.acceptedText, /Lab: WBC 10\.4 from 13\.2.*Cr 2\.1 from 2\.7.*pCO2 52 from 58/i, "ICU daily lab trend");
  assertIncludes(dailyReview.acceptedText, /Image: CXR 5\/18 aspiration opacity improved/i, "ICU daily image study/date");
  assertIncludes(dailyReview.acceptedText, /Cholangitis sepsis s\/p ERCP, shock resolved/i, "ICU daily kept resolved shock in course");
  assertNotIncludes(dailyReview.acceptedText, /# .*active shock|septic shock active|pressor restart/i, "ICU daily should not create active shock");
  assertIncludes(dailyReview.acceptedText, /AKI on CKD.*off CRRT|Cr\/K improving|UO adequate/i, "ICU daily renal A/P");
  assertIncludes(dailyReview.acceptedText, /AF\/HFrEF.*AC|apixaban restart/i, "ICU daily AC A/P");
  assertIncludes(dailyReview.acceptedText, /rehab placement|Barrier: O2 wean, renal recovery, AC restart, rehab bed/i, "ICU daily DC barrier");

  ({ patient, notes } = saveReviewedSoap(patient, notes, "2026-05-18", dailyReview.acceptedText));
  snapshot = surfaceSnapshot(patient, notes, "2026-05-18");
  assertCanonicalSurfaces(snapshot, "ICU ward daily Print");
  assertCompactAp(snapshot.draft, "ICU ward daily Print");
  assert(snapshot.visibleObjective.some((line) => /^Lab:/i.test(line)) && snapshot.visibleObjective.some((line) => /^Image:/i.test(line)), "ICU print should show lab and image sections");
  assert([...snapshot.visibleOrderLines, ...snapshot.visibleTaskLines].some((line) => /Meropenem|Vanco|apixaban/i.test(line)), "ICU print should keep high-yield order/task line");
  assert(snapshot.isComplexPrint, "ICU transfer should auto-expand in Print");
  assertIncludes(snapshot.printPriorityText, /ERCP|source control|shock resolved/i, "ICU priority print keeps source control/resolved shock context");
  assertIncludes(snapshot.printPriorityText, /Cr 2\.1 from 2\.7|K 4\.7|UO/i, "ICU priority print keeps AKI/K/UO");
  assertIncludes(snapshot.printPriorityText, /O2 NC1L|pCO2 52|CXR 5\/18/i, "ICU priority print keeps O2/CO2/image");
  assertIncludes(snapshot.printPriorityText, /AF\/HFrEF|apixaban|heparin hold/i, "ICU priority print keeps AC decision");
  assertIncludes(snapshot.printPriorityText, /rehab placement|Barrier: O2 wean, renal recovery, AC restart, rehab bed/i, "ICU priority print keeps rehab/DC barrier");
}

function printPrioritySelectorScenario() {
  const crowdedLines = [
    "routine diet tolerated",
    "walking with family",
    "Lab: ! K 6.1, Cr 2.7",
    "Image: CXR 5/18 aspiration opacity improved",
    "routine senna and vitamin",
    "A/P: AKI on CKD: Cr/K improving; renal-dose meds, avoid nephrotoxin.",
  ];
  const selected = selectPriorityPrintItems(crowdedLines, { fallbackKind: "lab", maxItems: 2, maxChars: 22 }).map((item) => item.text).join("\n");
  assertIncludes(selected, /K 6\.1|Cr 2\.7/i, "priority selector keeps critical lab beyond first-N");
  assertIncludes(selected, /CXR 5\/18/i, "priority selector keeps image finding beyond first-N");
  assertNotIncludes(selected, /routine hidden/i, "priority selector should not print hidden-routine placeholder");
  assertNotIncludes(selected, /\b(?:w\/|no|after|CT)\s*$/i, "priority selector should not leave dangling tails");

  const crowdedObjectiveLines = [
    "V/S: stable",
    "PE: clear",
    "routine diet tolerated",
    "Lab: WBC 7.1, Hb 9.1, PLT 122, BUN 24, Cr 0.83, Na 130, K 4.0, ALT 11",
  ];
  const objectiveSelected = selectPriorityPrintItems(crowdedObjectiveLines, { fallbackKind: "other", maxItems: 1, maxChars: 42 }).map((item) => item.text).join("\n");
  assertIncludes(objectiveSelected, /WBC 7\.1|Hb 9\.1|Cr 0\.83|K 4\.0/i, "priority selector keeps explicit SOAP lab line even when O is crowded");
  assertNotIncludes(objectiveSelected, /routine hidden/i, "crowded objective should not show hidden-routine placeholder");
}

function runCase(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ name, message });
    console.error(`FAIL ${name}: ${message}`);
  }
}

const cases = [
  ["Complex ward admission-to-discharge SOAP/list workflow", wardScenario],
  ["ICU transfer-to-ward-rounding SOAP/list workflow", icuTransferScenario],
  ["Print priority selector preserves high-yield lines over first-N compacting", printPrioritySelectorScenario],
];

cases.forEach(([name, fn]) => runCase(name, fn));

await server.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} clinical E2E scenario(s) failed.`);
  process.exit(1);
}

console.log(`\n${cases.length} clinical E2E scenarios passed.`);
