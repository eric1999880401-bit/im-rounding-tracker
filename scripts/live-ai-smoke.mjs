import fs from "node:fs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { deleteDoc, doc, getFirestore, setDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

function readEnvFile(path = ".env") {
  if (!fs.existsSync(path)) return;
  const lines = fs.readFileSync(path, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) return;
    const [, key, rawValue] = match;
    if (process.env[key]) return;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  });
}

function requiredFirebaseConfig() {
  return {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
  };
}

function missingConfigKeys(config) {
  return Object.entries(config)
    .filter(([, value]) => !String(value ?? "").trim())
    .map(([key]) => key);
}

function readableCallableError(error) {
  const value = error ?? {};
  const code = typeof value === "object" && "code" in value ? String(value.code) : "";
  const message = typeof value === "object" && "message" in value ? String(value.message) : error instanceof Error ? error.message : String(error);
  const details = typeof value === "object" && "details" in value ? String(value.details ?? "") : "";
  const text = [code, message, details].filter(Boolean).join(" | ");
  if (/internal$/i.test(code) && (!message || /^internal$/i.test(message))) {
    throw new Error(`Callable returned unreadable internal error: ${text}`);
  }
  if (/internal/i.test(message) && !/Firebase Functions|OpenAI|schema|model|key|quota|rate|logs/i.test(message)) {
    throw new Error(`Callable error is still too opaque: ${text}`);
  }
  return text || "unknown callable error";
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSoap(result, label) {
  const soapText = String(result?.soapText ?? "");
  assert(/^S:/im.test(soapText), `${label}: missing S section\n${soapText}`);
  assert(/^O:/im.test(soapText), `${label}: missing O section\n${soapText}`);
  assert(/^A\/P:/im.test(soapText), `${label}: missing A/P section\n${soapText}`);
  assert(!/\b(rule label|monitor closely|review VTE\/bleed risk)\b/i.test(soapText), `${label}: generic/rule wording leaked\n${soapText}`);
  return soapText;
}

function styleProfile() {
  return {
    styleSummary: [
      "terse clinician shorthand",
      "A/P names problem with status, then plan",
      "moderate abbreviation use",
      "Tasks are concise",
      "Common terms: Abx, f/u, Cx, B/C, DC",
    ],
    apVoice: "terse",
    apOrganization: "problemStatusPlan",
    abbreviationStyle: "moderate",
    preferredTerms: ["Abx", "f/u", "Cx", "B/C", "DC"],
    taskStyle: "concise",
    sectionOrder: ["Header", "S", "O", "A/P", "Orders", "Tasks", "DC"],
    typicalApProblemCount: 4,
    typicalApLineLimit: 2,
    updatedAt: new Date().toISOString(),
  };
}

readEnvFile();

const config = requiredFirebaseConfig();
const missingConfig = missingConfigKeys(config);
const email = process.env.FIREBASE_E2E_EMAIL || process.env.VITE_E2E_EMAIL;
const password = process.env.FIREBASE_E2E_PASSWORD || process.env.VITE_E2E_PASSWORD;
const requireLive = process.env.REQUIRE_LIVE_AI_SMOKE === "true" || process.argv.includes("--require-live");

if (missingConfig.length > 0 || !email || !password) {
  const message = [
    "Live AI smoke not run because test Firebase credentials/config are missing.",
    missingConfig.length > 0 ? `Missing config: ${missingConfig.join(", ")}` : "",
    !email ? "Missing FIREBASE_E2E_EMAIL." : "",
    !password ? "Missing FIREBASE_E2E_PASSWORD." : "",
    "No patient data was sent.",
  ]
    .filter(Boolean)
    .join(" ");
  if (requireLive) {
    console.error(message);
    process.exit(1);
  }
  console.log(`SKIP ${message}`);
  process.exit(0);
}

const app = initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);
const generateRoundSoap = httpsCallable(functions, "generateRoundSoap");
const pollRoundSoapGeneration = httpsCallable(functions, "pollRoundSoapGeneration");
const generateClinicalDocument = httpsCallable(functions, "generateClinicalDocument");

function pendingRoundSoap(value) {
  return value?.status === "pending" && typeof value?.jobId === "string";
}

async function runRoundSoap(input, timeoutMs = 570_000) {
  const started = await generateRoundSoap({ ...input, supportsBackgroundPolling: true });
  if (!pendingRoundSoap(started.data)) return started;
  const deadline = Date.now() + timeoutMs;
  let pending = started.data;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(800, Math.min(5_000, pending.pollAfterMs || 2_000))));
    const polled = await pollRoundSoapGeneration({ jobId: pending.jobId });
    if (!pendingRoundSoap(polled.data)) return { data: polled.data };
    pending = polled.data;
  }
  throw new Error(`Background SOAP smoke timed out after ${timeoutMs} ms.`);
}

let patientRef;
try {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const uid = credential.user.uid;
  const patientId = `synthetic-ai-smoke-${Date.now()}`;
  patientRef = doc(db, "users", uid, "patients", patientId);
  await setDoc(patientRef, {
    bed: "AI-SMK",
    patientCode: "SYN-AI",
    age: 60,
    sex: "M",
    status: "active",
    primaryDiagnosis: "Synthetic PNA/sepsis test",
    underlyingDiseases: "CKD3; DM",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const baseline = [
    "AI-SMK SYN-AI 60/M",
    "Dx: PNA/sepsis w/ AKI",
    "PMH: CKD3, DM",
    "S:",
    "- cough improving",
    "O:",
    "- V/S: BP 110/70, HR 90, SpO2 95% NC2L",
    "- Lab: WBC 14.2, Cr 1.9",
    "A/P:",
    "# PNA/sepsis, improving",
    "- Ceftriaxone 5/1-, f/u B/C and de-escalation.",
    "# AKI on CKD",
    "- Cr 1.9, f/u I/O and renal-dose meds.",
    "Tasks:",
    "- f/u B/C",
    "DC:",
    "- Pending: O2 and Abx plan.",
  ].join("\n");

  const common = {
    patientId,
    selectedDate: "2026-05-21",
    sourceType: "dailyUpdate",
    deidentifiedConfirmed: true,
    userStyleProfile: styleProfile(),
    patientContext: {
      age: 60,
      sex: "M",
      pmh: ["CKD3", "DM"],
      activeProblems: ["PNA/sepsis", "AKI"],
    },
  };

  const daily = await runRoundSoap({
    ...common,
    workflowMode: "dailyUpdate",
    qualityMode: "highAccuracy",
    currentSoapBaseline: baseline,
    rawText: "V/S only: 2026/05/21 BP 118/72, HR 82, RR 18, SpO2 98% RA, afebrile.",
  });
  const dailySoap = assertSoap(daily.data, "Daily update");
  assert(/BP 118\/72|SpO2 98% RA/i.test(dailySoap), `Daily update did not include new V/S\n${dailySoap}`);
  assert(/Ceftriaxone|f\/u B\/C|AKI on CKD/i.test(dailySoap), `Daily update lost baseline user-style A/P\n${dailySoap}`);
  assert(/^gpt-5\.6(?:-sol(?:-\d{4}-\d{2}-\d{2})?)?$/i.test(String(daily.data?.model ?? "")), `High-quality old-patient smoke did not use GPT-5.6 Sol: ${daily.data?.model}`);

  const clutteredBaseline = baseline.replace(
    "Tasks:",
    [
      "# Hypoxemia",
      "- oxygen improving; continue ceftriaxone and monitor.",
      "# CXR infiltrate",
      "- CXR PNA; continue ceftriaxone and monitor.",
      "Tasks:",
    ].join("\n"),
  );
  const repaired = await runRoundSoap({
    ...common,
    workflowMode: "repairSoap",
    sourceType: "mixed",
    qualityMode: "highAccuracy",
    currentSoapBaseline: clutteredBaseline,
    rawText: "Baseline-only SOAP repair; no new clinical facts were supplied.",
  });
  const repairedSoap = assertSoap(repaired.data, "Repair current SOAP");
  const repairedApTitles = repairedSoap.match(/^#\s+.+$/gm) ?? [];
  assert(repairedApTitles.length <= 4, `Repair current SOAP did not consolidate duplicate A/P blocks\n${repairedSoap}`);
  assert(/Ceftriaxone 5\/1-|f\/u B\/C|AKI/i.test(repairedSoap), `Repair current SOAP lost treatment or active organ problem\n${repairedSoap}`);

  const newSoap = await runRoundSoap({
    ...common,
    workflowMode: "newSoap",
    currentSoapBaseline: "",
    rawText: [
      "Admission: 60/M CKD3 DM, fever cough dyspnea x3d.",
      "V/S 2026/05/21 T 38.1 BP 94/58 HR 112 RR22 SpO2 92% NC3L.",
      "Lab WBC 18.0, Hb 12.0, lactate 3.0, Cr 2.2 from 1.3, K 3.2.",
      "CXR 5/21 RLL PNA.",
      "Order: Meropenem 1 g IV q8h started 5/21-; B/C pending.",
    ].join("\n"),
  });
  const newSoapText = assertSoap(newSoap.data, "New SOAP");
  assert(/Meropenem 1 g IV q8h|B\/C|Cr 2\.2|CXR 5\/21/i.test(newSoapText), `New SOAP lost core evidence/current antibiotic\n${newSoapText}`);
  assert(!/^# .*anemia/im.test(newSoapText), `New SOAP promoted isolated Hb 12 into an anemia A/P\n${newSoapText}`);

  const transfer = await runRoundSoap({
    ...common,
    workflowMode: "transferHandoff",
    currentSoapBaseline: "",
    rawText: [
      "Transfer from ICU after cholangitis septic shock s/p ERCP stent.",
      "ICU course: intubated, norepi, CRRT, Mero/Vanco. Now extubated/off pressor/off CRRT.",
      "Today BP 112/68 HR 96 RR20 SpO2 95% NC2L.",
      "Lab WBC 11 from 24, Cr 2.4 from peak 5.9, K 5.0, Hb 8.5, Plt 70.",
      "CT AP 5/20 biliary stent no abscess; CXR 5/21 aspiration improving.",
      "Need f/u Cx/Abx, renal/UO, O2 wean, AC restart after Hb/Plt review, rehab.",
    ].join("\n"),
  });
  const transferSoap = assertSoap(transfer.data, "Transfer");
  assert(/shock resolved|off pressor|ERCP|Cr 2\.4|AC|rehab/i.test(transferSoap), `Transfer SOAP lost active/resolved distinction\n${transferSoap}`);

  const admissionDocument = await generateClinicalDocument({
    patientId,
    documentType: "admissionSummary",
    rawText: [
      "Admission: 60/M CKD3 DM, fever cough dyspnea x3d.",
      "ED V/S 2026/05/21 T 38.1 BP 94/58 HR 112 RR22 SpO2 92% NC3L.",
      "Lab WBC 18.0, lactate 3.0, Cr 2.2 from 1.3, K 3.2.",
      "CXR 5/21 RLL PNA. B/C drawn then Ceftriaxone/Azithro started.",
      "Current: BP improved after IVF, still O2 NC3L. Pending B/C, sputum Cx, O2 wean, renal-dose meds.",
    ].join("\n"),
    dateFrom: "2026-05-21",
    dateTo: "2026-05-21",
    deidentifiedConfirmed: true,
    storeRawText: false,
    qualityMode: "balanced",
  });
  const documentDraft = admissionDocument.data?.draft ?? {};
  const admissionText = [
    documentDraft.conciseSummary,
    ...(Array.isArray(documentDraft.sections) ? documentDraft.sections.map((section) => `${section?.heading ?? ""} ${section?.content ?? ""}`) : []),
    JSON.stringify(documentDraft.clinicalReasoning ?? {}),
  ].join("\n");
  assert(/PNA|sepsis|lactate|WBC|CXR|Ceftriaxone|Azithro|B\/C|O2|Cr/i.test(admissionText), `Admission summary callable lost core facts\n${admissionText}`);
  assert(!/\b(?:monitor closely|continue current management|clinical correlation|full admission note)\b/i.test(admissionText), `Admission summary callable returned generic filler\n${admissionText}`);

  console.log("PASS live AI smoke: generateRoundSoap Daily/New/Transfer and generateClinicalDocument admissionSummary");
} catch (error) {
  const text = readableCallableError(error);
  console.error(`FAIL live generateRoundSoap smoke: ${text}`);
  process.exitCode = 1;
} finally {
  if (patientRef) {
    await deleteDoc(patientRef).catch(() => undefined);
  }
}
