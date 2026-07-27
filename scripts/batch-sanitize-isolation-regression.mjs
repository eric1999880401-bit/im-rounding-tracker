import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { sanitizePatientBatchOutput } = require("../functions/lib/sanitize.js");

const fakeMultiPatientSource = [
  "Patient A Bed A1: AIS NIHSS 3; BP 180/90, permissive HTN.",
  "Patient B Bed B2: severe headache; BP 200/110, urgent uncontrolled hypertension.",
].join("\n");

const drafts = sanitizePatientBatchOutput(
  {
    drafts: [
      {
        id: "fake-a",
        bed: "A1",
        patientCode: "FAKE-A",
        primaryDiagnosis: "AIS",
        vitalSigns: "BP 180/90",
        importantRedFlags: "BP 180/90 urgent uncontrolled",
        tasks: [
          { text: "Urgent BP control", priority: "urgent", category: "medication", dueDate: "" },
        ],
      },
      {
        id: "fake-b",
        bed: "B2",
        patientCode: "FAKE-B",
        primaryDiagnosis: "Hypertensive emergency",
        oneLiner: "Severe headache with BP 200/110",
        vitalSigns: "BP 200/110",
        importantRedFlags: "BP 200/110 urgent uncontrolled; call senior now",
        tasks: [
          { text: "Urgent BP control", priority: "urgent", category: "medication", dueDate: "" },
        ],
      },
    ],
  },
  fakeMultiPatientSource,
  [],
);

const strokeDraft = drafts.find((draft) => draft.id === "fake-a");
const hypertensionDraft = drafts.find((draft) => draft.id === "fake-b");
assert.ok(strokeDraft && hypertensionDraft, "both fake patients must survive batch sanitization");
assert.doesNotMatch(
  strokeDraft.importantRedFlags,
  /BP 180\/90 urgent uncontrolled/i,
  "the AIS patient's own permissive-BP false alarm may be suppressed",
);
assert.equal(strokeDraft.tasks.length, 0, "the AIS patient's own generic urgent BP task may be suppressed");
assert.match(
  hypertensionDraft.importantRedFlags,
  /BP 200\/110 urgent uncontrolled/i,
  "another patient's AIS context must never suppress this patient's urgent BP warning",
);
assert.ok(
  hypertensionDraft.tasks.some((task) => /urgent BP control/i.test(task.text)),
  "another patient's AIS context must never suppress this patient's urgent BP task",
);

console.log("OK multi-patient batch sanitizer keeps stroke BP context isolated per draft");
