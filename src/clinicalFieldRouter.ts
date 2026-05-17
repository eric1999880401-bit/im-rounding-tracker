import type { AssessmentPlanItem, Patient, PatientImportDraft } from "./types";
import { safeClinicalLine } from "./utils";

export interface ClinicalFieldCleanupChange {
  field: keyof Patient | keyof PatientImportDraft | "assessmentPlanItems";
  label: string;
  before: string;
  after: string;
  reason: string;
}

const antibioticNames = [
  "teicoplanin",
  "vancomycin",
  "vanco",
  "ceftriaxone",
  "cefepime",
  "cefazolin",
  "ceftazidime",
  "pip/tazo",
  "piperacillin/tazobactam",
  "tazocin",
  "zosyn",
  "meropenem",
  "mero",
  "imipenem",
  "ertapenem",
  "ampicillin/sulbactam",
  "ampicillin",
  "sulbactam",
  "levofloxacin",
  "azithromycin",
  "metronidazole",
  "linezolid",
  "daptomycin",
];

const antibioticPattern = new RegExp(`\\b(?:${antibioticNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");

function cleanText(value: string, maxChars = 220) {
  const clean = value
    .replace(/\[\[(?:red|orange|yellow|blue|green|purple):([\s\S]*?)\]\]/gi, "$1")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
  return safeClinicalLine(clean, maxChars);
}

function splitClinicalText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\.\s+PE\s+/gi, ".\nPE ")
    .replace(/\bPE\s+(?=(?:cachectic|alert|clear|abd|bs|j-?tube|no edema|warm|rrr)\b)/gi, "\nPE ")
    .replace(/([.!?])\s+(?=(?:\d{1,2}\/\d{1,2}|20\d{2}|[A-Z][A-Za-z]|\b(?:BP|HR|RR|SpO2|CT|MRI|CXR|Brain|No|no)\b))/g, "$1\n")
    .split(/\n+|;\s+(?=(?:BP|HR|RR|SpO2|BT|T\s|Temp|CT|MRI|CXR|Brain|B\/C|blood|WBC|Hb|Plt|Cr|Na|K)\b)/i)
    .map((line) => cleanText(line))
    .filter(Boolean);
}

function isLikelyActionLine(value: string) {
  return /\b(?:pending|f\/u|follow|repeat|continue|maintain|start|stop|hold|resume|trend|monitor|check|order|consult|arrange|define|confirm|clarify|review|culture|b\/c|bcx|teicoplanin|abx|antibiotic|j-?tube|feeding|nutrition)\b/i.test(value);
}

function hasSupportedTlsContext(value: string) {
  const clean = removeRuleLabels(value)
    .replace(/\btrend\s+tls\s+labs?\b/gi, " ")
    .replace(/\btls\s*\/\s*onc safety\b/gi, " ");
  const explicitTls = /\b(?:tumou?r lysis|tls concern|tls risk|rasburicase|allopurinol)\b/i.test(clean);
  const tlsSpecificLab = /\b(?:uric acid|phos|phosphate|ldh)\b(?:\s*[:=]?\s*[<>]?\d|\s+(?:high|low|elevated|up|down))/i.test(clean);
  return tlsSpecificLab || (explicitTls && /\b(?:uric acid|phos|phosphate|ldh|rasburicase|allopurinol)\b/i.test(clean));
}

function shouldKeepImportTask(value: string, contextText = "") {
  const context = `${contextText}\n${value}`;
  if (!isLikelyActionLine(value)) return false;
  const hasActionVerb = /\b(?:pending|f\/u|follow|repeat|continue|maintain|start|stop|hold|resume|trend|monitor|check|order|consult|arrange|define|confirm|clarify|review)\b/i.test(value);
  if (/^\s*(?:PE|physical exam)\b/i.test(value) && !hasActionVerb) return false;
  if ((isLabLine(value) || isImageLine(value)) && !/\b(?:pending|f\/u|follow|repeat|review|suggested|culture|b\/c|bcx|teicoplanin|abx|antibiotic)\b/i.test(value)) return false;
  if (/trend\s+tls\s+labs|tls labs|tls\s*\/\s*onc/i.test(value) && !hasSupportedTlsContext(context)) return false;
  if (/cbc diff\/anc|anc\/wbc|fever curve|isolation/i.test(value) && !/\b(?:neutropen|febrile|fever|anc\s*\d|wbc\s*(?:[0-3](?:\.\d+)?|[0-3]\d{2,3}))\b/i.test(context)) return false;
  if (/review\s+vte\/bleed|vte\/bleed risk/i.test(value) && !/\b(?:vte|pe\b|dvt|anticoag|heparin|doac|warfarin|apixaban|bleed|plt|platelet|procedure|biopsy|egd|surgery)\b/i.test(context)) return false;
  if (/transfusion|egd|t&s|ppi|scope/i.test(value) && !hasActionableBleedContext(context)) return false;
  if (/^f\/u pathology\/staging(?:;?\s*review\s+vte\/bleed(?:\s+risk)?)?$/i.test(value.trim())) return false;
  return true;
}

function uniqueLines(...groups: Array<string | string[]>) {
  const seen = new Set<string>();
  const lines: string[] = [];
  groups.flatMap((group) => (Array.isArray(group) ? group : splitClinicalText(group))).forEach((line) => {
    const key = line.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (!key || seen.has(key)) return;
    seen.add(key);
    lines.push(line);
  });
  return lines.join("\n");
}

function compactList(lines: string[], maxItems: number, maxChars = 140) {
  const seen = new Set<string>();
  const next: string[] = [];
  lines.forEach((line) => {
    const clean = cleanText(line, maxChars);
    const key = clean.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (!key || seen.has(key)) return;
    seen.add(key);
    next.push(clean);
  });
  return next.slice(0, maxItems);
}

export function isVitalLine(value: string) {
  const text = value.toLowerCase();
  if (!/\b(?:v\/s|vitals?|bp|hr|rr|spo2|sp02|sat|o2|bt|temp|temperature|t\s*:?\s*\d{2})\b/i.test(value)) return false;
  return /\b(?:bp\s*[:=]?\s*\d{2,3}\s*\/\s*\d{2,3}|hr\s*[:=]?\s*\d{2,3}|rr\s*[:=]?\s*\d{1,2}|spo2\s*[:=]?\s*\d{2,3}|sp02\s*[:=]?\s*\d{2,3}|sat\s*[:=]?\s*\d{2,3}|bt\s*[:=]?\s*\d{2}(?:\.\d)?|temp\s*[:=]?\s*\d{2}(?:\.\d)?|afebrile|fever)\b/i.test(value) &&
    !/\b(?:review|f\/u|follow|target|goal|history of|pmh|ct|mri|cxr|culture)\b/i.test(text);
}

export function isLabLine(value: string) {
  return /\b(?:wbc|anc|hb|hgb|plt|platelet|bun|cr|creatinine|egfr|na|k|ca|mg|p\s*[0-9]|phos|phosphate|albumin|ast|alt|bilirubin|lactate|troponin|bnp|crp|procalcitonin)\b/i.test(value) &&
    /\d/.test(value);
}

export function isImageLine(value: string) {
  return /\b(?:ct|mri|cxr|x-?ray|sonography|sono|ultrasound|us\b|echo|egd|scope|endoscopy|colonoscopy|pet|imaging|image|brain|neck\/chest|abdomen\/pelvis)\b/i.test(value) &&
    !/\b(?:no murmur|bs clear|breath sounds|abd soft|warm ext|edema on exam|alert|clear consciousness)\b/i.test(value);
}

export function isBedsidePhysicalExamLine(value: string) {
  if (isImageLine(value) || isLabLine(value) || isVitalLine(value)) return false;
  if (/\b(?:ich|intracranial|hemorrhage|hydrocephalus|major infarct|brain atrophy|brain\s+ct)\b/i.test(value)) return false;
  return /\b(?:alert|conscious|oriented|cachectic|clear consciousness|murmur|crackle|wheeze|breath sounds|bs clear|abd|soft|tender|guarding|rebound|edema|warm ext|jvp|rrr|nt|pitting|cyanosis)\b/i.test(value);
}

function isLowValueNegativeImage(value: string) {
  return /\b(?:no|without|w\/o|negative for)\s+(?:ich|intracranial hemorrhage|hemorrhage|edema|acute infarct|pleural effusion|hydrocephalus|major infarct)\b/i.test(value) ||
    /\b(?:diffuse|aged)\s+brain\s+atrophy\b/i.test(value) ||
    /\bbrain\s+ct\b[\s\S]{0,60}\b(?:atrophy|no\s+ich|no\s+hemorrhage|no\s+edema)\b/i.test(value) ||
    /\bchemoport\s+tip\b/i.test(value);
}

function isHighValueImage(value: string) {
  if (/\b(?:metasta|necrotic|enlarged|lad|lymph node|ln\b|nodule|ggo|wall thickening|obstruct|abscess|infarct|ich|hemorrhage|effusion|pneumonia|opacity|mass|tumou?r|stent|perforation)\b/i.test(value)) {
    return !isLowValueNegativeImage(value) || /\bmetasta|lad|nodule|wall thickening|mass|tumou?r|abscess|pneumonia|opacity/i.test(value);
  }
  return false;
}

function shouldKeepNegativeImage(value: string, contextText: string) {
  if (!isLowValueNegativeImage(value)) return true;
  return /\b(?:r\/o|rule out|concern for|suspect|neuro|loc|syncope|mental|conscious change|focal|headache)\b/i.test(contextText);
}

export function cleanImageSummary(value: string, contextText = "") {
  const context = `${contextText}\n${value}`;
  const lines = splitClinicalText(value)
    .flatMap((line) => line.split(/\.\s+(?=(?:Brain|CT|MRI|CXR|No|no|Small|stable|bilateral|persistent)\b)/).map((part) => cleanText(part)))
    .filter(Boolean)
    .filter((line) => isImageLine(line) || isHighValueImage(line) || isLowValueNegativeImage(line));
  const highValue = lines.filter(isHighValueImage);
  const lowValue = lines
    .filter((line) => !isHighValueImage(line) && shouldKeepNegativeImage(line, context))
    .map((line) =>
      /\bbrain\s+ct|ct\s+brain|head\s+ct/i.test(line)
        ? cleanText(line.replace(/\bdiffuse\s+brain\s+atrophy,?\s*/i, "").replace(/\baged\s+brain\s+with\s+atrophy,?\s*/i, ""), 120)
        : cleanText(line, 120),
    )
    .filter(Boolean);
  return compactList([...highValue, ...lowValue.slice(0, highValue.length > 0 ? 1 : 2)], 3, 150).join("\n");
}

function normalizeAntibioticName(value: string) {
  const lower = value.toLowerCase();
  if (/teicoplanin/.test(lower)) return "Teicoplanin";
  if (/vancomycin|vanco/.test(lower)) return "Vancomycin";
  if (/ceftriaxone/.test(lower)) return "Ceftriaxone";
  if (/cefepime/.test(lower)) return "Cefepime";
  if (/pip\/tazo|piperacillin\/tazobactam|tazocin|zosyn/.test(lower)) return "Pip/tazo";
  if (/meropenem|mero/.test(lower)) return "Meropenem";
  if (/ampicillin\/sulbactam|sulbactam/.test(lower)) return "Amp/sulbactam";
  if (/azithro/.test(lower)) return "Azithromycin";
  if (/metronidazole/.test(lower)) return "Metronidazole";
  if (/linezolid/.test(lower)) return "Linezolid";
  if (/daptomycin/.test(lower)) return "Daptomycin";
  return cleanText(value, 36).replace(/\b\w/g, (char) => char.toUpperCase());
}

export function extractAntibioticMentions(value: string) {
  return compactList(
    splitClinicalText(value)
      .filter((line) => antibioticPattern.test(line))
      .map((line) => {
        const match = line.match(antibioticPattern);
        const date = line.match(/\b(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}\/\d{1,2})\s*-?/);
        const name = match ? normalizeAntibioticName(match[0]) : "Abx";
        return `${name}${date ? ` ${date[0].replace(/[-/]$/, "-")}` : ""}`;
      }),
    4,
    60,
  );
}

export function specificAntibioticPlan(value: string) {
  const antibiotics = extractAntibioticMentions(value);
  if (antibiotics.length === 0) return "";
  const cultureText = /\b(?:b\/c|blood culture|bcx)\b/i.test(value) ? "f/u B/C clearance" : "f/u Cx";
  const sourceText = /\b(?:port|catheter|line|j-?tube|abscess|obstruct|source control)\b/i.test(value)
    ? "define duration/source control"
    : "define duration/source";
  return `${antibiotics[0]}, ${cultureText}, ${sourceText}`;
}

function routeTextBlock(value: string, contextText = "") {
  const today: string[] = [];
  const vital: string[] = [];
  const pe: string[] = [];
  const labs: string[] = [];
  const images: string[] = [];
  const course: string[] = [];

  splitClinicalText(value).forEach((line) => {
    if (isVitalLine(line)) {
      vital.push(line);
      return;
    }
    if (isImageLine(line) || (isLowValueNegativeImage(line) && !isBedsidePhysicalExamLine(line))) {
      images.push(line);
      return;
    }
    if (isLabLine(line)) {
      labs.push(line);
      return;
    }
    if (isBedsidePhysicalExamLine(line)) {
      pe.push(line);
      return;
    }
    if (antibioticPattern.test(line) || /\b(?:started|stopped|s\/p|procedure|consult|course|shock resolved|responded to|feeding jejunostomy|j-?tube)\b/i.test(line)) {
      course.push(line);
      return;
    }
    today.push(line);
  });

  return {
    today: uniqueLines(today),
    vital: uniqueLines(vital),
    pe: uniqueLines(pe),
    labs: uniqueLines(labs),
    images: cleanImageSummary(uniqueLines(images), contextText),
    course: uniqueLines(course),
  };
}

function hasBacteremiaContext(value: string) {
  return /\b(?:bacteremia|blood culture|b\/c|bcx|mrsa|enterococcus|s\.?\s*haemolyticus)\b/i.test(value);
}

function hasCancerContext(value: string) {
  return /\b(?:scc|cancer|carcinoma|tumou?r|malign|metasta|oncology|chemo|hypopharyngeal|esophageal|tonsillar)\b/i.test(value);
}

function hasTubeNutritionContext(value: string) {
  return /\b(?:j-?tube|jejunostomy|tube feeding|malnutrition|po intolerance|dysphagia)\b/i.test(value);
}

function hasActionableBleedContext(value: string) {
  const hb = value.match(/\b(?:hb|hgb)\s*[:=]?\s*(\d+(?:\.\d+)?)/i)?.[1];
  return /\b(?:active bleed|gi bleed|ugib|melena|hematemesis|hematochezia|transfusion|egd|endoscopy|brbpr)\b/i.test(value) ||
    (hb ? Number(hb) < 8 : false);
}

function removeRuleLabels(value: string) {
  return value.replace(/\b(?:Bacteremia \/ infection|Infection \/ sepsis|Cancer \/ staging-nutrition|Heme\/Onc safety|Stroke \/ neuro deficit|UGIB \/ anemia|Bleeding \/ anemia|Cardio \/ HF \/ rhythm|Hypovolemia\/shock syncope|Malnutrition\/PO intolerance with J-tube feeding)\b/gi, " ");
}

function hasActiveNeuroContext(value: string) {
  const text = removeRuleLabels(value);
  if (/\b(?:no|without|w\/o|negative for)\s+(?:ich|intracranial hemorrhage|hemorrhage|edema|acute infarct|major infarct)\b/i.test(text)) return false;
  return /\b(?:ais|acute ischemic stroke|recent stroke|new stroke|tia|aphasia|hemiplegia|facial droop|new focal|neuro worsening|brain infarct)\b/i.test(text);
}

function hasUnresolvedShockContext(value: string) {
  if (/\b(?:shock|hypotension)\b[\s\S]{0,80}\b(?:resolved|improved|responded to|fluid[- ]responsive)\b/i.test(value)) return false;
  if (/\b(?:responded to|after)\s+(?:iv\s+)?fluids?[\s\S]{0,80}\b(?:shock|hypotension|bp)\b/i.test(value)) return false;
  return /\b(?:shock|pressor|norepi|hypotension|sbp\s*<\s*90|bp\s*[0-8]\d\s*\/)\b/i.test(value);
}

export function cleanActiveProblemText(value: string, contextText = "") {
  const context = `${contextText}\n${value}`;
  const signalContext = removeRuleLabels(context);
  const lines = value
    .replace(/\b(Bacteremia \/ infection|Infection \/ sepsis|Cancer \/ staging-nutrition|Heme\/Onc safety|Stroke \/ neuro deficit|UGIB \/ anemia|Bleeding \/ anemia|Cardio \/ HF \/ rhythm|Hypovolemia\/shock syncope|Malnutrition\/PO intolerance with J-tube feeding)\b/gi, "\n$1\n")
    .split(/\r?\n|;/)
    .map((line) => cleanText(line, 90))
    .filter(Boolean)
    .map((line) => {
      const lower = line.toLowerCase();
      if (/infection|bacteremia|sepsis/.test(lower)) {
        if (hasBacteremiaContext(context) && /mrsa/i.test(context) && /enterococcus/i.test(context)) return "MRSA/Enterococcus bacteremia";
        if (hasBacteremiaContext(context)) return "Bacteremia / infection";
        return "Infection";
      }
      if (/heme\/onc|onc safety|cancer|staging|malign/.test(lower)) {
        if (!hasCancerContext(context)) return "";
        return hasTubeNutritionContext(context) ? "SCC with J-tube nutrition/malnutrition" : "Cancer staging / Onc plan";
      }
      if (/stroke|neuro deficit/.test(lower)) return hasActiveNeuroContext(signalContext) ? "Stroke / neuro deficit" : "";
      if (/ugib|bleeding|anemia/.test(lower)) return hasActionableBleedContext(signalContext) ? "Bleeding / anemia" : /\b(?:hb|hgb)\s*[:=]?\s*(?:8|9|10)\b/i.test(signalContext) ? "Anemia" : "";
      if (/cardio|hf|rhythm/.test(lower)) return /\b(?:hfref|heart failure|afib|rvr|acs|troponin.*(?:rise|elevat)|pulmonary edema)\b/i.test(signalContext) ? "Cardio / HF / rhythm" : "";
      if (/hypovolemia|shock|syncope/.test(lower)) return hasUnresolvedShockContext(signalContext) ? "Shock / hypotension" : "";
      if (/malnutrition|po intolerance|j-?tube|feeding/.test(lower)) return "J-tube nutrition / malnutrition";
      return line;
    })
    .filter(Boolean);

  return compactList(lines, 5, 90).join("\n");
}

function enrichActiveProblems(value: string, context: string) {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (hasBacteremiaContext(context) && !lines.some((line) => /bacteremia|infection/i.test(line))) {
    lines.unshift(/mrsa/i.test(context) && /enterococcus/i.test(context) ? "MRSA/Enterococcus bacteremia" : "Bacteremia / infection");
  }
  if (hasCancerContext(context) && hasTubeNutritionContext(context) && !lines.some((line) => /scc|cancer|onc|nutrition|j-?tube/i.test(line))) {
    lines.push("SCC with J-tube nutrition/malnutrition");
  }
  if (/\b(?:hb|hgb)\s*[:=]?\s*(?:8|9|10)(?:\.\d+)?\b/i.test(context) && !hasActionableBleedContext(removeRuleLabels(context)) && !lines.some((line) => /anemia/i.test(line))) {
    lines.push("Anemia");
  }
  return compactList(lines, 5, 90).join("\n");
}

function shouldDropPlanLine(line: string, contextText: string, title: string) {
  const lower = line.toLowerCase();
  const signalContext = removeRuleLabels(contextText)
    .replace(/review\s+VTE\/bleed(?:\s+risk)?/gi, " ")
    .replace(/\bVTE\/bleed(?:\s+risk)?\b/gi, " ")
    .replace(/f\/u pathology\/staging/gi, " ");
  if (/trend\s+tls\s+labs|tls labs/i.test(lower) && !hasSupportedTlsContext(contextText)) return true;
  if (/review vte\/bleed risk|vte\/bleed/.test(lower) && !/\b(?:vte|pe\b|dvt|anticoag|doac|heparin|apixaban|warfarin|bleed|plt|platelet|procedure)\b/i.test(signalContext)) return true;
  if (/f\/u pathology\/staging|pathology\/staging/.test(lower) && !/onc|cancer|scc|malign|nutrition/i.test(title)) return true;
  if (/onc\/id if fever\/neutro|fever\/neutro/i.test(lower) && !/\b(?:neutropen|anc|wbc\s*[0-3](?:\.\d+)?)\b/i.test(signalContext)) return true;
  if (/egd|transfusion|t&s|ppi|scope/.test(lower) && !hasActionableBleedContext(signalContext)) return true;
  if (/shock|pressor|norepi/.test(lower) && !hasUnresolvedShockContext(signalContext)) return true;
  return false;
}

function apText(item: AssessmentPlanItem) {
  return [item.problemTitle, item.assessmentSummary, ...item.evidenceOrCourseItems, ...item.planItems].join("\n");
}

export function cleanAssessmentPlanItems(items: AssessmentPlanItem[], contextText = "") {
  const antibioticPlan = specificAntibioticPlan(contextText);
  const hasBacteremia = hasBacteremiaContext(contextText);
  const hasCancer = hasCancerContext(contextText);
  const hasTube = hasTubeNutritionContext(contextText);
  const next = items
    .map((item, index) => {
      const originalTitle = cleanText(item.problemTitle, 80);
      const itemContext = `${contextText}\n${apText(item)}`;
      let title = originalTitle
        .replace(/^TLS\s*\/\s*onc safety$/i, hasSupportedTlsContext(itemContext) ? "TLS / onc safety" : hasBacteremia ? "MRSA/Enterococcus bacteremia" : hasTube ? "SCC with J-tube nutrition/malnutrition" : hasCancer ? "Cancer staging / Onc plan" : "")
        .replace(/^Heme\/Onc safety$/i, hasBacteremia ? "MRSA/Enterococcus bacteremia" : hasCancer ? "Cancer staging / Onc plan" : "Heme/Onc")
        .replace(/^Cancer \/ staging-nutrition$/i, hasTube ? "SCC with J-tube nutrition/malnutrition" : "Cancer staging / Onc plan")
        .replace(/^Cardio \/ HF \/ rhythm$/i, "Cardio / HF / rhythm")
        .replace(/^UGIB \/ anemia$/i, "Bleeding / anemia");

      if (/infection|bacteremia|sepsis/.test(title.toLowerCase()) && hasBacteremia && /mrsa/i.test(itemContext) && /enterococcus/i.test(itemContext)) {
        title = "MRSA/Enterococcus bacteremia";
      }
      const signalItemContext = removeRuleLabels(itemContext);
      if (/shock|hypotension/.test(title.toLowerCase()) && !hasUnresolvedShockContext(signalItemContext)) return null;
      if (/bleeding|ugib/.test(title.toLowerCase()) && !hasActionableBleedContext(signalItemContext)) {
        title = /\b(?:hb|hgb)\s*[:=]?\s*(?:8|9|10)\b/i.test(signalItemContext) ? "Anemia" : "";
      }
      if (!title) return null;

      const isInfection = /infection|bacteremia|sepsis/.test(title.toLowerCase());
      const isTls = /tls/i.test(title);
      const isCancer = /onc|cancer|scc|malign|nutrition/.test(title.toLowerCase());
      const evidence = compactList(item.evidenceOrCourseItems, 3, 115);
      const planItems = compactList(
        [
          isInfection && antibioticPlan ? antibioticPlan : "",
          ...item.planItems.filter((line) => !shouldDropPlanLine(line, itemContext, title)),
          isTls && hasSupportedTlsContext(itemContext) ? "trend K/Phos/Ca/uric acid/Cr" : "",
          isCancer && hasTube ? "J-tube feeds/nutrition tolerance" : "",
          isCancer && hasCancer ? "Onc f/u/staging" : "",
        ].filter(Boolean),
        4,
        120,
      );
      const assessmentSummary = isInfection && antibioticPlan
        ? `${title}; ${antibioticPlan}.`
        : isTls && hasSupportedTlsContext(itemContext)
          ? "TLS risk; follow metabolic/renal trend and heme plan."
        : isCancer && hasTube
          ? `${title}; Onc staging plus nutrition route/tolerance.`
          : cleanText(item.assessmentSummary, 125);

      return {
        ...item,
        id: item.id || `ap-clean-${index}`,
        problemTitle: title,
        assessmentSummary,
        evidenceOrCourseItems: evidence,
        planItems,
        order: index,
      };
    })
    .filter((item): item is AssessmentPlanItem => Boolean(item));

  if (hasBacteremia && antibioticPlan && !next.some((item) => /bacteremia|infection|sepsis/i.test(item.problemTitle))) {
    next.unshift({
      id: "ap-clean-bacteremia",
      problemTitle: /mrsa/i.test(contextText) && /enterococcus/i.test(contextText) ? "MRSA/Enterococcus bacteremia" : "Bacteremia / infection",
      assessmentSummary: `Bacteremia/infx; ${antibioticPlan}.`,
      evidenceOrCourseItems: compactList(splitClinicalText(contextText).filter((line) => /bacteremia|blood culture|b\/c|mrsa|enterococcus/i.test(line)), 3, 115),
      planItems: [antibioticPlan],
      category: "activeProblem",
      isImportant: true,
      color: "",
      order: 0,
    });
  }

  return compactAssessmentPlanItems(next);
}

function compactAssessmentPlanItems(items: AssessmentPlanItem[]) {
  const seen = new Set<string>();
  return items
    .filter((item) => {
      const key = item.problemTitle.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6)
    .map((item, index) => ({ ...item, order: index }));
}

export function routePatientImportDraft(draft: PatientImportDraft): PatientImportDraft {
  const contextText = [
    draft.sourceExcerpt,
    draft.primaryDiagnosis,
    draft.oneLiner,
    draft.admissionSummary,
    draft.underlyingDiseases,
    draft.activeProblems,
    draft.hospitalCourseHighlights,
    draft.importantRedFlags,
    draft.dischargePlan,
    draft.tasks.map((task) => task.text).join("\n"),
    draft.antibioticsProceduresConsults.join("\n"),
  ].join("\n");
  const fromToday = routeTextBlock(draft.todayUpdates, contextText);
  const fromVitals = routeTextBlock(draft.vitalSigns, contextText);
  const fromPe = routeTextBlock(draft.physicalExam, contextText);
  const fromLabs = routeTextBlock(draft.labText, contextText);
  const fromImages = routeTextBlock(draft.imageText, contextText);
  const course = uniqueLines(
    draft.hospitalCourseHighlights,
    fromToday.course,
    fromVitals.course,
    fromPe.course,
    fromLabs.course,
    fromImages.course,
    extractAntibioticMentions(`${contextText}\n${draft.hospitalCourseHighlights}`).join("\n"),
  );
  const imageText = cleanImageSummary(
    uniqueLines(draft.imageText, fromToday.images, fromVitals.images, fromPe.images, fromLabs.images, fromImages.images),
    contextText,
  );
  const activeProblems = enrichActiveProblems(
    cleanActiveProblemText(draft.activeProblems, `${contextText}\n${imageText}\n${course}`),
    `${contextText}\n${imageText}\n${course}`,
  );

  return {
    ...draft,
    todayUpdates: uniqueLines(fromToday.today, fromVitals.today, fromPe.today),
    vitalSigns: uniqueLines(fromToday.vital, fromVitals.vital, fromPe.vital, fromLabs.vital, fromImages.vital),
    physicalExam: uniqueLines(fromToday.pe, fromVitals.pe, fromPe.pe),
    labText: uniqueLines(fromToday.labs, fromVitals.labs, fromPe.labs, fromLabs.labs, fromImages.labs),
    imageText,
    hospitalCourseHighlights: course,
    activeProblems,
    tasks: draft.tasks.filter((task) => shouldKeepImportTask(task.text, contextText)).slice(0, 6),
  };
}

function patientContext(patient: Patient) {
  return [
    patient.primaryDiagnosis,
    patient.oneLiner,
    patient.underlyingDiseases,
    patient.activeProblems,
    patient.subjectiveOrChiefConcern,
    patient.vitalSigns,
    patient.physicalExam,
    patient.rawLabText,
    patient.newLabs,
    patient.newImaging,
    patient.hospitalCourseHighlights,
    patient.importantRedFlags,
    patient.dischargePlan,
    patient.tasks.map((task) => task.text).join("\n"),
    patient.assessmentPlanItems.map(apText).join("\n"),
  ].join("\n");
}

function looksLikeGeneratedTask(value: string) {
  return /\b(?:trend\s+tls\s+labs|tls\s+labs|cbc diff\/anc|fever curve|isolation need|review\s+vte\/bleed|transfusion\/t&s|antithrombotic\/statin|track volume\/o2|i\/o\/diuresis response|rate-control plan if present|onc\/id if fever\/neutro)\b/i.test(value);
}

function taskPreviewText(tasks: Patient["tasks"]) {
  return tasks.map((task) => `${task.priority === "urgent" ? "! " : ""}${task.text}`).join("\n");
}

function addChange(
  changes: ClinicalFieldCleanupChange[],
  field: ClinicalFieldCleanupChange["field"],
  label: string,
  before: string,
  after: string,
  reason: string,
) {
  if (before.trim() === after.trim()) return;
  changes.push({ field, label, before, after, reason });
}

export function routePatientClinicalFields(patient: Patient) {
  const context = patientContext(patient);
  const fromSubjective = routeTextBlock(patient.subjectiveOrChiefConcern, context);
  const fromPe = routeTextBlock(patient.physicalExam, context);
  const fromImaging = routeTextBlock(patient.newImaging, context);
  const nextSubjective = uniqueLines(fromSubjective.today);
  const nextVitals = uniqueLines(patient.vitalSigns, fromSubjective.vital, fromPe.vital, fromImaging.vital);
  const nextPe = uniqueLines(fromSubjective.pe, fromPe.pe);
  const nextLabs = uniqueLines(patient.rawLabText, fromSubjective.labs, fromPe.labs, fromImaging.labs);
  const nextImaging = cleanImageSummary(uniqueLines(patient.newImaging, fromSubjective.images, fromPe.images, fromImaging.images), context);
  const nextCourse = uniqueLines(patient.hospitalCourseHighlights, fromSubjective.course, fromPe.course);
  const nextActiveProblems = cleanActiveProblemText(patient.activeProblems, `${context}\n${nextImaging}\n${nextCourse}`);
  const nextAssessmentPlanItems = cleanAssessmentPlanItems(patient.assessmentPlanItems, `${context}\n${nextImaging}\n${nextCourse}`);
  const nextTasks = patient.tasks.filter((task) => {
    if (/^rule-task-/.test(task.id) || looksLikeGeneratedTask(task.text)) {
      return shouldKeepImportTask(task.text, `${context}\n${nextImaging}\n${nextCourse}`);
    }
    return true;
  });

  const changes: ClinicalFieldCleanupChange[] = [];
  addChange(changes, "subjectiveOrChiefConcern", "Subjective / chief concern", patient.subjectiveOrChiefConcern, nextSubjective, "Moved vitals, labs, and report text out of S.");
  addChange(changes, "vitalSigns", "V/S", patient.vitalSigns, nextVitals, "Recovered V/S from mixed AI text.");
  addChange(changes, "physicalExam", "Physical exam", patient.physicalExam, nextPe, "Kept bedside PE only; moved CT/MRI/CXR/EGD text out.");
  addChange(changes, "rawLabText", "Labs", patient.rawLabText, nextLabs, "Moved numeric lab lines into lab text.");
  addChange(changes, "newImaging", "Images", patient.newImaging, nextImaging, "Condensed imaging to high-yield positives plus only relevant negatives.");
  addChange(changes, "hospitalCourseHighlights", "Course", patient.hospitalCourseHighlights, nextCourse, "Preserved treatments/procedures from mixed fields.");
  addChange(changes, "activeProblems", "Active problems", patient.activeProblems, nextActiveProblems, "Converted rule labels into clinical problem short phrases.");
  addChange(
    changes,
    "assessmentPlanItems",
    "A/P",
    patient.assessmentPlanItems.map(apText).join("\n\n"),
    nextAssessmentPlanItems.map(apText).join("\n\n"),
    "Removed generic plans and kept concrete Abx/treatment plans.",
  );
  addChange(changes, "tasks", "Tasks", taskPreviewText(patient.tasks), taskPreviewText(nextTasks), "Removed unsupported generic AI-generated tasks.");

  return {
    patient: {
      ...patient,
      subjectiveOrChiefConcern: nextSubjective,
      vitalSigns: nextVitals,
      physicalExam: nextPe,
      rawLabText: nextLabs,
      newLabs: nextLabs || patient.newLabs,
      newImaging: nextImaging,
      hospitalCourseHighlights: nextCourse,
      activeProblems: nextActiveProblems,
      activeProblemItems: nextActiveProblems.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      assessmentPlanItems: nextAssessmentPlanItems,
      tasks: nextTasks,
    },
    changes,
  };
}

export function hasClinicalFieldPollution(patient: Patient) {
  return routePatientClinicalFields(patient).changes.length > 0;
}
