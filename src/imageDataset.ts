import { stripColorMarkup } from "./utils";

export interface CanonicalImageFact {
  id: string;
  study: string;
  date: string;
  evidence: string;
  reportKey: string;
}

export interface CanonicalImageDataset {
  facts: CanonicalImageFact[];
  rejectedNoise: string[];
}

const findingPattern = /\b(?:mass|lesion|tumou?r|cancer|carcinoma|metasta\w*|nodule|opacity|infiltrat\w*|consolidat\w*|effusion|pneumothorax|atelecta\w*|edema|embol\w*|thrombus|hemorrhag\w*|infarct|abscess|obstruct\w*|dilat\w*|thicken\w*|lymphaden\w*|adenopathy|hydronephro\w*|stone|calculus|ascites|cirrho\w*|cholecyst\w*|pancreat\w*|fracture|stent|drain|tube|catheter|biopsy|necrot\w*|no\s+(?:acute|evidence|focal|significant)|negative\s+for)\b|(?:腫瘤|腫塊|結節|浸潤|轉移|積水|肺炎|膿瘍|阻塞|擴張|出血|梗塞|水腫|骨折)/i;
const comparisonNoisePattern = /^(?:this\s+study\s+is\s+)?compared?\s+with|^comparison\s*:|prior\s+examinations?\s+dated/i;
const techniqueNoisePattern = /^(?:technique|protocol|clinical\s+information|indication|radiation\s+dose)\s*:|\b(?:survey|scan)\s+with\s+(?:pre|post|oral|iv)|\bpre\s+and\s+post\s+iv\s+contrast\b|(?:有|無|有\/無)造影劑/i;
const emptyHeadingPattern = /^(?:findings?|impression|conclusion|summary|result)\s*:?\s*$/i;
const introductoryPattern = /\b(?:showed|revealed|demonstrated|as\s+follows)\s*:\s*$/i;
const nonImageSectionPattern = /^(?:S|O|A\/P|AP|CC|HPI|PI|PHx|PMH|Dx|Diagnosis|Imp|Assessment|Plan|Course|History|V\/S|VS|Vitals?|PE|Labs?|Micro|Pathology|Orders?|Meds?|Medication|Tasks?|DC|Discharge|Admission|Last SOAP|SBAR|Description)\s*[:：]/i;

function cleanLine(value: string) {
  return stripColorMarkup(String(value ?? ""))
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/^\s*(?:[-*>•]|\d+[.)])\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clinicalDate(value: string) {
  return value.match(/\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}(?:[-/]20\d{2})?)\b/)?.[1] ?? "";
}

function inferStudy(value: string) {
  const text = value.toLowerCase();
  if (/\b(?:cxr|chest\s+x[- ]?ray)\b/.test(text)) return "CXR";
  if (/\b(?:brain|head)\b[\s\S]{0,40}\bct\b|\bct\b[\s\S]{0,40}\b(?:brain|head)\b/.test(text)) return "Brain CT";
  if (/\b(?:chest|thorax)\b[\s\S]{0,40}\bct\b|\bct\b[\s\S]{0,40}\b(?:chest|thorax)\b/.test(text)) return "Chest CT";
  if (/\b(?:abd(?:omen|ominal)?|pelvis)\b[\s\S]{0,60}\bct\b|\bct\b[\s\S]{0,60}\b(?:abd(?:omen|ominal)?|pelvis)\b/.test(text)) return "CT A/P";
  if (/\bct\b|computed tomography/.test(text)) return "CT";
  if (/\bmri\b/.test(text)) return "MRI";
  if (/\b(?:echo(?:cardiogram)?|tte)\b/.test(text)) return "Echo";
  if (/\b(?:sono(?:graphy)?|ultrasound)\b/.test(text)) return "Ultrasound";
  if (/\bpet\b/.test(text)) return "PET";
  if (/\bercp\b/.test(text)) return "ERCP";
  if (/\begd\b/.test(text)) return "EGD";
  if (/\bcolonoscopy\b/.test(text)) return "Colonoscopy";
  if (/\bbronchoscopy\b/.test(text)) return "Bronchoscopy";
  if (/\bx[- ]?ray\b/.test(text)) return "X-ray";
  return "";
}

function safeIdPart(value: string) {
  return String(value || "image").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "image";
}

function reportKey(study: string, date: string, reportIndex: number) {
  return `${safeIdPart(study)}-${safeIdPart(date || "undated")}-${reportIndex}`;
}

function evidenceBody(value: string, study: string, date: string) {
  let next = value
    .replace(/^(?:Image|Img|Imaging)\s*[:：]\s*/i, "")
    .replace(/^(?:findings?|impression|conclusion|summary|result)\s*[:：]\s*/i, "")
    .trim();
  if (study) next = next.replace(new RegExp(`^${study.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "").trim();
  if (date) next = next.replace(new RegExp(`^${date.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`), "").trim();
  return next.replace(/^[:：,;-]+\s*/, "").trim();
}

export function buildCanonicalImageDataset(value: string): CanonicalImageDataset {
  const lines = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map(cleanLine)
    .filter(Boolean);
  const facts: CanonicalImageFact[] = [];
  const rejectedNoise: string[] = [];
  const seen = new Set<string>();
  let currentStudy = "";
  let currentDate = "";
  let reportIndex = 0;
  let inEvidenceSection = false;
  let currentReportHasEvidence = false;
  let imageContextActive = false;
  let contextLineBudget = 0;

  lines.forEach((line, lineIndex) => {
    if (nonImageSectionPattern.test(line) && !/^(?:Image|Img|Imaging)\s*[:：]/i.test(line)) {
      inEvidenceSection = false;
      currentReportHasEvidence = false;
      imageContextActive = false;
      contextLineBudget = 0;
      currentStudy = "";
      currentDate = "";
      rejectedNoise.push(line);
      return;
    }
    const inferredStudy = inferStudy(line);
    const nextDate = clinicalDate(line);
    const sectionMatch = line.match(/^(findings?|impression|conclusion|summary|result)\s*[:：]\s*(.*)$/i);
    if (inferredStudy && currentReportHasEvidence && (inferredStudy !== currentStudy || Boolean(nextDate && currentDate && nextDate !== currentDate))) {
      reportIndex += 1;
      currentReportHasEvidence = false;
    }
    if (inferredStudy) {
      currentStudy = inferredStudy;
      inEvidenceSection = false;
      imageContextActive = true;
      contextLineBudget = 2;
    }
    // A comparison date belongs to the prior study, not the current report.
    if (nextDate && !comparisonNoisePattern.test(line)) currentDate = nextDate;
    if (sectionMatch) {
      if (!currentStudy) {
        rejectedNoise.push(line);
        return;
      }
      inEvidenceSection = true;
      imageContextActive = true;
      if (!sectionMatch[2].trim()) {
        rejectedNoise.push(line);
        return;
      }
    }

    if (!inferredStudy && !inEvidenceSection && !imageContextActive) {
      rejectedNoise.push(line);
      return;
    }

    const boilerplate = comparisonNoisePattern.test(line) || techniqueNoisePattern.test(line) || emptyHeadingPattern.test(line) || introductoryPattern.test(line);
    const meaningful = findingPattern.test(line);
    if (boilerplate || !meaningful) {
      if (!inferredStudy && !inEvidenceSection && contextLineBudget > 0) {
        contextLineBudget -= 1;
        if (contextLineBudget === 0) imageContextActive = false;
      }
      rejectedNoise.push(line);
      return;
    }

    const evidence = evidenceBody(sectionMatch?.[2] || line, currentStudy, currentDate);
    if (!evidence || !findingPattern.test(evidence) && !inEvidenceSection) {
      rejectedNoise.push(line);
      return;
    }
    const study = currentStudy || inferredStudy || "Image";
    const key = `${study}|${currentDate}|${evidence}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const groupKey = reportKey(study, currentDate, reportIndex);
    facts.push({
      id: `img-${groupKey}-${lineIndex}`,
      study,
      date: currentDate,
      evidence,
      reportKey: groupKey,
    });
    currentReportHasEvidence = true;
    if (!inferredStudy && !inEvidenceSection && contextLineBudget > 0) {
      contextLineBudget -= 1;
      if (contextLineBudget === 0) imageContextActive = false;
    }
  });

  return { facts, rejectedNoise };
}

export function canonicalImageFactsForAi(dataset: CanonicalImageDataset, maxItems = 40) {
  return dataset.facts.slice(0, maxItems).map((fact) =>
    `[${fact.id}]; ${fact.study}${fact.date ? `; date ${fact.date}` : ""}; ${fact.evidence}`,
  );
}

export function imageOutputUsesOnlySourceNumbers(value: string, facts: CanonicalImageFact[]) {
  const sourceNumbers = new Set(facts.flatMap((fact) => `${fact.date} ${fact.evidence}`.match(/-?\d+(?:\.\d+)?/g) ?? []));
  const outputNumbers = String(value ?? "")
    .replace(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/g, "")
    .match(/-?\d+(?:\.\d+)?/g) ?? [];
  return outputNumbers.every((number) => sourceNumbers.has(number));
}

export function canonicalImageFallbackLines(
  dataset: CanonicalImageDataset,
  maxReports = 4,
  excludedReportKeys: ReadonlySet<string> = new Set(),
) {
  const byReport = new Map<string, CanonicalImageFact[]>();
  dataset.facts
    .filter((fact) => !excludedReportKeys.has(fact.reportKey))
    .forEach((fact) => byReport.set(fact.reportKey, [...(byReport.get(fact.reportKey) ?? []), fact]));
  return [...byReport.values()].slice(0, maxReports).map((facts) => {
    const first = facts[0];
    const evidence = facts.slice(0, 2).map((fact) => fact.evidence).join("; ");
    return `${first.study}${first.date ? ` ${first.date}` : ""}: ${evidence}`;
  });
}
