// Collapses duplicate PMH entries where the same disease appears as both the
// full name and its abbreviation (e.g. "diabetes mellitus" + "DM").
// Only whole-item matches collapse; items carrying extra qualifiers
// ("s/p ... 2016", stage details in longer phrases) are left alone.
// Keep in sync with the copy in functions/src/sanitize.ts.

const DISEASE_SYNONYMS: Array<[RegExp, string]> = [
  [/^(?:type\s*(?:2|ii)\s*)?diabetes(?:\s+mellitus)?(?:\s*type\s*(?:2|ii))?$|^t2dm$|^dm$|^type\s*(?:2|ii)\s*dm$|^dm\s*type\s*(?:2|ii)$/i, "dm"],
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

interface HeartFailureIdentity {
  phenotype: "generic" | "r" | "p" | "mr";
  ef: string;
}

function heartFailureIdentity(item: string): HeartFailureIdentity | undefined {
  const clean = item.trim().replace(/^and\s+/i, "").replace(/[.\u3002;\uff1b]+$/, "");
  if (/^(?:congestive\s+)?heart failure$|^chf$|^hf$/i.test(clean)) {
    return { phenotype: "generic", ef: "" };
  }
  const specific = clean.match(/^hf(r|p|mr)ef(?:\s*[([]?\s*(?:ef\s*)?(\d+(?:\.\d+)?)\s*%?\s*[)\]]?)?$/i);
  if (!specific) return undefined;
  return {
    phenotype: specific[1].toLowerCase() as HeartFailureIdentity["phenotype"],
    ef: specific[2] ? String(Number(specific[2])) : "",
  };
}

function normalizedExactDiseaseItem(item: string) {
  return item
    .trim()
    .replace(/^and\s+/i, "")
    .replace(/[.\u3002;\uff1b]+$/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function sameDiseaseIdentity(a: string, b: string) {
  const aHeartFailure = heartFailureIdentity(a);
  const bHeartFailure = heartFailureIdentity(b);
  if (aHeartFailure || bHeartFailure) {
    if (!aHeartFailure || !bHeartFailure) return false;
    if (aHeartFailure.phenotype === "generic" || bHeartFailure.phenotype === "generic") return true;
    if (aHeartFailure.phenotype !== bHeartFailure.phenotype) return false;
    return !(aHeartFailure.ef && bHeartFailure.ef && aHeartFailure.ef !== bHeartFailure.ef);
  }

  const aKey = diseaseKey(a);
  const bKey = diseaseKey(b);
  if (aKey || bKey) return Boolean(aKey && aKey === bKey);
  return normalizedExactDiseaseItem(a) === normalizedExactDiseaseItem(b);
}

function preferredDuplicate(a: string, b: string) {
  // Keep the more informative form (digits/dates/qualifiers), otherwise the
  // shorter abbreviation-style form the user writes by hand.
  const aHeartFailureSubtype = /^hf(?:r|p|mr)ef\b/i.test(a);
  const bHeartFailureSubtype = /^hf(?:r|p|mr)ef\b/i.test(b);
  if (aHeartFailureSubtype !== bHeartFailureSubtype) return aHeartFailureSubtype ? a : b;
  const aInfo = /[\d()]/.test(a);
  const bInfo = /[\d()]/.test(b);
  if (aInfo !== bInfo) return aInfo ? a : b;
  return a.length <= b.length ? a : b;
}

export function dedupeDiseaseItems(items: string[]) {
  const kept: string[] = [];
  items
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const existingIndex = kept.findIndex((existing) => sameDiseaseIdentity(existing, item));
      if (existingIndex < 0) {
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
