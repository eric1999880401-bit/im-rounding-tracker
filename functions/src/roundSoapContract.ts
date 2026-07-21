export type RoundSoapObjectivePanel =
  | "CBC/DC"
  | "Chem/Renal"
  | "Liver/Coag"
  | "Infx/Perfusion"
  | "ABG/VBG"
  | "Cardiac"
  | "Other";

export interface StructuredRoundSoapDraft {
  headerLines: string[];
  subjectiveLines: string[];
  objective: {
    vitalSigns: string[];
    physicalExam: string[];
    labs: Array<{ panel: RoundSoapObjectivePanel; values: string; sourceIds: string[] }>;
    microbiology: string[];
    imaging: Array<{ study: string; date: string; finding: string }>;
    pathology: Array<{ date: string; specimen: string; result: string }>;
    other: string[];
  };
  assessmentPlan: Array<{
    problemTitle: string;
    status: "active" | "improving" | "worsening" | "stable" | "uncertain";
    summary: string;
    plan: string;
    sourceEvidence: string[];
  }>;
  orders: string[];
  tasks: string[];
  discharge: string[];
  warnings: string[];
  highlightHints: string[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function lines(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean).slice(0, maxItems);
}

const objectivePanels = new Set<RoundSoapObjectivePanel>([
  "CBC/DC",
  "Chem/Renal",
  "Liver/Coag",
  "Infx/Perfusion",
  "ABG/VBG",
  "Cardiac",
  "Other",
]);

const statuses = new Set<StructuredRoundSoapDraft["assessmentPlan"][number]["status"]>([
  "active",
  "improving",
  "worsening",
  "stable",
  "uncertain",
]);

export function parseStructuredRoundSoapDraft(value: unknown): StructuredRoundSoapDraft {
  const draft = record(value);
  const objective = record(draft.objective);
  return {
    headerLines: lines(draft.headerLines, 8),
    subjectiveLines: lines(draft.subjectiveLines, 8),
    objective: {
      vitalSigns: lines(objective.vitalSigns, 4),
      physicalExam: lines(objective.physicalExam, 6),
      labs: Array.isArray(objective.labs)
        ? objective.labs.map((item) => {
            const lab = record(item);
            const panel = text(lab.panel) as RoundSoapObjectivePanel;
            return {
              panel: objectivePanels.has(panel) ? panel : "Other" as const,
              values: text(lab.values),
              sourceIds: lines(lab.sourceIds, 20),
            };
          }).filter((item) => item.values).slice(0, 8)
        : [],
      microbiology: lines(objective.microbiology, 6),
      imaging: Array.isArray(objective.imaging)
        ? objective.imaging.map((item) => {
            const image = record(item);
            return { study: text(image.study), date: text(image.date), finding: text(image.finding) };
          }).filter((item) => item.study && item.finding).slice(0, 8)
        : [],
      pathology: Array.isArray(objective.pathology)
        ? objective.pathology.map((item) => {
            const pathology = record(item);
            return { date: text(pathology.date), specimen: text(pathology.specimen), result: text(pathology.result) };
          }).filter((item) => item.result).slice(0, 6)
        : [],
      other: lines(objective.other, 6),
    },
    assessmentPlan: Array.isArray(draft.assessmentPlan)
      ? draft.assessmentPlan.map((item) => {
          const problem = record(item);
          const status = text(problem.status) as StructuredRoundSoapDraft["assessmentPlan"][number]["status"];
          return {
            problemTitle: text(problem.problemTitle),
            status: statuses.has(status) ? status : "uncertain" as const,
            summary: text(problem.summary),
            plan: text(problem.plan),
            sourceEvidence: lines(problem.sourceEvidence, 5),
          };
        }).filter((item) => item.problemTitle).slice(0, 8)
      : [],
    orders: lines(draft.orders, 10),
    tasks: lines(draft.tasks, 8),
    discharge: lines(draft.discharge, 6),
    warnings: lines(draft.warnings, 10),
    highlightHints: lines(draft.highlightHints, 12),
  };
}

function bulletLines(values: string[], prefix = "- ") {
  return values.map((value) => `${prefix}${value}`);
}

export function formatStructuredRoundSoapDraft(draft: StructuredRoundSoapDraft) {
  const objectiveLines = [
    ...bulletLines(draft.objective.vitalSigns.map((value) => `V/S: ${value}`)),
    ...bulletLines(draft.objective.physicalExam.map((value) => `PE: ${value}`)),
    ...bulletLines(draft.objective.labs.map((item) => `Lab: ${item.panel}: ${item.values}`)),
    ...bulletLines(draft.objective.microbiology.map((value) => `Lab: Micro: ${value}`)),
    ...bulletLines(draft.objective.imaging.map((item) => `Image: ${[item.study, item.date].filter(Boolean).join(" ")}: ${item.finding}`)),
    ...bulletLines(draft.objective.pathology.map((item) => `Pathology: ${[item.specimen, item.date].filter(Boolean).join(" ")}: ${item.result}`)),
    ...bulletLines(draft.objective.other),
  ];
  const apLines = draft.assessmentPlan.flatMap((problem) => [
    `# ${problem.problemTitle}`,
    ...bulletLines([problem.summary, problem.plan].filter(Boolean)),
  ]);
  const taskLines = [
    ...bulletLines(draft.orders.map((value) => `Order: ${value.replace(/^Order\s*:\s*/i, "")}`)),
    ...bulletLines(draft.tasks),
  ];
  return [
    ...draft.headerLines,
    "S:",
    ...bulletLines(draft.subjectiveLines),
    "O:",
    ...objectiveLines,
    "A/P:",
    ...apLines,
    "Tasks:",
    ...taskLines,
    "DC:",
    ...bulletLines(draft.discharge),
  ].join("\n").trim();
}
