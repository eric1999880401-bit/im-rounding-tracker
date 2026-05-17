import { useState } from "react";
import type { ReactNode } from "react";
import type { DailyNotesByPatient, MiscTask, Patient, PhonebookContact, PrintDensity, SortMode, StudyTopic } from "../types";
import {
  getActiveProblemItems,
  getActiveAttendingNames,
  getActivePatients,
  getAdmissionSummaryText,
  getLabFocusSummary,
  getPatientDisplaySummary,
  getUnderlyingDiseaseItems,
  groupPatientsByAttending,
  dischargePrepText,
  formatDateLabel,
  plainClinicalText,
  sortPatients,
} from "../utils";
import { ClinicalText } from "../components/ClinicalText";
import { useT } from "../i18n";
import { getRoundingDigest } from "../roundingDigest";

interface PageProps {
  patients: Patient[];
  dailyNotesByPatient?: DailyNotesByPatient;
  phonebook?: PhonebookContact[];
  miscTasks?: MiscTask[];
  studyTopics?: StudyTopic[];
}

function PrintRoundingListPage({
  patients,
  dailyNotesByPatient = {},
  phonebook = [],
  miscTasks = [],
  studyTopics = [],
}: PageProps) {
  const t = useT();
  const [printMode, setPrintMode] = useState("all");
  const [admissionBriefPrintMode, setAdmissionBriefPrintMode] = useState("compact");
  const [selectedAttending, setSelectedAttending] = useState("");
  const [hideCompletedTasks, setHideCompletedTasks] = useState(true);
  const [density, setDensity] = useState<PrintDensity>("compact");
  const [sortMode, setSortMode] = useState<SortMode>("bed");
  const [team, setTeam] = useState("Team A");
  const [attending, setAttending] = useState("");
  const [resident, setResident] = useState("");
  const [includePhonebook, setIncludePhonebook] = useState(true);
  const [includeMiscTasks, setIncludeMiscTasks] = useState(true);
  const [includeStudyTopics, setIncludeStudyTopics] = useState(true);
  const attendingNames = getActiveAttendingNames(patients);
  const filteredActivePatients = getActivePatients(patients)
    .map((patient) => getPatientDisplaySummary(patient, dailyNotesByPatient).patient)
    .filter((patient) => printMode !== "selected" || patient.attending.trim() === selectedAttending);
  const activePatients = sortPatients(filteredActivePatients, sortMode);
  const groupedPatients = groupPatientsByAttending(activePatients);
  const todayText = new Date().toLocaleDateString();
  const shouldPrintCompactList = admissionBriefPrintMode !== "briefsOnly";
  const unfinishedMiscTasks = includeMiscTasks ? miscTasks.filter((task) => !task.done) : [];
  const openStudyTopics = includeStudyTopics ? studyTopics.filter((topic) => !topic.done) : [];
  const printContacts = includePhonebook ? [...phonebook].sort((a, b) => Number(b.isImportant) - Number(a.isImportant)) : [];

  function admissionBriefPatients() {
    if (admissionBriefPrintMode === "newAdmissions") {
      return activePatients.filter((patient) => patient.isNewAdmission);
    }

    if (admissionBriefPrintMode === "selectedBriefs") {
      return activePatients.filter((patient) => patient.showAdmissionBriefOnPrint);
    }

    if (admissionBriefPrintMode === "briefsOnly") {
      return activePatients.filter((patient) => patient.isNewAdmission || patient.showAdmissionBriefOnPrint);
    }

    return [];
  }

  const selectedAdmissionBriefCandidates = admissionBriefPatients();
  const selectedAdmissionBriefPatients = selectedAdmissionBriefCandidates.filter(hasMeaningfulAdmissionBrief);
  const emptyAdmissionBriefPatients = selectedAdmissionBriefCandidates.filter((patient) => !hasMeaningfulAdmissionBrief(patient));

  function hasMeaningfulAdmissionBrief(patient: Patient) {
    return Boolean(
      (patient.chiefComplaint || patient.admissionChiefConcern).trim() ||
        (patient.presentIllnessOrHPI || patient.hpiOrAdmissionStory).trim() ||
        getAdmissionSummaryText(patient, { allowFallback: false }).trim() ||
        patient.generatedAdmissionNote.trim() ||
        patient.admissionBriefNotes.trim(),
    );
  }

  function printLimits() {
    if (density === "ultra-compact") {
      return {
        generalItems: 6,
        chars: 40,
        detailChars: 52,
        redFlags: 2,
        pmh: 3,
        problems: 3,
        subjective: 1,
        pe: 1,
        labReports: 1,
        labItems: 4,
        images: 1,
        tasks: 3,
        dcChars: 42,
      };
    }

    if (density === "compact") {
      return {
        generalItems: 8,
        chars: 50,
        detailChars: 66,
        redFlags: 2,
        pmh: 4,
        problems: 4,
        subjective: 2,
        pe: 1,
        labReports: 1,
        labItems: 5,
        images: 1,
        tasks: 3,
        dcChars: 54,
      };
    }

    return {
      generalItems: 10,
      chars: 62,
      detailChars: 84,
      redFlags: 3,
      pmh: 5,
      problems: 5,
      subjective: 2,
      pe: 2,
      labReports: 2,
      labItems: 7,
      images: 2,
      tasks: 5,
      dcChars: 68,
    };
  }

  function cleanPrintLine(value: string) {
    return value
      .replace(/\s+-\s*Reason:\s*.*$/i, "")
      .replace(/\s*\(\s*source:\s*AI\s*\)\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function removePrintEllipsis(value: string) {
    return value
      .replace(/\bClarify current and HBV if\.{3}/i, "Clarify immunosupp/HBV status")
      .replace(/\bif\.{3}$/i, "")
      .replace(/\s*\.{3,}\s*/g, " ")
      .replace(/\s+(?:and|or|if|with|for|to|of)$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function displayPrintLine(value: string) {
    return removePrintEllipsis(cleanPrintLine(value)
      .replace(/^!+/, "")
      .replace(/^(\w[\w/ ]{0,12}:\s*)!?\s*(?:critical|urgent)\s*:\s*/i, "$1* ")
      .replace(/^\s*(?:critical|urgent)\s*:\s*/i, "* ")
      .replace(/\b(?:critical|urgent)\s*:\s*/gi, "* ")
      .replace(/\[\s*URGENT\s*\]\s*/gi, "* ")
      .replace(/\bhigh-normal\b/gi, "\u2197 nl")
      .replace(/\blow-normal\b/gi, "\u2198 nl")
      .replace(/\bhigh\b/gi, "\u2191")
      .replace(/\blow\b/gi, "\u2193")
      .trim());
  }

  function isImportantPrintLine(value: string) {
    return /^!/.test(value.trim()) || /\bcritical\b|\burgent\b|\[URGENT\]|\bLab\s+\*/i.test(value);
  }

  function printListItems(value: string) {
    const seen = new Set<string>();
    return value
      .split(/\r?\n|;\s*|\s+\|\s+/)
      .map((line) => ({ raw: line, text: displayPrintLine(line) }))
      .filter((item) => item.text)
      .filter((item) => {
        const key = item.text.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function printItemClassName(item: { raw: string; text: string }) {
    return [
      "print-soap-item",
      isImportantPrintLine(item.raw) || item.text.startsWith("*") ? "print-soap-important" : "",
      /^Lab \*/i.test(item.text) ? "print-lab-critical-line" : "",
      /^Lab \u0394/i.test(item.text) ? "print-lab-trend-line" : "",
      /^Lab Ref/i.test(item.text) ? "print-lab-ref-line" : "",
    ].filter(Boolean).join(" ");
  }

  function simpleRedFlagText(value: string) {
    return cleanPrintLine(value)
      .replace(/^!+/, "")
      .replace(/:\s*(?:f\/u|follow|trend|verify|confirm|clarify|review|call|repeat|check|order|consult|start|stop|hold|resume|Cx|Abx|CBC|ANC).*/i, "")
      .trim();
  }

  function shortText(value: string, maxChars = printLimits().detailChars) {
    const clean = cleanPrintLine(value);
    if (clean.length <= maxChars) return clean;
    const firstClause = clean.split(/[;\n\u3002\uFF1B]/)[0]?.trim() || clean;
    return toShortWords(firstClause, maxChars);
  }

  function cleanPrintTail(value: string) {
    let clean = value.replace(/\s+[+,;:-]\s*$/g, "").trim();
    for (let index = 0; index < 2; index += 1) {
      clean = clean.replace(/\s+\b(?:if|and|or|with|without|w\/|for|to|from|of|the|a|an|when|as)\b\.?$/i, "").trim();
    }
    return clean;
  }

  function toShortWords(value: string, maxChars = printLimits().detailChars) {
    const clean = cleanPrintLine(value)
      .replace(/\bright\b/gi, "R")
      .replace(/\bleft\b/gi, "L")
      .replace(/\bbilateral\b/gi, "B/L")
      .replace(/\bwithout\b/gi, "w/o")
      .replace(/\bwith\b/gi, "w/")
      .replace(/\bsuspected\b/gi, "susp")
      .replace(/\bcompatible with\b/gi, "c/w")
      .replace(/\bconcerning for\b/gi, "c/f")
      .replace(/\bfollow[- ]?up\b/gi, "f/u")
      .replace(/\bacute ischemic stroke\b/gi, "AIS")
      .replace(/\binfarctions?\b/gi, "infarct")
      .replace(/\bhemorrhage\b/gi, "ICH")
      .replace(/\bpneumonia\b/gi, "PNA")
      .replace(/\bperoneal\/tibial CMAP & sural SNAP unelicitable\b/gi, "peroneal/tibial/sural unelicitable")
      .replace(/\bCMAP & sural SNAP\b/gi, "CMAP/SNAP")
      .replace(/\s+/g, " ")
      .trim();
    if (clean.length <= maxChars) return clean;

    const limit = Math.max(8, maxChars);
    const words = clean.split(" ");
    const kept: string[] = [];
    words.forEach((word) => {
      const next = [...kept, word].join(" ");
      if (next.length <= limit) kept.push(word);
    });
    return cleanPrintTail(kept.join(" ") || clean.slice(0, limit).trim());
  }

  function splitClinicalClauses(value: string) {
    return cleanPrintLine(value)
      .replace(/\b\d+\.\s*/g, "; ")
      .split(/\s*(?:;|。|\.|\n|, and | and )\s*/i)
      .map(cleanPrintLine)
      .filter(Boolean);
  }

  function lowValueClause(value: string) {
    return /\b(unremarkable|normal|no acute|no definite|no evidence|negative for|within normal|stable|unchanged|mild atrophy|elderly|small vessel disease|degenerative|pulse \+|no cv angle|no cva|no ich|no hemorrhage|no intracranial hemorrhage)\b/i.test(value);
  }

  function clinicalSignalScore(value: string, kind: "image" | "pe") {
    const text = value.toLowerCase();
    let score = 0;
    if (/!|critical|urgent|pending|new|acute|worsen|progress/.test(text)) score += 5;
    if (kind === "image" && /infarct|stroke|ich|hemorrhage|bleed|hypodense|stenosis|occlusion|aneurysm|mass|tumou?r|abscess|pneumonia|\bpna\b|edema|effusion|pe\b|dvt|fracture|hematoma|obstruction|pending|unelicitable/.test(text)) score += 7;
    if (kind === "pe" && /weak|palsy|dysarth|aphasia|numb|sensory|motor|nystagmus|facial|pale|jaundice|crackle|wheeze|rales|murmur|jvp|edema|tender|guard|distend|melena|blood|cyanosis|rash|wound|pus|erythem|pooling|discharge/.test(text)) score += 7;
    if (/\b(r|l|rt|lt|right|left|bil|b\/l)\b/.test(text)) score += 1;
    if (/\d/.test(text)) score += 1;
    if (lowValueClause(value)) score -= 8;
    return score;
  }

  function bestClinicalSignal(value: string, kind: "image" | "pe", maxChars = printLimits().detailChars) {
    const clauses = splitClinicalClauses(value);
    if (clauses.length === 0) return "";
    const scored = clauses
      .map((clause) => ({ clause, score: clinicalSignalScore(clause, kind) }))
      .sort((a, b) => b.score - a.score || a.clause.length - b.clause.length);
    const best = scored.find((entry) => entry.score > 0)?.clause ?? scored.find((entry) => !lowValueClause(entry.clause))?.clause ?? scored[0]?.clause ?? "";
    return toShortWords(best, maxChars);
  }

  function shortStudyType(value: string) {
    const text = value.trim();
    if (!text) return "";
    if (/mri|mra/i.test(text) && /brain/i.test(text)) return "MRI/MRA brain";
    if (/ct|cta/i.test(text) && /brain/i.test(text)) return "CT/CTA brain";
    if (/cxr|chest x/i.test(text)) return "CXR";
    if (/pelvis/i.test(text) && /mri/i.test(text)) return "MRI pelvis";
    if (/carotid|tcd/i.test(text)) return "Carotid/TCD";
    if (/abi/i.test(text)) return "ABI";
    if (/ncv|emg/i.test(text)) return "NCV/EMG";
    if (/ultrasound|sono|u\/s/i.test(text)) return "U/S";
    return toShortWords(text, 18);
  }

  function uniqueTags(tags: string[]) {
    const seen = new Set<string>();
    return tags.filter((tag) => {
      const clean = tag.trim();
      const key = clean.toLowerCase();
      if (!clean || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function joinTags(tags: string[], maxItems: number) {
    const unique = uniqueTags(tags);
    const visible = unique.slice(0, maxItems);
    return visible.join(", ");
  }

  function sidePrefix(text: string) {
    if (/\b(left|lt)\b/i.test(text)) return "L";
    if (/\b(right|rt)\b/i.test(text)) return "R";
    return "";
  }

  function diagnosisSummary(patient: Patient) {
    const text = [patient.primaryDiagnosis, patient.oneLiner].filter(Boolean).join(" ");
    const diagnosisText = patient.primaryDiagnosis || patient.oneLiner;
    const lower = text.toLowerCase();
    const tags: string[] = [];
    const side = sidePrefix(diagnosisText);
    const nihss = text.match(/\bnihss\s*[:=]?\s*(\d+)/i)?.[1];

    if (/tia/.test(lower) && !/stroke|infarct/.test(lower)) tags.push("TIA");
    if (/ischemic stroke|acute stroke|\bais\b|infarct|cva/.test(lower)) {
      tags.push(`${side ? `${side} ` : ""}AIS${nihss ? ` NIHSS${nihss}` : ""}`);
    }
    if (/mca/.test(lower) && /stenos/.test(lower)) tags.push(`${side ? `${side} ` : ""}MCA stenosis`);
    if (/ica|carotid/.test(lower) && /stenos/.test(lower)) tags.push(`${side ? `${side} ` : ""}ICA stenosis`);
    if (/basal ganglia/.test(lower)) tags.push(`${side ? `${side} ` : ""}BG`);
    if (/cerebell/.test(lower)) tags.push(`${side ? `${side} ` : ""}cerebellar`);
    if (/pons|pontine/.test(lower)) tags.push("pontine");
    if (/subcortical/.test(lower)) tags.push(`${side ? `${side} ` : ""}subcortical`);
    if (/posterior circulation|post circ/.test(lower)) tags.push("post circ");
    if (/a[\s-]*to[\s-]*a|artery[\s-]*to[\s-]*artery/.test(lower)) tags.push("r/o A-A");
    if (/ramsay/.test(lower)) tags.push("Ramsay Hunt");
    if (/parkinson/.test(lower)) tags.push("Parkinson");
    if (/cholangitis/.test(lower) && /sepsis|septic|shock/.test(lower)) tags.push("cholangitis sepsis");
    else if (/sepsis|septic/.test(lower)) tags.push("sepsis");
    if (/pneumonia|\bpna\b/.test(lower)) tags.push("PNA");
    if (/urinary tract infection|\buti\b/.test(lower)) tags.push("UTI");
    if (/postmenopausal bleeding|vaginal bleeding|\bpmb\b/.test(lower)) tags.push("PMB");
    if (/diabetes|dm/.test(lower) && /poor|uncontrol|hypergly/.test(lower)) tags.push("DM poor ctrl");
    if (/visual|auditory|hallucination/.test(lower)) tags.push("hallucination");

    const summary = joinTags(tags, density === "ultra-compact" ? 3 : 4);
    return summary || shortText(text, printLimits().detailChars);
  }

  function riskSummary(patient: Patient) {
    const text = [
      patient.underlyingDiseases,
      patient.admissionPMH,
      ...getUnderlyingDiseaseItems(patient),
    ].join(" ");
    const lower = text.toLowerCase();
    const tags: string[] = [];

    if (/\bhtn\b|hypertension/.test(lower)) tags.push("HTN");
    if (/\bdm\b|diabetes|t2dm/.test(lower)) tags.push("DM");
    if (/hyperlipidemia|\bhld\b|dyslipidemia/.test(lower)) tags.push("HLD");
    if (/afib|atrial fibrillation|paroxysmal af/.test(lower)) tags.push("AF");
    if (/\bcad\b|coronary/.test(lower)) tags.push("CAD");
    if (/heart failure|\bhf\b|chf|lvhf|nyha|reduced ef|hfr?ef/.test(lower)) tags.push("HF");
    if (/\bckd\b|esrd|dialysis|renal/.test(lower)) tags.push("CKD");
    if (/tia|stroke|cva/.test(lower)) tags.push("old CVA/TIA");
    if (/\bsle\b|lupus/.test(lower)) tags.push("SLE");
    if (/\bhbv\b|hepatitis b/.test(lower)) tags.push("HBV");
    if (/\bhcv\b|hepatitis c/.test(lower)) tags.push("HCV");
    if (/cirrhosis/.test(lower)) tags.push("cirrhosis");
    if (/copd|asthma/.test(lower)) tags.push("COPD/asthma");
    if (/pulmonary hypertension|phtn/.test(lower)) tags.push("pulm HTN");
    if (/tricuspid regurgitation|\btr\b/.test(lower)) tags.push("TR");
    if (/hypothyroid|hyperthyroid|thyroid/.test(lower)) tags.push("thyroid");
    if (/cancer|malign|carcinoma|tumou?r|ca\b/.test(lower)) tags.push("CA hx");

    const maxItems = density === "ultra-compact" ? 4 : 5;
    return joinTags(tags, maxItems) || compactList(getUnderlyingDiseaseItems(patient), Math.min(printLimits().pmh, 2), 22);
  }

  function issueSummary(patient: Patient) {
    const text = [
      patient.activeProblems,
      ...getActiveProblemItems(patient),
      ...patient.assessmentPlanItems.map((item) => `${item.problemTitle} ${item.assessmentSummary}`),
    ].join(" ");
    const lower = text.toLowerCase();
    const tags: string[] = [];

    if (/urinary tract infection|\buti\b/.test(lower)) tags.push("UTI");
    if (/postmenopausal bleeding|vaginal bleeding|\bpmb\b|ob gyn|obgyn/.test(lower)) tags.push("PMB");
    if (/diabetes|dm/.test(lower) && /poor|uncontrol|hypergly/.test(lower)) tags.push("DM poor ctrl");
    if (/aki|acute kidney|renal function/.test(lower)) tags.push("AKI");
    if (/anemia|bleed|hb drop/.test(lower)) tags.push("anemia/bleed");
    if (/neutropenic|neutropenia|leukopenia|wbc low/.test(lower)) tags.push("neutropenia");
    if (/infection|sepsis|pneumonia|\bpna\b/.test(lower)) tags.push(/pneumonia|\bpna\b/.test(lower) ? "PNA" : "infection");
    if (/dysphag|swallow/.test(lower)) tags.push("dysphagia");
    if (/carotid|mca|ica/.test(lower) && /stenos/.test(lower)) tags.push("large-vessel stenosis");
    const hasFocalNeuroDeficit =
      /hemiparesis|hemiplegia|aphasia|dysarth|facial droop|cn\s*[ivx]+|palsy|numbness|sensory loss|focal deficit/.test(lower) ||
      (/weak/.test(lower) && /\b(stroke|neuro|focal|hemip|cva|spinal|cord)\b/.test(lower));
    if (hasFocalNeuroDeficit) tags.push("neuro deficit");

    const maxItems = density === "ultra-compact" ? 2 : 4;
    return joinTags(tags, maxItems);
  }

  function clinicalItems(value: string) {
    const text = plainClinicalText(value, "");
    if (!text || text === "-") return [];
    return text.split(/\s*;\s*|\r?\n/).map(cleanPrintLine).filter(Boolean);
  }

  function compactList(items: string[], maxItems: number, maxChars = printLimits().chars) {
    const cleanItems = items.map(cleanPrintLine).filter(Boolean);
    const visible = cleanItems.slice(0, maxItems).map((item) => shortText(item, maxChars));
    return visible.filter(Boolean).join("; ");
  }

  function compactText(value: string, maxChars = printLimits().detailChars, maxItems = 2) {
    return compactList(clinicalItems(value), maxItems, maxChars);
  }

  function allClinicalText(value: string, maxChars = printLimits().detailChars) {
    const items = clinicalItems(value);
    return compactList(items, items.length, maxChars);
  }

  function presentationSummary(patient: Patient) {
    return compactList(
      [
        patient.oneLiner,
        getAdmissionSummaryText(patient, { allowFallback: false }),
        patient.chiefComplaint || patient.admissionChiefConcern,
        patient.presentIllnessOrHPI || patient.hpiOrAdmissionStory,
      ],
      3,
      printLimits().detailChars,
    );
  }

  function pmhSummary(patient: Patient) {
    return compactList(
      [...getUnderlyingDiseaseItems(patient), patient.admissionPMH].filter(Boolean),
      printLimits().pmh,
      24,
    );
  }

  function activeProblemSummary(patient: Patient) {
    return compactList(getActiveProblemItems(patient), printLimits().problems, printLimits().chars);
  }

  function courseSummary(patient: Patient) {
    return compactList(
      [
        patient.hospitalCourseHighlights,
        patient.earlyHospitalCourse,
      ],
      density === "ultra-compact" ? 1 : 2,
      printLimits().detailChars,
    );
  }

  function importantObjectiveText(value: string, maxChars = printLimits().chars, maxItems = 1) {
    const importantPattern = /abnormal|important|\bfever\b|\bfebrile\b|hypotherm|tachy|brady|hypot|hypert|shock|desat|hypox|spo2|oxygen|nasal|nc\b|o2\b|high|low|elevat|drop|worse|hypergly|hypogly|sugar|glucose|\bac\b|\bpc\b|\bhs\b|insulin|bleed|pain|unstable/i;
    const normalOnlyPattern = /\bafebrile\b|\bnormal\b|\bwnl\b|\bstable\b|within normal/i;
    const items = clinicalItems(value).filter((item) => {
      if (item.trim().startsWith("!")) return true;
      if (normalOnlyPattern.test(item) && !/(abnormal|important|hypot|hypert|tachy|brady|desat|hypox|high|low|elevat|drop|worse|hypergly|hypogly|bleed|pain|unstable)/i.test(item)) {
        return false;
      }
      return importantPattern.test(item);
    });
    return compactList(items, maxItems, maxChars);
  }

  function shortDateSortValue(value: string) {
    return String(value || "").replace(/\D/g, "");
  }

  function uniqueLines(lines: string[]) {
    const seen = new Set<string>();
    return lines.filter((line) => {
      const key = cleanPrintLine(line).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function labFocusGroups(patient: Patient) {
    const labFocus = getLabFocusSummary(patient, dailyNotesByPatient[patient.id] ?? [], {
      maxCritical: 3,
      maxTrend: 4,
      maxAnchors: 3,
      separator: " | ",
    });
    return [
      { label: "*", title: "Important labs", items: labFocus.critical.map((item) => displayPrintLine(item)), className: "print-lab-row-critical" },
      { label: "\u0394", title: "Abnormal / trend labs", items: labFocus.trend.map((item) => displayPrintLine(item)), className: "print-lab-row-trend" },
      { label: "Ref", title: "Reference labs", items: labFocus.anchors.map((item) => displayPrintLine(item)), className: "print-lab-row-ref" },
    ].filter((group) => group.items.length > 0);
  }

  function renderLabMiniTable(patient: Patient) {
    const groups = labFocusGroups(patient);
    if (groups.length === 0) return null;

    return (
      <div className="print-lab-mini-table" aria-label="Lab focus" role="table">
        {groups.map((group) => (
          <div className={`print-lab-mini-row ${group.className}`} key={group.label} role="row">
            <span className="print-lab-mini-label" role="rowheader" title={group.title}>
              {group.label}
            </span>
            <span className="print-lab-mini-values" role="cell">
              {group.items.join(", ")}
            </span>
          </div>
        ))}
      </div>
    );
  }

  function renderPrintLabFocus(patient: Patient) {
    const labFocus = getLabFocusSummary(patient, dailyNotesByPatient[patient.id] ?? [], {
      maxCritical: 99,
      maxTrend: 99,
      maxAnchors: 99,
      separator: "\n",
    });
    const groups = [
      { label: "Critical", items: labFocus.critical, important: true },
      { label: "Trend", items: labFocus.trend, important: false },
      { label: "Anchor", items: labFocus.anchors, important: false },
    ].filter((group) => group.items.length > 0);

    if (groups.length === 0) return null;

    return (
      <div className="print-lab-groups">
        {groups.map((group) => (
          <div className="print-lab-group" key={group.label}>
            <span className="print-lab-date">{group.label}</span>
            <span className="print-lab-chip-row">
              {group.items.map((item) => (
                <span className={`print-lab-chip ${group.important ? "important" : ""}`} key={`${group.label}-${item}`}>
                  {shortText(item, printLimits().chars)}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    );
  }

  function imageLines(patient: Patient) {
    return getRoundingDigest(patient, dailyNotesByPatient[patient.id] ?? [], {
      mode: "board",
      hideCompletedTasks,
    }).image.split(/\n/).map(cleanPrintLine).filter(Boolean).slice(0, printLimits().images);
  }

  function peSummaryText(patient: Patient) {
    const objective = getRoundingDigest(patient, dailyNotesByPatient[patient.id] ?? [], {
      mode: "board",
      hideCompletedTasks,
    }).objective;
    const peLine = objective
      .split(/\n/)
      .map((line) => line.trim())
      .find((line) => /^PE:/i.test(line));
    return peLine ? cleanPrintLine(peLine.replace(/^PE:\s*/i, "")) : "";
  }

  function taskSummaryText(patient: Patient) {
    const limits = printLimits();
    const tasks = hideCompletedTasks ? patient.tasks.filter((task) => !task.done) : patient.tasks;
    const sortedTasks = [...tasks].sort((a, b) => {
      const priority = { urgent: 0, normal: 1, low: 2 };
      return priority[a.priority] - priority[b.priority];
    });
    const urgentTasks = sortedTasks.filter((task) => task.priority === "urgent" || task.text.trim().startsWith("!"));
    const routineTasks = sortedTasks.filter((task) => !urgentTasks.includes(task));
    const selectedTasks = [
      ...urgentTasks,
      ...routineTasks.slice(0, Math.max(limits.tasks - urgentTasks.length, 0)),
    ];
    const visible = selectedTasks.map((task) => {
      const text = task.text.trim().startsWith("!") ? task.text.trim().slice(1).trim() : task.text;
      return `${task.priority === "urgent" ? "[URGENT] " : ""}${shortText(text, limits.chars)}${task.dueDate ? ` (${task.dueDate})` : ""}`;
    });
    return visible.filter(Boolean).join("; ");
  }

  function careMilestoneText(patient: Patient) {
    const sourceLines = [
      patient.hospitalCourseHighlights,
      patient.earlyHospitalCourse,
      patient.initialPlan,
      patient.assessment,
      patient.plan,
      patient.dischargePlan,
      ...patient.assessmentPlanItems.flatMap((item) => [
        item.problemTitle,
        item.assessmentSummary,
        ...item.evidenceOrCourseItems,
        ...item.planItems,
      ]),
      ...patient.tasks.map((task) => task.text),
    ].flatMap(clinicalItems);
    const importantPattern = /\b(abx|antibiotic|ceftriaxone|cefazolin|cefepime|ceftazidime|ampicillin|sulbactam|zosyn|piperacillin|tazobactam|vanco|vancomycin|meropenem|ertapenem|levofloxacin|ciprofloxacin|metronidazole|procedure|operation|surgery|biopsy|scope|egd|cfs|catheter|drain|stent|pci|ptca|intubation|extubation|central line|consult|referral|rehab|pt|ot|st|swallow|id|nephro|cardio|neuro|gi|gs|obgyn|urology)\b/i;
    const importantLines = sourceLines.filter((line) => importantPattern.test(line));
    return compactList(importantLines, importantLines.length, printLimits().detailChars);
  }

  function assessmentPlanSummaryText(patient: Patient) {
    return getRoundingDigest(patient, dailyNotesByPatient[patient.id] ?? [], {
      mode: "board",
      hideCompletedTasks,
    }).assessmentPlan.replace(/\n/g, "; ");
  }

  function patientContextText(patient: Patient) {
    return removePrintEllipsis([
      diagnosisSummary(patient) ? `Dx ${diagnosisSummary(patient)}` : "",
      riskSummary(patient) ? `PMH ${riskSummary(patient)}` : "",
      issueSummary(patient) ? `Issues ${issueSummary(patient)}` : "",
    ].filter(Boolean).join(" | "));
  }

  function subjectiveSoapText(patient: Patient) {
    return compactList(
      [
        patient.subjectiveOrChiefConcern,
        patient.overnightEvent,
        patient.oneLiner || diagnosisSummary(patient),
      ].flatMap(clinicalItems),
      density === "ultra-compact" ? 2 : 3,
      printLimits().detailChars,
    );
  }

  function objectiveSoapText(patient: Patient) {
    return [
      importantObjectiveText(patient.vitalSigns, printLimits().chars, 1),
      importantObjectiveText(patient.bloodSugar, printLimits().chars, 1),
      peSummaryText(patient) ? `PE: ${peSummaryText(patient)}` : "",
    ].filter(Boolean).join("; ");
  }

  function imageSoapText(patient: Patient) {
    const images = imageLines(patient);
    return images.length > 0 ? `Img: ${images.join("; ")}` : "";
  }

  function assessmentSoapText(patient: Patient) {
    return assessmentPlanSummaryText(patient) || issueSummary(patient) || diagnosisSummary(patient);
  }

  function taskDcText(patient: Patient) {
    const prep = dischargePrepText(patient);
    return [
      taskSummaryText(patient),
      patient.dischargePlan ? `DC: ${compactText(patient.dischargePlan, printLimits().dcChars, 1)}` : "",
      prep ? `Prep: ${prep}` : "",
    ].filter(Boolean).join("; ");
  }

  function blockField(label: string, value: ReactNode) {
    if (value === null || value === undefined || value === false) return null;
    if (typeof value === "string" && !value.trim()) return null;
    return (
      <div className="print-block-field" key={label}>
        <strong>{label}:</strong> {value}
      </div>
    );
  }

  function sectionBox(title: string, value: string, extra?: ReactNode) {
    const visibleItems = printListItems(value);
    if (visibleItems.length === 0 && !extra) return null;
    return (
      <div className="print-section-box">
        <div className="print-section-title">{title}</div>
        {visibleItems.length > 0 && (
          <ul className="print-soap-list">
            {visibleItems.map((item, index) => (
              <li className={printItemClassName(item)} key={`${title}-${item.text}-${index}`}>
                {item.text}
              </li>
            ))}
          </ul>
        )}
        {extra}
      </div>
    );
  }

  function renderPrintItems(value: string, keyPrefix: string) {
    const visibleItems = printListItems(value);
    if (visibleItems.length === 0) return null;
    return (
      <ul className="print-soap-list print-soap-list-extra">
        {visibleItems.map((item, index) => (
          <li className={printItemClassName(item)} key={`${keyPrefix}-${item.text}-${index}`}>
            {item.text}
          </li>
        ))}
      </ul>
    );
  }

  function objectiveExtra(patient: Patient) {
    const lab = renderLabMiniTable(patient);
    const image = renderPrintItems(imageSoapText(patient), `${patient.id}-image`);
    if (!lab && !image) return null;
    return (
      <>
        {lab}
        {image}
      </>
    );
  }

  function renderPrintSection(sectionPatients: Patient[], sectionAttending: string, startNewPage = false) {
    return (
      <section
        className={`print-sheet ${startNewPage ? "print-attending-section" : ""}`}
        aria-label={`Printable rounding list for ${sectionAttending}`}
        key={sectionAttending}
      >
        <div className="print-title">
          <h1>{t("print.title")}</h1>
          <div className="print-meta-grid">
            <span>
              <strong>Date:</strong> {todayText}
            </span>
            <span>
              <strong>Team:</strong> {team || "________"}
            </span>
            <span>
              <strong>Attending:</strong> {sectionAttending || attending || "________"}
            </span>
            <span>
              <strong>Resident:</strong> {resident || "________"}
            </span>
            <span>
              <strong>Total active:</strong> {sectionPatients.length}
            </span>
          </div>
          <p>Use de-identified data only.</p>
          {(unfinishedMiscTasks.length > 0 || openStudyTopics.length > 0 || printContacts.length > 0) && (
            <div className="print-general-notes">
              <strong>{t("print.generalNotes")}</strong>
              {printContacts.length > 0 && (
                <span>
                  {t("print.phonebook")}:{" "}
                  {compactList(
                    printContacts.map((contact) => `${contact.name || contact.roleOrUnit} ${contact.phone}`),
                    printLimits().generalItems,
                    printLimits().detailChars,
                  )}
                </span>
              )}
              {unfinishedMiscTasks.length > 0 && (
                <span>
                  {t("print.miscTasks")}: {compactList(unfinishedMiscTasks.map((task) => task.text), printLimits().generalItems, printLimits().detailChars)}
                </span>
              )}
              {openStudyTopics.length > 0 && (
                <span>
                  {t("print.studyTopics")}: {compactList(openStudyTopics.map((topic) => topic.topic), printLimits().generalItems, printLimits().detailChars)}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="print-patient-list">
          {sectionPatients.map((patient) => {
            const redFlags = compactList(
              clinicalItems(patient.importantRedFlags).map(simpleRedFlagText),
              printLimits().redFlags,
              printLimits().detailChars,
            );
            const redFlagItems = printListItems(redFlags);

            return (
              <article className="print-patient-block" key={patient.id}>
                <div className="print-patient-header">
                  <span className="print-bed">{patient.bed || "-"}</span>
                  <span>
                    <strong>{patient.patientCode || "-"}</strong> {patient.age || "-"}/{patient.sex || "-"}
                  </span>
                  {patient.attending && <span>Att: {patient.attending}</span>}
                  {patient.teamOrService && <span>Svc: {patient.teamOrService}</span>}
                </div>

                {patientContextText(patient) && (
                  <div className="print-patient-context">{patientContextText(patient)}</div>
                )}

                {redFlagItems.length > 0 && (
                  <div className="print-red-flags">
                    <strong>Red Flags:</strong>
                    <ul className="print-soap-list print-red-flag-list">
                      {redFlagItems.map((item, index) => (
                        <li className="print-soap-item print-soap-important" key={`red-${patient.id}-${item.text}-${index}`}>
                          {item.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="print-summary-grid">
                  {sectionBox("S", subjectiveSoapText(patient))}
                  {sectionBox("O", objectiveSoapText(patient), objectiveExtra(patient))}
                  {sectionBox("A/P", assessmentSoapText(patient))}
                  {sectionBox("Tasks / DC", taskDcText(patient))}
                </div>
              </article>
            );
          })}
          {sectionPatients.length === 0 && (
            <div className="print-patient-empty">No active patients selected for this print view.</div>
          )}
        </div>
      </section>
    );
  }

  function renderAdmissionBrief(patient: Patient) {
    const chiefComplaint = patient.chiefComplaint || patient.admissionChiefConcern;
    const hpi = patient.presentIllnessOrHPI || patient.hpiOrAdmissionStory;
    const summary = getAdmissionSummaryText(patient, { allowFallback: false });
    const keyLabs = patient.rawLabText || patient.newLabs || patient.initialLabs;
    const keyImages = patient.newImaging || patient.initialImaging;

    return (
      <section className="print-admission-brief" key={`brief-${patient.id}`}>
        <div className="brief-title">
          <h2>
            Admission Brief: {patient.bed || "-"} / {patient.patientCode || "-"}
          </h2>
          <p>
            {patient.age} / {patient.sex} | Attending: {patient.attending || "-"} | Team: {patient.teamOrService || "-"}
          </p>
        </div>
        <div className="brief-grid">
          <div className="span-2">
            <strong>Chief Concern</strong>
            <ClinicalText value={chiefComplaint} />
          </div>
          <div className="span-2">
            <strong>PI / HPI</strong>
            <ClinicalText value={hpi} />
          </div>
          {summary && (
            <div className="span-2">
              <strong>Concise Admission Summary</strong>
              <ClinicalText value={summary} />
            </div>
          )}
          <div>
            <strong>Key PMH</strong>
            <ClinicalText value={patient.admissionPMH || patient.underlyingDiseases} />
          </div>
          <div>
            <strong>Key Labs / Images</strong>
            <ClinicalText value={[keyLabs ? `Lab: ${keyLabs}` : "", keyImages ? `Image: ${keyImages}` : ""].filter(Boolean).join("\n")} />
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className={`page print-page density-${density}`}>
      <header className="page-header no-print">
        <div>
          <h2>{t("print.title")}</h2>
        </div>
        <button type="button" onClick={() => window.print()}>
          {t("print.print")}
        </button>
      </header>

      <section className="panel no-print print-options">
        <label>
          {t("board.patientScope")}
          <select value={printMode} onChange={(event) => setPrintMode(event.target.value)}>
            <option value="all">{t("board.allActivePatients")}</option>
            <option value="selected">{t("board.selectedAttendingOnly")}</option>
            <option value="separate">{t("board.separateByAttending")}</option>
          </select>
        </label>

        <label>
          {t("print.content")}
          <select
            value={admissionBriefPrintMode}
            onChange={(event) => setAdmissionBriefPrintMode(event.target.value)}
          >
            <option value="compact">{t("print.compactOnly")}</option>
            <option value="newAdmissions">{t("print.withNewAdmissionBriefs")}</option>
            <option value="selectedBriefs">{t("print.withSelectedBriefs")}</option>
            <option value="briefsOnly">{t("print.briefsOnly")}</option>
          </select>
        </label>

        {printMode === "selected" && (
          <label>
            {t("print.selectedAttending")}
            <select value={selectedAttending} onChange={(event) => setSelectedAttending(event.target.value)}>
              <option value="">{t("print.chooseAttending")}</option>
              {attendingNames.map((attendingName) => (
                <option key={attendingName} value={attendingName}>
                  {attendingName}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          {t("print.team")}
          <input value={team} onChange={(event) => setTeam(event.target.value)} />
        </label>

        <label>
          {t("field.attending")}
          <input value={attending} onChange={(event) => setAttending(event.target.value)} />
        </label>

        <label>
          {t("print.resident")}
          <input value={resident} onChange={(event) => setResident(event.target.value)} />
        </label>

        <label>
          {t("action.sort")}
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
            <option value="bed">{t("board.byBed")}</option>
            <option value="dischargeDate">{t("board.byDischargeDate")}</option>
            <option value="urgentFirst">{t("board.urgentFirst")}</option>
          </select>
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={hideCompletedTasks}
            onChange={(event) => setHideCompletedTasks(event.target.checked)}
          />
          {t("action.hideCompleted")}
        </label>

        <label>
          {t("print.density")}
          <select value={density} onChange={(event) => setDensity(event.target.value as PrintDensity)}>
            <option value="normal">{t("print.detailed")}</option>
            <option value="compact">{t("print.compact")}</option>
            <option value="ultra-compact">{t("print.ultraCompact")}</option>
          </select>
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={includePhonebook} onChange={(event) => setIncludePhonebook(event.target.checked)} />
          {t("print.includePhonebook")}
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={includeMiscTasks} onChange={(event) => setIncludeMiscTasks(event.target.checked)} />
          {t("print.includeMiscTasks")}
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={includeStudyTopics} onChange={(event) => setIncludeStudyTopics(event.target.checked)} />
          {t("print.includeStudyTopics")}
        </label>
      </section>

      {admissionBriefPrintMode !== "compact" && (
        <section className="panel no-print">
          <h3>{t("print.preview")}</h3>
          {selectedAdmissionBriefPatients.length === 0 ? (
            <p className="muted">
              {t("print.noBriefs")}
              {emptyAdmissionBriefPatients.length > 0 && " Admission summary is empty and will not be printed."}
            </p>
          ) : (
            <p>
              Admission briefs to be printed:{" "}
              {selectedAdmissionBriefPatients
                .map((patient) => `Bed ${patient.bed || "-"} / Patient code ${patient.patientCode || "-"}`)
                .join(", ")}
              {emptyAdmissionBriefPatients.length > 0 && " Some selected admission summaries are empty and will not be printed."}
            </p>
          )}
        </section>
      )}

      {shouldPrintCompactList &&
        (printMode === "separate"
          ? Object.entries(groupedPatients).map(([sectionAttending, sectionPatients], index) =>
              renderPrintSection(sortPatients(sectionPatients, sortMode), sectionAttending, index > 0),
            )
          : renderPrintSection(
              activePatients,
              printMode === "selected" ? selectedAttending : attending,
            ))}

      {selectedAdmissionBriefPatients.length > 0 && (
        <section className="print-briefs-heading">
          <h1>Section 2: Admission Briefs for New Patients</h1>
          <p>Use de-identified data only.</p>
        </section>
      )}
      {selectedAdmissionBriefPatients.map(renderAdmissionBrief)}
    </div>
  );
}

export default PrintRoundingListPage;
