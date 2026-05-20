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

  const daily = await generateRoundSoap({
    ...common,
    workflowMode: "dailyUpdate",
    currentSoapBaseline: baseline,
    rawText: "V/S only: 2026/05/21 BP 118/72, HR 82, RR 18, SpO2 98% RA, afebrile.",
  });
  const dailySoap = assertSoap(daily.data, "Daily update");
  assert(/BP 118\/72|SpO2 98% RA/i.test(dailySoap), `Daily update did not include new V/S\n${dailySoap}`);
  assert(/Ceftriaxone|f\/u B\/C|AKI on CKD/i.test(dailySoap), `Daily update lost baseline user-style A/P\n${dailySoap}`);

  const newSoap = await generateRoundSoap({
    ...common,
    workflowMode: "newSoap",
    currentSoapBaseline: "",
    rawText: [
      "Admission: 60/M CKD3 DM, fever cough dyspnea x3d.",
      "V/S 2026/05/21 T 38.1 BP 94/58 HR 112 RR22 SpO2 92% NC3L.",
      "Lab WBC 18.0, lactate 3.0, Cr 2.2 from 1.3, K 3.2.",
      "CXR 5/21 RLL PNA.",
      "Started Ceftriaxone; B/C pending.",
    ].join("\n"),
  });
  const newSoapText = assertSoap(newSoap.data, "New SOAP");
  assert(/Ceftriaxone|B\/C|Cr 2\.2|CXR 5\/21/i.test(newSoapText), `New SOAP lost core evidence\n${newSoapText}`);

  const transfer = await generateRoundSoap({
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

  console.log("PASS live generateRoundSoap smoke: Daily update, New SOAP, Transfer");
} catch (error) {
  const text = readableCallableError(error);
  console.error(`FAIL live generateRoundSoap smoke: ${text}`);
  process.exitCode = 1;
} finally {
  if (patientRef) {
    await deleteDoc(patientRef).catch(() => undefined);
  }
}
