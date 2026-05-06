export type LabValueType = "number" | "text" | "positiveNegative" | "culture" | "ratio";

export interface LabDictionaryItem {
  key: string;
  displayName: string;
  aliases: string[];
  group: string;
  commonUnits: string[];
  valueType: LabValueType;
  isCommon: boolean;
}

function item(
  group: string,
  key: string,
  displayName: string,
  aliases: string[] = [],
  commonUnits: string[] = [],
  valueType: LabValueType = "number",
  isCommon = true,
): LabDictionaryItem {
  return { key, displayName, aliases: [displayName, ...aliases], group, commonUnits, valueType, isCommon };
}

export const labDictionary: LabDictionaryItem[] = [
  item("CBC / DC", "wbc", "WBC", ["white blood cell"]),
  item("CBC / DC", "rbc", "RBC", ["red blood cell"], ["M/uL"]),
  item("CBC / DC", "hb", "Hb", ["Hgb", "Hemoglobin"], ["g/dL"]),
  item("CBC / DC", "hct", "Hct", ["Hematocrit"], ["%"]),
  item("CBC / DC", "mcv", "MCV", [], ["fL"]),
  item("CBC / DC", "mch", "MCH", [], ["pg"]),
  item("CBC / DC", "mchc", "MCHC", [], ["g/dL"]),
  item("CBC / DC", "rdw", "RDW", [], ["%"]),
  item("CBC / DC", "plt", "Plt", ["Platelet", "PLT"], ["k/uL"]),
  item("CBC / DC", "neu", "Neu", ["Neutrophil", "N", "Seg"], ["%"]),
  item("CBC / DC", "lym", "Lym", ["Lymphocyte"], ["%"]),
  item("CBC / DC", "mono", "Mono", ["Monocyte"], ["%"]),
  item("CBC / DC", "eos", "Eos", ["Eosinophil"], ["%"]),
  item("CBC / DC", "baso", "Baso", ["Basophil"], ["%"]),
  item("CBC / DC", "band", "Band", [], ["%"]),

  item("Renal / Electrolytes", "na", "Na", ["Sodium"], ["mmol/L"]),
  item("Renal / Electrolytes", "k", "K", ["Potassium"], ["mmol/L"]),
  item("Renal / Electrolytes", "cl", "Cl", ["Chloride"], ["mmol/L"]),
  item("Renal / Electrolytes", "ca", "Ca", ["Calcium"], ["mg/dL"]),
  item("Renal / Electrolytes", "mg", "Mg", ["Magnesium"], ["mg/dL"]),
  item("Renal / Electrolytes", "p", "P", ["Phosphate", "Phos"], ["mg/dL"]),
  item("Renal / Electrolytes", "bun", "BUN", [], ["mg/dL"]),
  item("Renal / Electrolytes", "cr", "Cr", ["Cre", "Creatinine"], ["mg/dL"]),
  item("Renal / Electrolytes", "egfr", "eGFR", ["GFR"], ["mL/min"]),
  item("Renal / Electrolytes", "osm", "Osm", ["Osmolality", "Osm."], ["mOsm/kg"]),
  item("Renal / Electrolytes", "uric-acid", "Uric acid", ["UA acid"], ["mg/dL"]),

  item("Glucose / Endocrine", "glucose", "Glucose", ["Glu", "Sugar"], ["mg/dL"]),
  item("Glucose / Endocrine", "ac-glucose", "AC glucose", ["AC sugar"], ["mg/dL"]),
  item("Glucose / Endocrine", "pc-glucose", "PC glucose", ["PC sugar"], ["mg/dL"]),
  item("Glucose / Endocrine", "hba1c", "HbA1c", ["A1c", "GlycoHb"], ["%"]),
  item("Glucose / Endocrine", "tsh", "TSH", [], ["uIU/mL"]),
  item("Glucose / Endocrine", "free-t4", "Free T4", ["FT4"], ["ng/dL"]),
  item("Glucose / Endocrine", "t3", "T3", [], ["ng/dL"]),
  item("Glucose / Endocrine", "cortisol", "Cortisol", [], ["ug/dL"]),

  item("Liver / GI", "ast", "AST", ["GOT"], ["U/L"]),
  item("Liver / GI", "alt", "ALT", ["GPT"], ["U/L"]),
  item("Liver / GI", "alp", "ALP", ["Alk-P", "AlkP"], ["U/L"]),
  item("Liver / GI", "ggt", "GGT", ["rGT"], ["U/L"]),
  item("Liver / GI", "t-bil", "T-Bil", ["TBil", "T Bil", "Total bilirubin", "Bilirubin total", "Bil"], ["mg/dL"]),
  item("Liver / GI", "d-bil", "D-Bil", ["DBil", "D Bil", "Direct bilirubin"], ["mg/dL"]),
  item("Liver / GI", "alb", "Alb", ["Albumin"], ["g/dL"]),
  item("Liver / GI", "tp", "Total protein", ["TP"], ["g/dL"]),
  item("Liver / GI", "amylase", "Amylase", [], ["U/L"]),
  item("Liver / GI", "lipase", "Lipase", [], ["U/L"]),
  item("Liver / GI", "nh3", "NH3", ["Ammonia"], ["umol/L"]),

  item("Inflammation / Infection", "crp", "CRP", [], ["mg/dL"]),
  item("Inflammation / Infection", "hscrp", "hsCRP", ["high sensitivity CRP"], ["mg/L"]),
  item("Inflammation / Infection", "esr", "ESR", [], ["mm/hr"]),
  item("Inflammation / Infection", "pct", "PCT", ["Procalcitonin"], ["ng/mL"]),
  item("Inflammation / Infection", "lactate", "Lactate", [], ["mmol/L"]),
  item("Inflammation / Infection", "blood-culture", "Blood culture", ["BCx"], [], "culture"),
  item("Inflammation / Infection", "urine-culture", "Urine culture", ["UCx"], [], "culture"),
  item("Inflammation / Infection", "sputum-culture", "Sputum culture", ["SCx"], [], "culture"),

  item("Coagulation", "pt", "PT", [], ["sec"]),
  item("Coagulation", "inr", "INR", [], []),
  item("Coagulation", "aptt", "aPTT", ["PTT"], ["sec"]),
  item("Coagulation", "d-dimer", "D-dimer", ["DIMER", "D dimer", "D-dimer"], ["ng/mL"]),
  item("Coagulation", "fibrinogen", "Fibrinogen", [], ["mg/dL"]),
  item("Coagulation", "fdp", "FDP", [], ["ug/mL"]),

  item("Urinalysis", "ua-wbc", "UA WBC", ["urine WBC"], ["/HPF"]),
  item("Urinalysis", "ua-rbc", "UA RBC", ["urine RBC"], ["/HPF"]),
  item("Urinalysis", "le", "LE", ["Leukocyte esterase"], [], "positiveNegative"),
  item("Urinalysis", "nitrite", "Nitrite", [], [], "positiveNegative"),
  item("Urinalysis", "protein", "Protein", ["Urine protein"], [], "positiveNegative"),
  item("Urinalysis", "ketone", "Ketone", [], [], "positiveNegative"),
  item("Urinalysis", "glucose-urine", "Glucose urine", ["Urine glucose"], [], "positiveNegative"),
  item("Urinalysis", "sg", "Specific gravity", ["SG"], []),
  item("Urinalysis", "ph-urine", "pH urine", ["urine pH"], []),
  item("Urinalysis", "cast", "Cast", [], [], "text"),
  item("Urinalysis", "bacteria", "Bacteria", [], [], "text"),

  item("Cardiac", "troponin-i", "Troponin I", ["TnI", "hsTnI"], ["ng/L"]),
  item("Cardiac", "troponin-t", "Troponin T", ["TnT", "hsTnT"], ["ng/L"]),
  item("Cardiac", "ck", "CK", ["CPK"], ["U/L"]),
  item("Cardiac", "ck-mb", "CK-MB", ["CKMB"], ["ng/mL"]),
  item("Cardiac", "bnp", "BNP", [], ["pg/mL"]),
  item("Cardiac", "nt-probnp", "NT-proBNP", ["NT proBNP"], ["pg/mL"]),

  item("ABG / VBG", "ph", "pH", [], []),
  item("ABG / VBG", "pco2", "pCO2", [], ["mmHg"]),
  item("ABG / VBG", "po2", "pO2", [], ["mmHg"]),
  item("ABG / VBG", "hco3", "HCO3", ["Bicarbonate"], ["mmol/L"]),
  item("ABG / VBG", "be", "BE", ["Base excess"], ["mmol/L"]),
  item("ABG / VBG", "sao2", "SaO2", [], ["%"]),
  item("ABG / VBG", "spo2", "SpO2", [], ["%"]),

  item("Lipid", "cholesterol", "Cholesterol", ["CHOL", "TC"], ["mg/dL"]),
  item("Lipid", "tg", "TG", ["Triglyceride"], ["mg/dL"]),
  item("Lipid", "hdl", "HDL", [], ["mg/dL"]),
  item("Lipid", "ldl", "LDL", [], ["mg/dL"]),

  item("Anemia / Nutrition", "ferritin", "Ferritin", [], ["ng/mL"]),
  item("Anemia / Nutrition", "iron", "Iron", ["Fe"], ["ug/dL"]),
  item("Anemia / Nutrition", "tibc", "TIBC", [], ["ug/dL"]),
  item("Anemia / Nutrition", "tsat", "Transferrin saturation", ["TSAT"], ["%"]),
  item("Anemia / Nutrition", "folate", "Folate", [], ["ng/mL"]),
  item("Anemia / Nutrition", "b12", "Vitamin B12", ["B12"], ["pg/mL"]),
  item("Anemia / Nutrition", "retic", "Reticulocyte", ["Retic"], ["%"]),

  item("Tumor / Special common", "afp", "AFP", [], ["ng/mL"], "number", false),
  item("Tumor / Special common", "cea", "CEA", [], ["ng/mL"], "number", false),
  item("Tumor / Special common", "ca19-9", "CA19-9", ["CA199"], ["U/mL"], "number", false),
  item("Tumor / Special common", "ca125", "CA125", [], ["U/mL"], "number", false),
  item("Tumor / Special common", "psa", "PSA", [], ["ng/mL"], "number", false),

  item("Drug levels", "vancomycin", "Vancomycin", ["Vanco"], ["ug/mL"]),
  item("Drug levels", "digoxin", "Digoxin", [], ["ng/mL"]),
  item("Drug levels", "phenytoin", "Phenytoin", ["Dilantin"], ["ug/mL"]),
  item("Drug levels", "valproate", "Valproate", ["VPA"], ["ug/mL"]),

  item("Autoimmune common", "ana", "ANA", [], [], "text", false),
  item("Autoimmune common", "anca", "ANCA", [], [], "text", false),
  item("Autoimmune common", "c3", "C3", [], ["mg/dL"], "number", false),
  item("Autoimmune common", "c4", "C4", [], ["mg/dL"], "number", false),
  item("Autoimmune common", "rf", "RF", [], ["IU/mL"], "number", false),
  item("Autoimmune common", "anti-ccp", "Anti-CCP", ["CCP"], ["U/mL"], "number", false),

  item("Other", "ldh", "LDH", [], ["U/L"]),
  item("Other", "myoglobin", "Myoglobin", [], ["ng/mL"], "number", false),
];

export const labCatalog = labDictionary.map((entry) => ({
  group: entry.group,
  name: entry.displayName,
  unit: entry.commonUnits[0] ?? "",
  aliases: entry.aliases,
  isCommon: entry.isCommon,
}));

export function compactLabKey(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

const aliasEntries = labDictionary
  .flatMap((entry) => entry.aliases.map((alias) => ({ alias, compact: compactLabKey(alias), entry })))
  .sort((a, b) => b.compact.length - a.compact.length || a.alias.localeCompare(b.alias));

export function labGroupFor(displayName: string) {
  return labDictionary.find((entry) => entry.displayName === displayName)?.group ?? "";
}

export function findLabDictionaryItem(value: string) {
  const compact = compactLabKey(value);
  return aliasEntries.find((entry) => entry.compact === compact)?.entry;
}

export function normalizeLabDisplayName(value: string) {
  return findLabDictionaryItem(value)?.displayName ?? value.replace(/\.$/, "");
}

function aliasToPattern(alias: string) {
  return alias
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\ | /g, "\\s+")
    .replace(/\\-|-/g, "[\\-\\s]?")
    .replace(/\\\./g, "\\.?");
}

export function labAliasPattern() {
  return aliasEntries.map((entry) => aliasToPattern(entry.alias)).join("|");
}

export function searchLabDictionary(query: string, limit = 12) {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const compactQuery = compactLabKey(trimmed);
  const lowerQuery = trimmed.toLowerCase();

  return labDictionary
    .map((entry) => {
      const displayCompact = compactLabKey(entry.displayName);
      const aliasCompacts = entry.aliases.map(compactLabKey);
      const aliasLower = entry.aliases.map((alias) => alias.toLowerCase());
      let score = 0;

      if (displayCompact === compactQuery) score += 120;
      if (displayCompact.startsWith(compactQuery)) score += 90;
      if (displayCompact.includes(compactQuery)) score += 45;
      if (aliasCompacts.some((alias) => alias === compactQuery)) score += 100;
      if (aliasCompacts.some((alias) => alias.startsWith(compactQuery))) score += 75;
      if (aliasCompacts.some((alias) => alias.includes(compactQuery))) score += 35;
      if (entry.group.toLowerCase().includes(lowerQuery)) score += 20;
      if (entry.isCommon) score += 12;
      score += Math.max(0, 12 - entry.displayName.length / 2);

      return { entry, score };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.displayName.localeCompare(b.entry.displayName))
    .slice(0, limit)
    .map((result) => result.entry);
}
