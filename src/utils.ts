import type {
  DischargePrepStatus,
  HighlightLine,
  ParsedLabItem,
  Patient,
  PatientStatus,
  PatientTask,
  SortMode,
} from "./types";

export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function getActivePatients(patients: Patient[]) {
  return patients.filter((patient) => patient.status === "active");
}

export function textToItems(value: string) {
  return value
    .split(/\r?\n|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getUnderlyingDiseaseItems(patient: Patient) {
  return patient.underlyingDiseaseItems.length > 0
    ? patient.underlyingDiseaseItems
    : textToItems(patient.underlyingDiseases);
}

export function getActiveProblemItems(patient: Patient) {
  return patient.activeProblemItems.length > 0
    ? patient.activeProblemItems
    : textToItems(patient.activeProblems);
}

export function summarizeItems(items: string[], fallback = "-") {
  if (items.length === 0) return fallback;
  return items.join("; ");
}

export function splitHighlightLines(value: string): HighlightLine[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const important = line.startsWith("!");
      const text = important ? line.slice(1).trim() : line;

      function parseLine(nextText: string): HighlightLine {
        const kind: HighlightLine["kind"] = /^\d+\./.test(nextText)
          ? "numbered"
          : /^(->|=>|→|⇒)/.test(nextText)
            ? "arrow"
            : nextText.startsWith("-")
              ? "dash"
              : "normal";

        return {
          important,
          kind,
          text: kind === "dash" ? nextText.slice(1).trim() : nextText,
        };
      }

      const inlineArrow = text.match(/(=>|->|→|⇒)/);
      if (inlineArrow?.index && inlineArrow.index > 0) {
        const mainText = text.slice(0, inlineArrow.index).trim();
        const arrowText = `${inlineArrow[1]} ${text.slice(inlineArrow.index + inlineArrow[0].length).trim()}`;
        return [parseLine(mainText), parseLine(arrowText)];
      }

      return [parseLine(text)];
    })
    .filter((line) => line.text);
}

export function importantLines(value: string) {
  return splitHighlightLines(value).filter((line) => line.important);
}

export function plainClinicalText(value: string, fallback = "-") {
  const text = splitHighlightLines(value).map((line) => line.text).join("; ");
  return text || fallback;
}

export function compactClinicalText(value: string, maxLines = 2, fallback = "-") {
  const lines = splitHighlightLines(value);
  if (lines.length === 0) return fallback;

  const important = lines.filter((line) => line.important);
  const normal = lines.filter((line) => !line.important);
  return [...important, ...normal].slice(0, maxLines).map((line) => line.text).join("; ");
}

const labAliases: Record<string, string> = {
  WBC: "WBC",
  HB: "Hb",
  HGB: "Hb",
  PLT: "Plt",
  NEU: "N",
  NEUTROPHIL: "N",
  NA: "Na",
  K: "K",
  CL: "Cl",
  BUN: "BUN",
  CR: "Cr",
  CRE: "Cr",
  GFR: "eGFR",
  EGFR: "eGFR",
  AST: "AST",
  ALT: "ALT",
  BIL: "Tbil",
  TBIL: "Tbil",
  ALP: "ALP",
  ALB: "Alb",
  CRP: "CRP",
  PCT: "PCT",
  OSM: "Osm",
  OSMOLALITY: "Osm",
  GLU: "Glu",
  GLUCOSE: "Glu",
  LE: "LE",
  NITRITE: "Nitrite",
  RBC: "RBC",
  HCT: "Hct",
  DBIL: "D-Bil",
  LACTATE: "Lactate",
  PT: "PT",
  INR: "INR",
  APTT: "aPTT",
  DDIMER: "D-dimer",
  HBA1C: "HbA1c",
  PROTEIN: "Protein",
  KETONE: "Ketone",
  TROPONIN: "Troponin",
  CKMB: "CK-MB",
  BNP: "BNP",
  PH: "pH",
  PCO2: "pCO2",
  HCO3: "HCO3",
  BE: "BE",
  SPO2: "SpO2",
};

export const labCatalog: Array<{ group: string; name: string; unit?: string }> = [
  ...["WBC", "Neu", "Hb", "Hct", "Plt"].map((name) => ({ group: "CBC", name })),
  ...["Na", "K", "Cl", "BUN", "Cr", "eGFR", "Osm"].map((name) => ({ group: "Renal / Electrolytes", name })),
  ...["AST", "ALT", "ALP", "T-Bil", "D-Bil", "Alb"].map((name) => ({ group: "Liver", name })),
  ...["CRP", "PCT", "Lactate"].map((name) => ({ group: "Inflammation / Infection", name })),
  ...["PT", "INR", "aPTT", "D-dimer"].map((name) => ({ group: "Coagulation", name })),
  ...["Glucose", "HbA1c"].map((name) => ({ group: "Glucose / Endocrine", name })),
  ...["UA WBC", "UA RBC", "LE", "Nitrite", "Protein", "Ketone"].map((name) => ({ group: "Urine", name })),
  ...["Troponin", "CK-MB", "BNP"].map((name) => ({ group: "Cardiac", name })),
  ...["pH", "pCO2", "HCO3", "BE", "SpO2"].map((name) => ({ group: "Blood gas", name })),
];

function labGroupFor(label: string) {
  return labCatalog.find((item) => item.name === label)?.group ?? "";
}

function normalizeLabKey(key: string) {
  return labAliases[key.replace(/\./g, "").toUpperCase()] ?? key.replace(/\./g, "");
}

export function parseLabText(value: string): ParsedLabItem[] {
  const items: ParsedLabItem[] = [];

  value.split(/\r?\n/).forEach((rawLine) => {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine) return;

    const important = trimmedLine.startsWith("!");
    const line = important ? trimmedLine.slice(1).trim() : trimmedLine;
    const uaIndex = line.toUpperCase().indexOf("UA:");
    const beforeUa = uaIndex >= 0 ? line.slice(0, uaIndex) : line;
    const uaText = uaIndex >= 0 ? line.slice(uaIndex + 3) : "";
    const pattern = /\b([A-Za-z][A-Za-z.]*)\s*([<>]?[0-9]+(?:\.[0-9]+)?\+?)(?:\s*\(([0-9]+(?:\.[0-9]+)?)\))?/g;

    Array.from(beforeUa.matchAll(pattern)).forEach((match) => {
      const label = normalizeLabKey(match[1]);
      items.push({
        label,
        name: label,
        value: match[2],
        previousValue: match[3],
        group: labGroupFor(label),
        important,
        isImportant: important,
      });
    });

    if (uaText) {
      Array.from(uaText.matchAll(pattern)).forEach((match) => {
        const normalizedLabel = normalizeLabKey(match[1]);
        const label = normalizedLabel === "WBC" || normalizedLabel === "RBC" ? `UA ${normalizedLabel}` : normalizedLabel;
        items.push({
          label,
          name: label,
          value: match[2],
          previousValue: match[3],
          group: "Urine",
          important,
          isImportant: important,
        });
      });
    }
  });

  return items;
}

export function labSummary(items: ParsedLabItem[], fallbackText = "", maxItems = 8) {
  if (items.length === 0) return plainClinicalText(fallbackText, "-");

  const wbc = items.find((item) => item.label === "WBC");
  const neu = items.find((item) => item.label === "N" || item.label === "Neu");
  const cr = items.find((item) => item.label === "Cr");
  const egfr = items.find((item) => item.label === "eGFR");
  const used = new Set<ParsedLabItem>();
  const result: string[] = [];

  if (wbc) {
    used.add(wbc);
    result.push(`WBC ${Number(wbc.value) >= 1000 ? `${(Number(wbc.value) / 1000).toFixed(1)}k` : wbc.value}`);
  }

  if (neu) {
    used.add(neu);
    result.push(`N${neu.value}%`);
  }

  items.forEach((item) => {
    if (used.has(item) || item.group === "Urine" || item.label === "Cr" || item.label === "eGFR") return;
    const prev = item.previousValue ? `(${item.previousValue})` : "";
    result.push(`${item.group ? `${item.group} ` : ""}${item.label}${item.value}${prev}`);
    used.add(item);
  });

  if (cr || egfr) {
    if (cr) used.add(cr);
    if (egfr) used.add(egfr);
    result.push(`Cr ${cr?.value ?? "-"}/eGFR${egfr?.value ?? "-"}`);
  }

  items
    .filter((item) => item.group === "Urine" && !used.has(item))
    .forEach((item) => {
      const prev = item.previousValue ? `(${item.previousValue})` : "";
      result.push(`${item.label}${item.value}${prev}`);
      used.add(item);
    });

  return result.slice(0, maxItems).join(", ") || "-";
}

export function formatLabItem(item: ParsedLabItem) {
  const label = item.name ?? item.label;
  const value =
    label === "WBC" && Number(item.value) >= 1000 ? `${(Number(item.value) / 1000).toFixed(1)}k` : item.value;
  return { label, value, previous: item.previousValue ? `prev ${item.previousValue}` : "" };
}

export function keyLabItems(items: ParsedLabItem[], maxItems = 8) {
  const priority = ["WBC", "Neu", "N", "Hb", "Plt", "Na", "K", "Cr", "eGFR", "Osm", "CRP", "PCT", "UA WBC", "LE"];
  return [...items]
    .sort((a, b) => {
      const importantOrder = Number(!(a.important || a.isImportant)) - Number(!(b.important || b.isImportant));
      if (importantOrder !== 0) return importantOrder;
      const aIndex = priority.includes(a.label) ? priority.indexOf(a.label) : 99;
      const bIndex = priority.includes(b.label) ? priority.indexOf(b.label) : 99;
      return aIndex - bIndex;
    })
    .slice(0, maxItems);
}

export function pendingDischargePrep(patient: Patient) {
  const labels: Array<[DischargePrepStatus, string]> = [
    [patient.dischargeMedsStatus, "meds"],
    [patient.opdAppointmentStatus, "OPD"],
    [patient.diagnosisCertificateStatus, "certificate"],
  ];

  return labels.filter(([status]) => status === "pending").map(([, label]) => label);
}

export function hasUpcomingDischarge(patient: Patient) {
  if (patient.status !== "active" || !patient.dischargeTargetDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const target = new Date(`${patient.dischargeTargetDate}T00:00:00`);
  return target.getTime() === today.getTime() || target.getTime() === tomorrow.getTime();
}

export function dischargePrepText(patient: Patient) {
  const symbol = (status: DischargePrepStatus) =>
    status === "done" ? "\u2713" : status === "notNeeded" ? "N/A" : "\u25a1";

  return `Meds ${symbol(patient.dischargeMedsStatus)} / OPD ${symbol(patient.opdAppointmentStatus)} / Cert ${symbol(
    patient.diagnosisCertificateStatus,
  )}`;
}

export function getAttendingName(patient: Patient) {
  return patient.attending.trim() || "Unassigned attending";
}

export function getActiveAttendingNames(patients: Patient[]) {
  const names = getActivePatients(patients)
    .map((patient) => patient.attending.trim())
    .filter(Boolean);

  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
}

export function groupPatientsByAttending(patients: Patient[]) {
  return patients.reduce<Record<string, Patient[]>>((groups, patient) => {
    const attending = getAttendingName(patient);
    groups[attending] = [...(groups[attending] ?? []), patient];
    return groups;
  }, {});
}

export function getArchivedPatients(patients: Patient[]) {
  return patients.filter(
    (patient) => patient.status === "discharged" || patient.status === "archived",
  );
}

export function getPendingTasks(patient: Patient[]) {
  return patient.flatMap((item) =>
    item.tasks
      .filter((task) => !task.done)
      .map((task) => ({ patient: item, task })),
  );
}

export function hasUrgentPendingTask(patient: Patient) {
  return patient.tasks.some((task) => !task.done && task.priority === "urgent");
}

export function sortPatients(patients: Patient[], sortMode: SortMode) {
  const sortedPatients = [...patients];

  if (sortMode === "bed") {
    return sortedPatients.sort((a, b) => a.bed.localeCompare(b.bed, undefined, { numeric: true }));
  }

  if (sortMode === "dischargeDate") {
    return sortedPatients.sort((a, b) => {
      const dateA = a.dischargeTargetDate || "9999-12-31";
      const dateB = b.dischargeTargetDate || "9999-12-31";
      return dateA.localeCompare(dateB);
    });
  }

  return sortedPatients.sort((a, b) => Number(hasUrgentPendingTask(b)) - Number(hasUrgentPendingTask(a)));
}

export function createTodayFromYesterday(patient: Patient): Patient {
  return {
    ...patient,
    // Keep clinically useful S/O/A/P, course, discharge, attention, and current tasks.
    updatedAt: nowIso(),
  };
}

export function emptyPatient(): Patient {
  const now = nowIso();

  return {
    id: createId("p"),
    bed: "",
    patientCode: "",
    age: 0,
    sex: "M",
    underlyingDiseases: "",
    underlyingDiseaseItems: [],
    attending: "",
    teamOrService: "",
    admissionDate: "",
    primaryDiagnosis: "",
    activeProblems: "",
    activeProblemItems: [],
    admissionChiefConcern: "",
    hpiOrAdmissionStory: "",
    baselineFunction: "",
    admissionPMH: "",
    initialPhysicalExam: "",
    initialLabs: "",
    initialImaging: "",
    initialAssessment: "",
    initialPlan: "",
    earlyHospitalCourse: "",
    admissionBriefNotes: "",
    isNewAdmission: false,
    showAdmissionBriefOnPrint: false,
    physicalExam: "",
    hospitalCourseHighlights: "",
    importantRedFlags: "",
    rawLabText: "",
    parsedLabItems: [],
    dischargeMedsStatus: "pending",
    opdAppointmentStatus: "pending",
    diagnosisCertificateStatus: "pending",
    overnightEvent: "",
    subjectiveOrChiefConcern: "",
    newLabs: "",
    newImaging: "",
    assessment: "",
    plan: "",
    dischargePlan: "",
    dischargeTargetDate: "",
    dischargeBarriers: "",
    specialAttention: "",
    vsOrder: "",
    status: "active",
    tasks: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function emptyTask(): PatientTask {
  return {
    id: createId("t"),
    text: "",
    done: false,
    priority: "normal",
    category: "other",
    dueDate: "",
    createdAt: nowIso(),
    completedAt: "",
  };
}

export function statusLabel(status: PatientStatus) {
  if (status === "active") return "Active";
  if (status === "discharged") return "Discharged";
  return "Archived";
}
