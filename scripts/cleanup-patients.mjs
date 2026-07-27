// One-time stored-data tidy: collapse duplicated PMH entries where the same
// disease appears as both the full name and its abbreviation
// ("diabetes mellitus, HTN, DM, HLD" -> "DM, HTN, HLD"). This is the only field
// this script rewrites — it is deterministic and only removes redundancy.
//
// It deliberately does NOT touch labs (the BUN/Cr parsing bug is fixed at parse
// time, so stored raw text is fine) or A/P text (AI-generated clinical content;
// bulk-rewriting risks losing information).
//
// SAFETY: dry-run by default (prints planned changes, writes nothing). Add
// --apply to write. Back up first: Firebase console -> Firestore -> export, or
// `gcloud firestore export gs://<bucket>`.
//
// Auth uses Application Default Credentials (no service-account key file, which
// your org policy blocks). Run once:
//   gcloud auth application-default login
// Then:
//   node scripts/cleanup-patients.mjs                 # dry-run for the default email
//   node scripts/cleanup-patients.mjs --email=you@x   # dry-run for another account
//   node scripts/cleanup-patients.mjs --apply         # actually write

import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const admin = require(path.resolve(here, "../functions/node_modules/firebase-admin"));

const PROJECT_ID = "im-rounding-tracker";
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const email = (args.find((a) => a.startsWith("--email=")) || "--email=eric1999880401@gmail.com").split("=")[1];
const uidArg = (args.find((a) => a.startsWith("--uid=")) || "").split("=")[1] || "";

// --- Disease synonym dedupe (kept in sync with src/aiPostprocess/diseaseDedupe.ts) ---
const DISEASE_SYNONYMS = [
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

function diseaseKey(item) {
  const clean = item.trim().replace(/^and\s+/i, "").replace(/[.。;；]+$/, "");
  for (const [pattern, key] of DISEASE_SYNONYMS) if (pattern.test(clean)) return key;
  return "";
}

function heartFailureIdentity(item) {
  const clean = item.trim().replace(/^and\s+/i, "").replace(/[.\u3002;\uff1b]+$/, "");
  if (/^(?:congestive\s+)?heart failure$|^chf$|^hf$/i.test(clean)) {
    return { phenotype: "generic", ef: "" };
  }
  const specific = clean.match(/^hf(r|p|mr)ef(?:\s*[([]?\s*(?:ef\s*)?(\d+(?:\.\d+)?)\s*%?\s*[)\]]?)?$/i);
  if (!specific) return undefined;
  return {
    phenotype: specific[1].toLowerCase(),
    ef: specific[2] ? String(Number(specific[2])) : "",
  };
}

function normalizedExactDiseaseItem(item) {
  return item
    .trim()
    .replace(/^and\s+/i, "")
    .replace(/[.\u3002;\uff1b]+$/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function sameDiseaseIdentity(a, b) {
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

function preferredDuplicate(a, b) {
  const aHeartFailure = heartFailureIdentity(a);
  const bHeartFailure = heartFailureIdentity(b);
  if (aHeartFailure?.phenotype === "generic" && bHeartFailure?.phenotype !== "generic") return b;
  if (bHeartFailure?.phenotype === "generic" && aHeartFailure?.phenotype !== "generic") return a;
  const aInfo = /[\d()]/.test(a);
  const bInfo = /[\d()]/.test(b);
  if (aInfo !== bInfo) return aInfo ? a : b;
  return a.length <= b.length ? a : b;
}

function dedupeDiseaseItems(items) {
  const kept = [];
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

function itemsFromField(text, items) {
  if (Array.isArray(items) && items.length > 0) return items.map(String);
  return String(text || "")
    .split(/\r?\n/)
    .flatMap((line) => line.split(/[,，、;；]/))
    .map((token) => token.trim().replace(/^and\s+/i, ""))
    .filter(Boolean);
}

function itemsFromStoredPmh(text, items, legacyText) {
  return [
    ...(Array.isArray(items) ? items.map(String) : []),
    String(text || ""),
    String(legacyText || ""),
  ]
    .flatMap((value) => itemsFromField(value.replace(/[,\uFF0C\u3001;\uFF1B]/g, "\n"), []));
}

export function planPmhCleanup(data) {
  const sourceItems = itemsFromStoredPmh(
    data?.underlyingDiseases,
    data?.underlyingDiseaseItems,
    data?.admissionPMH,
  );
  const underlyingDiseaseItems = dedupeDiseaseItems(sourceItems);
  const underlyingDiseases = underlyingDiseaseItems.join(", ");
  const currentItems = Array.isArray(data?.underlyingDiseaseItems)
    ? data.underlyingDiseaseItems.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  const changed = underlyingDiseases !== String(data?.underlyingDiseases ?? "").trim()
    || underlyingDiseaseItems.length !== currentItems.length
    || underlyingDiseaseItems.some((item, index) => item !== currentItems[index]);
  return {
    changed,
    sourceItems,
    underlyingDiseases,
    underlyingDiseaseItems,
  };
}

async function main() {
  admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();

  let uid = uidArg;
  if (!uid) {
    const user = await admin.auth().getUserByEmail(email);
    uid = user.uid;
  }
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Account: ${email} (uid ${uid})`);
  console.log(`Mode:    ${apply ? "APPLY (writing changes)" : "DRY-RUN (no writes)"}\n`);

  const snap = await db.collection("users").doc(uid).collection("patients").get();
  let changed = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const plan = planPmhCleanup(data);
    const sourceItems = plan.sourceItems;
    const cleaned = plan.underlyingDiseaseItems;
    if (!plan.changed) continue;

    changed += 1;
    const bed = data.bed || data.patientCode || doc.id;
    console.log(`• ${bed}`);
    console.log(`    before: ${sourceItems.join(", ") || "(empty)"}`);
    console.log(`    after:  ${cleaned.join(", ") || "(empty)"}`);

    if (apply) {
      batch.update(doc.ref, {
        underlyingDiseases: cleaned.join(", "),
        underlyingDiseaseItems: cleaned,
        updatedAt: new Date().toISOString(),
      });
      batchCount += 1;
      if (batchCount >= 400) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }
  }

  if (apply && batchCount > 0) await batch.commit();

  console.log(`\n${changed} of ${snap.size} patient(s) ${apply ? "updated" : "would change"}.`);
  if (!apply && changed > 0) console.log("Re-run with --apply to write these changes (back up first).");
  process.exit(0);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("Cleanup failed:", error.message || error);
    process.exit(1);
  });
}
