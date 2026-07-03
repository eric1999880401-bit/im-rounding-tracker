// Collapses duplicate PMH entries where the same disease appears as both the
// full name and its abbreviation (e.g. "diabetes mellitus" + "DM").
// Only whole-item matches collapse; items carrying extra qualifiers
// ("s/p ... 2016", stage details in longer phrases) are left alone.
// Keep in sync with the copy in functions/src/sanitize.ts.

const DISEASE_SYNONYMS: Array<[RegExp, string]> = [
  [/^(?:type\s*(?:2|ii)\s*)?diabetes(?:\s+mellitus)?(?:\s*type\s*(?:2|ii))?$|^t2dm$|^dm$|^dm\s*type\s*(?:2|ii)$/i, "dm"],
  [/^hypertension$|^htn$/i, "htn"],
  [/^hyperlipidemia$|^dyslipidemia$|^hld$/i, "hld"],
  [/^coronary artery disease$|^cad$/i, "cad"],
  [/^atrial fibrillation$|^af$|^a-?fib$/i, "af"],
  [/^chronic obstructive pulmonary disease$|^copd$/i, "copd"],
  [/^(?:congestive\s+)?heart failure$|^chf$|^hf$/i, "hf"],
  [/^chronic kidney disease(?:\s*,?\s*stage\s*[\w]+)?$|^ckd\s*[\w]*$/i, "ckd"],
  [/^end[-\s]stage renal disease$|^esrd$/i, "esrd"],
  [/^gastroesophageal reflux disease$|^gerd$/i, "gerd"],
  [/^benign prostatic hyperplasia$|^bph$/i, "bph"],
  [/^(?:old\s+)?(?:cerebrovascular accident|cva|stroke)$/i, "cva"],
  [/^transient ischemic attack$|^tia$/i, "tia"],
  [/^hypertensive cardiovascular disease$|^hcvd$/i, "hcvd"],
  [/^hepatitis b(?:\s+carrier)?$|^hbv(?:\s+carrier)?$/i, "hbv"],
  [/^hepatitis c$|^hcv$/i, "hcv"],
];

function diseaseKey(item: string) {
  const clean = item.trim().replace(/^and\s+/i, "").replace(/[.。;；]+$/, "");
  for (const [pattern, key] of DISEASE_SYNONYMS) {
    if (pattern.test(clean)) return key;
  }
  return "";
}

function preferredDuplicate(a: string, b: string) {
  // Keep the more informative form (digits/dates/qualifiers), otherwise the
  // shorter abbreviation-style form the user writes by hand.
  const aInfo = /[\d()]/.test(a);
  const bInfo = /[\d()]/.test(b);
  if (aInfo !== bInfo) return aInfo ? a : b;
  return a.length <= b.length ? a : b;
}

export function dedupeDiseaseItems(items: string[]) {
  const kept: string[] = [];
  const byKey = new Map<string, number>();
  items
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const key = diseaseKey(item);
      if (!key) {
        kept.push(item);
        return;
      }
      const existingIndex = byKey.get(key);
      if (existingIndex === undefined) {
        byKey.set(key, kept.length);
        kept.push(item);
        return;
      }
      kept[existingIndex] = preferredDuplicate(kept[existingIndex], item);
    });
  return kept;
}

// Dedupe within a free-text PMH field where diseases are comma-separated on
// one or more lines.
export function dedupeDiseaseText(value: string) {
  if (!value.trim()) return value;
  const allTokens = value
    .split(/\r?\n/)
    .flatMap((line) => line.split(/[,，、;；]/))
    .map((token) => token.trim().replace(/^and\s+/i, ""))
    .filter(Boolean);
  return dedupeDiseaseItems(allTokens).join(", ");
}
