type PatchSection = "header" | "s" | "vs" | "pe" | "lab" | "image" | "ap" | "orders" | "tasks" | "dc";

interface PatchChange {
  section: PatchSection;
  operation: "add" | "update" | "delete";
  beforeText: string;
  afterText: string;
  evidence: string[];
}

function fingerprint(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function cleanLine(value: string) {
  return String(value ?? "").replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
}

function objectiveSection(line: string): PatchSection {
  const text = line.replace(/^!+\s*/, "");
  if (/^(?:v\/s|vs|vitals?)\s*:/i.test(text) || /\b(?:BP|HR|RR|SpO2)\b/i.test(text)) return "vs";
  if (/^(?:lab)\s*:/i.test(text) || /\b(?:WBC|Hb|Plt|Cr|BUN|Na|K\b|AST|ALT|INR|lactate|CRP|culture|B\/C)\b/i.test(text)) return "lab";
  if (/^(?:image|img)\s*:/i.test(text) || /\b(?:CXR|CT\b|MRI|echo|sono|ultrasound)\b/i.test(text)) return "image";
  return "pe";
}

function isOrder(line: string) {
  const text = line.replace(/^!+\s*/, "");
  return /^(?:order|orders?|meds?|藥囑|abx|anticoag\/ap|steroid\/immuno|cardio\/renal|resp|insulin\/glucose|ivf\/lyte|nutrition|monitoring|prn)\s*[:：]/i.test(text);
}

function sections(text: string) {
  const result = new Map<PatchSection, string[]>();
  const add = (section: PatchSection, line: string) => {
    const clean = cleanLine(line);
    if (!clean) return;
    result.set(section, [...(result.get(section) ?? []), clean]);
  };
  let section: "header" | "s" | "o" | "ap" | "tasks" | "dc" = "header";
  String(text ?? "").split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    if (/^(?:S|Subjective)\s*:/i.test(line)) { section = "s"; return; }
    if (/^(?:O|Objective)\s*:/i.test(line)) { section = "o"; return; }
    if (/^(?:A\/P|AP|Assessment\/Plan)\s*:/i.test(line)) { section = "ap"; return; }
    if (/^(?:Tasks?|Orders?|Meds?|藥囑)\s*:/i.test(line)) { section = "tasks"; return; }
    if (/^(?:DC|Discharge)\s*:/i.test(line)) { section = "dc"; return; }
    if (section === "header") add("header", line);
    else if (section === "s") add("s", line);
    else if (section === "o") add(objectiveSection(line), line);
    else if (section === "ap") add("ap", line);
    else if (section === "tasks") add(isOrder(line) ? "orders" : "tasks", line);
    else add("dc", line);
  });
  return result;
}

function sourceEvidence(rawText: string, section: PatchSection) {
  const pattern: Record<PatchSection, RegExp> = {
    header: /\b(?:dx|diagnosis|pmh|code|allergy)\b/i,
    s: /\b(?:pain|dyspnea|sob|fever|cough|n\/v|diarrhea|symptom|overnight)\b/i,
    vs: /\b(?:bp|hr|rr|spo2|temp|v\/s|vital|o2|nc|ra)\b/i,
    pe: /\b(?:pe|exam|crackles|edema|tender|murmur|wheeze)\b/i,
    lab: /\b(?:wbc|hb|plt|cr|bun|na|k\b|ast|alt|inr|lactate|crp|culture|b\/c)\b/i,
    image: /\b(?:cxr|ct\b|mri|echo|sono|ultrasound|image|impression)\b/i,
    ap: /\b(?:assessment|plan|improving|worsening|new|acute|resolved)\b/i,
    orders: /\b(?:order|meds?|abx|start|stop|hold|resume|continue|dose|q\d+h|prn)\b/i,
    tasks: /\b(?:pending|follow|f\/u|repeat|call|consult|arrange|task)\b/i,
    dc: /\b(?:dc|discharge|opd|barrier|placement|certificate)\b/i,
  };
  return String(rawText ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && pattern[section].test(line))
    .slice(0, 2)
    .map((line) => line.slice(0, 180));
}

export function buildSoapPatch(baselineText: string, candidateText: string, rawText: string) {
  const baseline = sections(baselineText);
  const candidate = sections(candidateText);
  const order: PatchSection[] = ["header", "s", "vs", "pe", "lab", "image", "ap", "orders", "tasks", "dc"];
  const changedSections: PatchChange[] = [];
  order.forEach((section) => {
    const beforeText = (baseline.get(section) ?? []).join("\n");
    const afterText = (candidate.get(section) ?? []).join("\n");
    if (beforeText === afterText) return;
    changedSections.push({
      section,
      operation: beforeText && afterText ? "update" : afterText ? "add" : "delete",
      beforeText,
      afterText,
      evidence: sourceEvidence(rawText, section),
    });
  });
  return { baselineHash: fingerprint(String(baselineText ?? "").trim()), changedSections };
}
