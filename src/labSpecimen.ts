import { compactLabKey, findLabDictionaryItem, normalizeLabDisplayName } from "./data/labDictionary";
import type { ParsedLabItem } from "./types";

export type LabSpecimenKey =
  | "blood"
  | "urine"
  | "abg"
  | "vbg"
  | "csf"
  | "pleural-fluid"
  | "ascitic-fluid"
  | "synovial-fluid"
  | "pericardial-fluid"
  | "bal"
  | "stool"
  | "other-specimen"
  | "other-fluid";

export interface LabSpecimenIdentity {
  key: LabSpecimenKey;
  label: string;
  explicit: boolean;
  /** Stable comparison scope. Different sites/tubes/samples must never trend together. */
  scopeKey: string;
}

const explicitSpecimens: Array<{
  key: LabSpecimenKey;
  label: string;
  pattern: RegExp;
  leadingPattern: RegExp;
}> = [
  {
    key: "synovial-fluid",
    label: "Joint fluid",
    pattern: /\b(?:synovial(?:\s+fluid)?|joint(?:\s+fluid|\s+aspirate))\b|\u95dc\u7bc0\u6db2|\u95dc\u7bc0\u62bd\u5438\u6db2|\u6ed1\u6db2/i,
    leadingPattern: /^\s*(?:\[\s*)?(?:(?:(?:left|right|bilateral|L|R|Lt|Rt)\.?\s+)?(?:(?:knee|hip|shoulder|elbow|wrist|ankle|hand|foot|finger|toe|sacroiliac|SI|acromioclavicular|AC|temporomandibular|TMJ|MCP|PIP|DIP|MTP)\s+)?(?:synovial(?:\s+fluid)?|joint(?:\s+fluid|\s+aspirate))|(?:\u5de6|\u53f3|\u96d9\u5074)?(?:\u819d|\u9aee|\u80a9|\u8098|\u8155|\u8e1d)?(?:\u95dc\u7bc0\u6db2|\u95dc\u7bc0\u62bd\u5438\u6db2|\u6ed1\u6db2))(?:\s*\])?(?:\s+(?:analysis|study|cell\s*count))?\s*[:=\-]?\s*/i,
  },
  {
    key: "csf",
    label: "CSF",
    pattern: /\b(?:CSF|cerebrospinal(?:\s+|-)?fluid)\b|\u8166\u810a\u9ad3\u6db2/i,
    leadingPattern: /^\s*(?:\[\s*)?(?:CSF\b|cerebrospinal(?:\s+|-)?fluid\b|\u8166\u810a\u9ad3\u6db2)(?:\s+(?:(?:tube|sample|specimen)\s*#?\s*[A-Za-z0-9-]+))?(?:\s*\])?(?:\s+(?:analysis|study|cell\s*count))?\s*[:=\-]?\s*/i,
  },
  {
    key: "pleural-fluid",
    label: "Pleural fluid",
    pattern: /\bpleural(?:\s+fluid|\s+aspirate|\s+effusion)?\b|\u80f8\u6c34|\u808b\u819c\u6db2/i,
    leadingPattern: /^\s*(?:\[\s*)?(?:(?:(?:left|right|bilateral|L|R|Lt|Rt)\.?\s+)?pleural(?:\s+fluid|\s+aspirate|\s+effusion)?|(?:\u5de6|\u53f3|\u96d9\u5074)?(?:\u80f8\u6c34|\u808b\u819c\u6db2))(?:\s*\])?(?:\s+(?:analysis|study|cell\s*count))?\s*[:=\-]?\s*/i,
  },
  {
    key: "ascitic-fluid",
    label: "Ascitic fluid",
    pattern: /\b(?:ascites|ascitic(?:\s+fluid)?|peritoneal(?:\s+fluid|\s+aspirate))\b|\u8179\u6c34|\u8179\u8154\u6db2/i,
    leadingPattern: /^\s*(?:\[\s*)?(?:ascites|ascitic(?:\s+fluid)?|peritoneal(?:\s+fluid|\s+aspirate)|\u8179\u6c34|\u8179\u8154\u6db2)(?:\s+(?:(?:sample|specimen)\s*#?\s*[A-Za-z0-9-]+))?(?:\s*\])?(?:\s+(?:analysis|study|cell\s*count))?\s*[:=\-]?\s*/i,
  },
  {
    key: "pericardial-fluid",
    label: "Pericardial fluid",
    pattern: /\bpericardial(?:\s+|-)?fluid\b|\u5fc3\u5305\u6db2/i,
    leadingPattern: /^\s*(?:\[\s*)?(?:pericardial(?:\s+|-)?fluid|\u5fc3\u5305\u6db2)(?:\s*\])?(?:\s+(?:analysis|study|cell\s*count))?\s*[:=\-]?\s*/i,
  },
  {
    key: "bal",
    label: "BAL",
    pattern: /\b(?:BAL|bronchoalveolar(?:\s+|-)?lavage(?:\s+fluid)?)\b|\u652f\u6c23\u7ba1\u80ba\u6ce1\u704c\u6d17\u6db2/i,
    leadingPattern: /^\s*(?:\[\s*)?(?:BAL\b|bronchoalveolar(?:\s+|-)?lavage(?:\s+fluid)?\b|\u652f\u6c23\u7ba1\u80ba\u6ce1\u704c\u6d17\u6db2)(?:\s*\])?(?:\s+(?:analysis|study|cell\s*count))?\s*[:=\-]?\s*/i,
  },
  {
    key: "abg",
    label: "ABG",
    pattern: /\b(?:ABG|arterial(?:\s+|-)?blood(?:\s+|-)?gas)\b/i,
    leadingPattern: /^\s*(?:\[\s*)?(?:ABG\b|arterial(?:\s+|-)?blood(?:\s+|-)?gas\b)(?:\s*\])?\s*[:=\-]?\s*/i,
  },
  {
    key: "vbg",
    label: "VBG",
    pattern: /\b(?:VBG|venous(?:\s+|-)?blood(?:\s+|-)?gas)\b/i,
    leadingPattern: /^\s*(?:\[\s*)?(?:VBG\b|venous(?:\s+|-)?blood(?:\s+|-)?gas\b)(?:\s*\])?\s*[:=\-]?\s*/i,
  },
  {
    key: "urine",
    label: "Urine",
    pattern: /\b(?:U\/?A|urine|urinalysis)\b|\u5c3f\u6db2/i,
    leadingPattern: /^\s*(?:\[\s*)?(?:U\/?A\b|urine\b|urinalysis\b|\u5c3f\u6db2)(?:\s*\])?\s*[:=\-]?\s*/i,
  },
  {
    key: "stool",
    label: "Stool",
    pattern: /\b(?:stool|fecal|faecal)\b|\u7cde\u4fbf/i,
    leadingPattern: /^\s*(?:\[\s*)?(?:stool\b|fecal\b|faecal\b|\u7cde\u4fbf)(?:\s*\])?\s*[:=\-]?\s*/i,
  },
  {
    key: "blood",
    label: "Blood",
    pattern: /\b(?:whole\s+blood|blood|serum|plasma)\b|\u5168\u8840|\u8840\u6db2|\u8840\u6e05|\u8840\u6f3f/i,
    leadingPattern: /^\s*(?:\[\s*)?(?:whole\s+blood\b|blood\b|serum\b|plasma\b|\u5168\u8840|\u8840\u6db2|\u8840\u6e05|\u8840\u6f3f)(?:\s*\])?\s*[:=\-]?\s*/i,
  },
];

const bloodContextPattern = /\b(?:blood|serum|plasma|whole\s+blood|CBC(?:\/?DC)?|hematology|chemistry|renal|electrolytes?|coag(?:ulation)?)\b|\u8840\u6db2|\u8840\u6e05|\u8840\u6f3f/i;

function canonicalOtherFluidLabel(value: string) {
  const clean = value
    .replace(/^\s*\[|\]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "Body fluid";
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

function canonicalOtherSpecimenLabel(value: string) {
  return value.replace(/^\s*Specimen\s*:\s*/i, "").replace(/^\s*\[|\]\s*$/g, "").replace(/\s+/g, " ").trim() || "Specimen";
}

function isPresentationPanelTitle(value: string) {
  return /^(?:lab(?:s|oratory)?|CBC(?:\/?DC)?|DC|hematology|chem(?:istry)?|chem\s*\/\s*renal|metabolic|renal|electrolytes?|liver|LFT|liver\s*\/\s*coag|coag(?:ulation)?|cardiac|thyroid|endocrine|tumou?r(?: markers?)?|drug levels?|inflammation|infection|infx\s*\/\s*perfusion|fluid studies?|urinalysis|U\/?A|ABG\s*\/\s*VBG|other(?: labs?)?|special(?: labs?)?)$/i.test(value.trim());
}

function looksLikeAssayToken(value: string) {
  const clean = value.trim();
  return clean.length <= 40 && !/\s{2,}/.test(clean) && /[\d+\-\u0370-\u03ff]/u.test(clean);
}

function analyteAtResultStart(value: string) {
  const text = value.trim();
  const result = text.match(/^(.{1,60}?)\s*(?::|=)?\s*(?:[<>]?\s*-?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d+)?(?:e[+-]?\d+)?%?\+?|positive|negative|pos|neg|present|absent|detected|not detected|pending|no growth)(?=\s|[,;|/]|$)/i);
  return result?.[1].trim() || "";
}

function looksLikeKnownAnalyteResult(value: string) {
  const analyte = analyteAtResultStart(value);
  if (!analyte) return false;
  return Boolean(findLabDictionaryItem(analyte) || looksLikeAssayToken(analyte));
}

export function isAmbiguousSpecimenUsage(value: unknown) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(?:whole\s+blood|blood|serum|plasma|fluid)\s+(.+)$/i);
  if (!match) return false;
  const remainder = match[1].trim();
  const analyte = analyteAtResultStart(remainder);
  if (analyte) return !findLabDictionaryItem(analyte) && !looksLikeAssayToken(analyte);
  return !findLabDictionaryItem(remainder) && !looksLikeAssayToken(remainder);
}

function genericFluidMatch(value: string) {
  const match = String(value ?? "").match(
    /\b([A-Za-z][A-Za-z0-9 /-]{0,28}(?:(?:\s+|-)fluid|\s+aspirate|\s+effusion|\s+drain)|(?:[A-Za-z][A-Za-z0-9 /-]{0,28}\s+)?dialysate|amniotic(?:\s+|-)fluid|bile|drain|aspirate|effusion)\b|(\u5f15\u6d41\u6db2|\u81bd\u6c41|\u8179\u819c\u900f\u6790\u6db2|\u7f8a\u6c34)/i,
  );
  const label = match?.[1] || match?.[2];
  if (!match || !label || /\b(?:iv|intravenous|maintenance|resuscitation)\s+fluid\b/i.test(label)) return null;
  return { match, label };
}

function dynamicUntitledSpecimenMatch(value: string) {
  const text = String(value ?? "").trim();
  const wholeResult = text.match(/^(.{1,80}?)\s*(?:[:=]\s*)?[<>]?\s*-?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d+)?(?:e[+-]?\d+)?%?\+?(?=\s|[,;|/]|$)/i);
  if (wholeResult && findLabDictionaryItem(wholeResult[1].trim())) return null;
  const boundaries = [...text.matchAll(/\s+/g)]
    .map((match) => (match.index ?? -1) + match[0].length)
    .reverse();
  for (const boundary of boundaries) {
    const prefix = text.slice(0, boundary).trim().replace(/^\[|\]$/g, "");
    const body = text.slice(boundary).trim();
    if (!prefix || !body || prefix.length > 50 || isPresentationPanelTitle(prefix)) continue;
    // Without punctuation, only a specimen-shaped noun phrase may establish
    // scope. This avoids turning analyte modifiers such as "Random glucose",
    // "Ionized Ca", or "Morning cortisol" into fake specimens.
    if (!/\b(?:specimen|sample|swab|aspirate|fluid|effluent|lavage|washing|drainage|pus|sputum|semen|wound|marrow|saliva|biopsy)\b$/i.test(prefix)) continue;
    const numericResult = body.match(/^(.{1,60}?)\s*(?:[:=]\s*)?([<>]?\s*-?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d+)?(?:e[+-]?\d+)?%?\+?)(?=\s|[,;|/]|$)/i);
    const qualitativeResult = body.match(/^(.{1,60}?)\s*(?::|=)?\s*(positive|negative|pos|neg|present|absent|detected|not detected|pending|no growth)\b/i);
    if (!numericResult && !qualitativeResult) continue;
    const analyte = (numericResult?.[1] || qualitativeResult?.[1] || "").trim();
    // A bare "Fluid" prefix is ambiguous (e.g. fluid restriction). Strong,
    // source-shaped prefixes such as bone marrow, sputum, PD effluent, and
    // wound swab may legitimately carry novel alphabetic analytes.
    if (/^(?:fluid|blood|serum|plasma|whole\s+blood)$/i.test(prefix) &&
        !findLabDictionaryItem(analyte) && !looksLikeAssayToken(analyte)) continue;
    return { label: prefix, body };
  }
  return null;
}

function normalizedScopePart(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function specimenScopeParts(value: string, key: LabSpecimenKey) {
  const text = value.normalize("NFKC");
  const parts: string[] = [];
  const side = text.match(/\b(left|right|bilateral|Lt|Rt|L|R)\.?\b|(?:\u5de6|\u53f3|\u96d9\u5074)/i)?.[0];
  if (side) {
    const compactSide = side.replace(".", "").toLowerCase();
    parts.push(compactSide === "l" || compactSide === "lt" ? "left" : compactSide === "r" || compactSide === "rt" ? "right" : normalizedScopePart(side));
  }

  if (key === "synovial-fluid") {
    const site = text.match(/\b(knee|hip|shoulder|elbow|wrist|ankle|hand|foot|finger|toe|sacroiliac|SI|acromioclavicular|AC|temporomandibular|TMJ|MCP|PIP|DIP|MTP)\b|(?:\u819d|\u9aee|\u80a9|\u8098|\u8155|\u8e1d|\u624b|\u8db3|\u6307|\u8dbe)/i)?.[0];
    if (site) parts.push(normalizedScopePart(site));
  }

  for (const match of text.matchAll(/\b(tube|sample|specimen)\s*#?\s*([A-Za-z0-9-]+)\b/gi)) {
    parts.push(`${match[1].toLowerCase()}-${normalizedScopePart(match[2])}`);
  }
  for (const match of text.matchAll(/\b(site|location)\s*#?\s*[:=-]?\s*([A-Za-z0-9-]+)\b/gi)) {
    parts.push(`site-${normalizedScopePart(match[2])}`);
  }
  return [...new Set(parts.filter(Boolean))];
}

function scopedIdentity(key: LabSpecimenKey, canonicalLabel: string, value: string, explicit: boolean): LabSpecimenIdentity {
  if (!explicit || key === "blood") return { key, label: canonicalLabel, explicit, scopeKey: key };
  if (key === "other-fluid" || key === "other-specimen") {
    const label = key === "other-specimen"
      ? canonicalOtherSpecimenLabel(canonicalLabel)
      : canonicalOtherFluidLabel(canonicalLabel);
    const parts = specimenScopeParts(value, key);
    const scopedLabel = [
      label,
      ...parts.map((part) => part.replace("-", " ")),
    ].join(" ");
    return {
      key,
      label: scopedLabel,
      explicit,
      scopeKey: [key, normalizedScopePart(label) || "unspecified", ...parts].join(":"),
    };
  }
  const parts = specimenScopeParts(value, key);
  const label = parts.length
    ? [
        ...parts
          .filter((part) => !/^(?:tube|sample|specimen)-/.test(part))
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1)),
        canonicalLabel,
        ...parts
          .filter((part) => /^(?:tube|sample|specimen)-/.test(part))
          .map((part) => part.replace("-", " ")),
      ].join(" ")
    : canonicalLabel;
  return { key, label, explicit, scopeKey: [key, ...parts].join(":") };
}

export function labSpecimenIdentityFromText(value: unknown): LabSpecimenIdentity {
  const text = String(value ?? "").trim();
  // This is a dictionary/presentation group, not proof of arterial sampling.
  // Only an explicit ABG or VBG source label may assign that specimen.
  if (/^ABG\s*\/\s*VBG$/i.test(text)) return scopedIdentity("blood", "Blood", text, false);
  const encodedSpecimen = text.match(/^Specimen\s*:\s*(.{1,80})$/i);
  if (encodedSpecimen) {
    return scopedIdentity("other-specimen", canonicalOtherSpecimenLabel(encodedSpecimen[1]), text, true);
  }
  for (const specimen of explicitSpecimens) {
    if (specimen.pattern.test(text)) {
      if (specimen.key === "blood" && isAmbiguousSpecimenUsage(text)) continue;
      return scopedIdentity(specimen.key, specimen.label, text, true);
    }
  }
  const genericFluid = genericFluidMatch(text);
  if (genericFluid) {
    return scopedIdentity("other-fluid", canonicalOtherFluidLabel(genericFluid.label), text, true);
  }
  const titledResult = text.match(/^([^:]{1,80})\s*:\s*(.+)$/);
  if (titledResult && !isPresentationPanelTitle(titledResult[1]) &&
      /(?:[<>]?\s*-?\d|\b(?:positive|negative|pos|neg|present|absent|detected|not detected|pending|no growth)\b)/i.test(titledResult[2])) {
    return scopedIdentity("other-specimen", canonicalOtherSpecimenLabel(titledResult[1]), titledResult[1], true);
  }
  const dynamicUntitled = dynamicUntitledSpecimenMatch(text);
  if (dynamicUntitled) {
    return scopedIdentity("other-specimen", canonicalOtherSpecimenLabel(dynamicUntitled.label), dynamicUntitled.label, true);
  }
  return scopedIdentity("blood", "Blood", text, bloodContextPattern.test(text) && !isAmbiguousSpecimenUsage(text));
}

export function stripLeadingLabSpecimen(value: unknown) {
  const text = String(value ?? "").trim();
  if (/^ABG\s*\/\s*VBG\s*:/i.test(text)) {
    return { identity: scopedIdentity("blood", "Blood", text, false), body: text };
  }
  const encodedSpecimen = text.match(/^\s*Specimen\s*:\s*([^:]{1,80})(?:\s*:\s*|\s+-\s+)(.*)$/i);
  if (encodedSpecimen) {
    return {
      identity: scopedIdentity("other-specimen", canonicalOtherSpecimenLabel(encodedSpecimen[1]), encodedSpecimen[1], true),
      body: encodedSpecimen[2].trim(),
    };
  }
  for (const specimen of explicitSpecimens) {
    const match = text.match(specimen.leadingPattern);
    if (match) {
      let consumed = match[0];
      let initialBody = text.slice(consumed.length);
      if (specimen.key === "blood" && /^culture\b/i.test(initialBody.trim())) continue;
      if (
        specimen.key === "blood" &&
        !/[:=]\s*$/.test(consumed.trim()) &&
        isAmbiguousSpecimenUsage(`${specimen.label} ${initialBody}`)
      ) continue;
      const locationSuffix = specimen.key === "synovial-fluid"
        ? initialBody.match(/^\s*,?\s*(?:(?:(?:left|right|bilateral|L|R|Lt|Rt)\b\.?\s+)?(?:knee|hip|shoulder|elbow|wrist|ankle|hand|foot|finger|toe|sacroiliac|SI|acromioclavicular|AC|temporomandibular|TMJ|MCP|PIP|DIP|MTP)(?:\s+(?:left|right|bilateral|L|R|Lt|Rt)\b\.?)?|(?:left|right|bilateral|L|R|Lt|Rt)\b\.?|(?:\u5de6|\u53f3|\u96d9\u5074)?(?:\u819d|\u9aee|\u80a9|\u8098|\u8155|\u8e1d))\s*[:=\-]?\s*/i)
        : specimen.key === "pleural-fluid"
          ? initialBody.match(/^\s*,?\s*(?:(?:left|right|bilateral|L|R|Lt|Rt)\b\.?|\u5de6|\u53f3|\u96d9\u5074)\s*[:=\-]?\s*/i)
          : null;
      if (locationSuffix) {
        consumed += locationSuffix[0];
        initialBody = text.slice(consumed.length);
      }
      const scopeSuffix = specimen.key === "blood"
        ? null
        : initialBody.match(/^\s*(?:(?:tube|sample|specimen)\s*#?\s*[A-Za-z0-9-]+)\s*[:=\-]?\s*/i);
      consumed += scopeSuffix?.[0] ?? "";
      return {
        identity: scopedIdentity(specimen.key, specimen.label, consumed, true),
        body: text.slice(consumed.length).trim(),
      };
    }
  }
  const generic = text.match(
    /^\s*(?:\[\s*)?([A-Za-z][A-Za-z0-9 /-]{0,28}(?:(?:\s+|-)fluid|\s+aspirate|\s+effusion|\s+drain)|(?:[A-Za-z][A-Za-z0-9 /-]{0,28}\s+)?dialysate|amniotic(?:\s+|-)fluid|bile|drain|aspirate|effusion|\u5f15\u6d41\u6db2|\u81bd\u6c41|\u8179\u819c\u900f\u6790\u6db2|\u7f8a\u6c34)(?:\s+(?:(?:tube|sample|specimen)\s*#?\s*[A-Za-z0-9-]+))?(?:\s*\])?(?:\s+(?:analysis|study|cell\s*count))?\s*[:=\-]?\s*/i,
  );
  if (generic && !/\b(?:iv|intravenous|maintenance|resuscitation)\s+fluid\b/i.test(generic[1])) {
    return {
      identity: scopedIdentity("other-fluid", canonicalOtherFluidLabel(generic[1]), generic[0], true),
      body: text.slice(generic[0].length).trim(),
    };
  }
  const dynamicUntitled = dynamicUntitledSpecimenMatch(text);
  if (dynamicUntitled) {
    return {
      identity: scopedIdentity("other-specimen", canonicalOtherSpecimenLabel(dynamicUntitled.label), dynamicUntitled.label, true),
      body: dynamicUntitled.body,
    };
  }
  return { identity: labSpecimenIdentityFromText(text), body: text };
}

export function isBodyFluidSpecimen(value: LabSpecimenIdentity | LabSpecimenKey) {
  const key = typeof value === "string" ? value : value.key;
  return [
    "csf",
    "pleural-fluid",
    "ascitic-fluid",
    "synovial-fluid",
    "pericardial-fluid",
    "bal",
    "other-fluid",
  ].includes(key);
}

export function isLabSpecimenHeading(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  const stripped = stripLeadingLabSpecimen(text.replace(/^\[|\]$/g, ""));
  return stripped.identity.explicit && stripped.body.replace(/^[:=\-]+\s*/, "") === "";
}

function rawItemLabel(item: Pick<ParsedLabItem, "label" | "name">) {
  return String(item.name || item.label || "").trim();
}

export function labSpecimenIdentityForItem(item: Pick<ParsedLabItem, "label" | "name" | "group">) {
  const groupIdentity = labSpecimenIdentityFromText(item.group);
  const labelIdentity = labSpecimenIdentityFromText(rawItemLabel(item));
  // A specimen stated on the result itself repairs stale presentation groups
  // such as `group: CBC / DC` on a stored `Joint fluid WBC` item.
  if (labelIdentity.explicit && labelIdentity.key !== "blood") {
    if (
      groupIdentity.key === labelIdentity.key &&
      groupIdentity.scopeKey !== groupIdentity.key &&
      labelIdentity.scopeKey === labelIdentity.key
    ) return groupIdentity;
    return labelIdentity;
  }
  if (groupIdentity.explicit && groupIdentity.key !== "blood") return groupIdentity;
  if (labelIdentity.explicit) return labelIdentity;
  return groupIdentity;
}

export function labAnalyteLabelForItem(item: Pick<ParsedLabItem, "label" | "name" | "group">) {
  const rawLabel = rawItemLabel(item);
  const identity = labSpecimenIdentityForItem(item);
  let label = rawLabel;
  if (identity.explicit && identity.key !== "blood") {
    const stripped = stripLeadingLabSpecimen(rawLabel);
    if (stripped.identity.key === identity.key && stripped.body) label = stripped.body;
  }
  if (identity.key === "urine") {
    if (/^(?:UA|urine)\s+WBC$/i.test(label)) label = "WBC";
    else if (/^(?:UA|urine)\s+RBC$/i.test(label)) label = "RBC";
    else if (/^(?:urine\s+)?glucose(?:\s+urine)?$/i.test(label)) label = "Glucose";
    else if (/^(?:urine\s+)?pH(?:\s+urine)?$/i.test(label)) label = "pH";
  }
  return normalizeLabDisplayName(label);
}

export function labAnalyteKeyForItem(item: Pick<ParsedLabItem, "label" | "name" | "group">) {
  const analyte = labAnalyteLabelForItem(item);
  const dictionaryKey = findLabDictionaryItem(analyte)?.key;
  if (dictionaryKey) return dictionaryKey;
  const unicodeKey = normalizedScopePart(analyte);
  if (/[^\x00-\x7F]/.test(analyte) && unicodeKey) return unicodeKey;
  const asciiKey = compactLabKey(analyte).toLowerCase();
  if (asciiKey) return asciiKey;
  return unicodeKey || "unknown";
}

export function labSpecimenScopeKey(identity: LabSpecimenIdentity) {
  return identity.scopeKey || identity.key;
}

export function specimenAwareLabSelectionKey(item: Pick<ParsedLabItem, "label" | "name" | "group">) {
  const specimen = labSpecimenIdentityForItem(item);
  return `${labSpecimenScopeKey(specimen)}|${labAnalyteKeyForItem(item)}`;
}

export function specimenAwareLabDisplayLabel(item: Pick<ParsedLabItem, "label" | "name" | "group">) {
  const specimen = labSpecimenIdentityForItem(item);
  const analyte = labAnalyteLabelForItem(item);
  if (specimen.key === "blood") return analyte;
  if (specimen.key === "urine") {
    if (analyte === "WBC" || analyte === "RBC") return `UA ${analyte}`;
    if (analyte === "Glucose") return "Glucose urine";
    if (analyte === "pH") return "pH urine";
    return `Urine ${analyte}`;
  }
  const raw = rawItemLabel(item);
  if (raw.toLowerCase().startsWith(specimen.label.toLowerCase())) return raw;
  return `${specimen.label} ${analyte}`.trim();
}
