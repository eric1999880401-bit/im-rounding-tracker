import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "error",
  optimizeDeps: { noDiscovery: true },
  root: process.cwd(),
  server: { middlewareMode: true },
});

try {
  const {
    captureRoundSoapEditorRevision,
    reconcileRoundSoapEditorRevision,
    roundSoapEditorRevisionMatchesSelection,
  } = await server.ssrLoadModule("/src/roundSoapEditorRevision.ts");
  const { clinicalSaveConflictReason } = await server.ssrLoadModule("/src/clinicalSaveGuard.ts");

  const noteV1 = {
    date: "2026-07-27",
    soapText: "S:\n- Fake v1\nO:\n- V/S: stable\nA/P:\n# Fake problem\n- Monitor\nTasks:\n- Recheck\nDC:\n- Pending",
    soapVersion: 1,
    updatedAt: "2026-07-27T01:00:00.000Z",
  };
  const remoteV2 = {
    ...noteV1,
    soapText: noteV1.soapText.replace("Fake v1", "Remote fake v2"),
    soapVersion: 2,
    updatedAt: "2026-07-27T01:01:00.000Z",
  };

  const basedOnV1 = captureRoundSoapEditorRevision(
    "fake-patient",
    noteV1.date,
    noteV1,
    "patient-revision-v1",
  );
  const stillBasedOnV1 = reconcileRoundSoapEditorRevision(
    basedOnV1,
    "fake-patient",
    noteV1.date,
    remoteV2,
    "patient-revision-v2",
    true,
  );
  if (
    stillBasedOnV1 !== basedOnV1
    || stillBasedOnV1.soapVersion !== 1
    || stillBasedOnV1.note !== noteV1
    || stillBasedOnV1.patientUpdatedAt !== "patient-revision-v1"
  ) {
    throw new Error("Dirty editor advanced from its v1 base after remote v2 arrived");
  }
  const staleSaveConflict = clinicalSaveConflictReason({
    persistedSoapVersion: remoteV2.soapVersion,
    expectedSoapVersion: stillBasedOnV1.soapVersion,
    patientExists: true,
    persistedPatientUpdatedAt: "same",
    expectedPatientUpdatedAt: "same",
  });
  if (!staleSaveConflict.includes("changed from version 1 to 2")) {
    throw new Error("A v1-based dirty editor would not conflict against persisted v2");
  }
  const stalePatientConflict = clinicalSaveConflictReason({
    persistedSoapVersion: noteV1.soapVersion,
    expectedSoapVersion: stillBasedOnV1.soapVersion,
    patientExists: true,
    persistedPatientUpdatedAt: "patient-revision-v2",
    expectedPatientUpdatedAt: stillBasedOnV1.patientUpdatedAt,
  });
  if (!stalePatientConflict.includes("another tab or device")) {
    throw new Error("Dirty editor adopted a newer patient compatibility-field revision");
  }

  const cleanV2 = reconcileRoundSoapEditorRevision(
    basedOnV1,
    "fake-patient",
    noteV1.date,
    remoteV2,
    "patient-revision-v2",
    false,
  );
  if (
    cleanV2.soapVersion !== 2
    || cleanV2.note !== remoteV2
    || cleanV2.patientUpdatedAt !== "patient-revision-v2"
  ) {
    throw new Error("Clean editor did not adopt the subscribed v2 revision");
  }

  const localSavedV2 = captureRoundSoapEditorRevision(
    "fake-patient",
    noteV1.date,
    remoteV2,
    "patient-revision-v2",
  );
  if (localSavedV2.soapVersion !== 2) {
    throw new Error("Successful local save did not advance the next rapid-save baseline to v2");
  }
  const afterLaggingSubscription = reconcileRoundSoapEditorRevision(
    localSavedV2,
    "fake-patient",
    noteV1.date,
    noteV1,
    "patient-revision-v1",
    false,
  );
  if (
    afterLaggingSubscription.soapVersion !== 2
    || afterLaggingSubscription.note !== remoteV2
    || afterLaggingSubscription.patientUpdatedAt !== "patient-revision-v2"
  ) {
    throw new Error("Lagging subscription regressed a just-saved v2 rapid-save baseline");
  }
  if (roundSoapEditorRevisionMatchesSelection(localSavedV2, "other-patient", noteV1.date)) {
    throw new Error("Cross-patient editor revision was accepted");
  }
  if (roundSoapEditorRevisionMatchesSelection(localSavedV2, "fake-patient", "2026-07-28")) {
    throw new Error("Cross-date editor revision was accepted");
  }

  console.log("PASS Round SOAP dirty-draft revision pinning and rapid-save advancement");
} finally {
  await server.close();
}
