import { useState } from "react";
import type {
  DailyNotesByPatient,
  MiscTask,
  Patient,
  PhonebookContact,
  PrintDensity,
  PrintFontSize,
  PrintLineSpacing,
  PrintPadding,
  SortMode,
  StudyTopic,
  UserPreferences,
} from "../types";
import {
  getActiveAttendingNames,
  getActivePatients,
  getAdmissionSummaryText,
  getPatientPmhText,
  getPatientDisplaySummary,
  groupPatientsByAttending,
  dischargePrepText,
  formatDateLabel,
  hasChronicRenalContext,
  plainClinicalText,
  sortPatients,
  todayKey,
} from "../utils";
import { ClinicalInlineText, ClinicalText } from "../components/ClinicalText";
import { ClinicalLabTable } from "../components/ClinicalLabTable";
import { useT } from "../i18n";
import { getPatientHeadline, getRoundingDigest } from "../roundingDigest";
import { getCanonicalSoapText, patientToSoapDraft } from "../soapDraft";
import { conciseSoapDiagnosisForDisplay, soapHeaderLinesForDisplay, soapHeaderSafetyLinesForDisplay } from "../soapDisplay";
import {
  buildRoundNoteViewModelFromDraft,
  makeRoundNoteLineView,
  selectRoundNoteLines,
  type RoundNoteLineView,
  type RoundNoteViewModel,
} from "../roundNoteViewModel";
import { formatMedicationOrderLinesForDisplay } from "../medicationOrderParser";
import {
  isComplexPrintDraft,
  shortPrintText,
} from "../printPriority";
import {
  isDcSoapLineVisible,
  isLayoutSectionVisible,
  isObjectiveSoapLineVisible,
  isSoapHeaderLineVisible,
  isTaskSoapLineVisible,
  normalizeRoundingLayoutPreferences,
} from "../userPreferences";

interface PageProps {
  patients: Patient[];
  dailyNotesByPatient?: DailyNotesByPatient;
  preferences: UserPreferences;
  phonebook?: PhonebookContact[];
  miscTasks?: MiscTask[];
  studyTopics?: StudyTopic[];
}

function PrintRoundingListPage({
  patients,
  dailyNotesByPatient = {},
  preferences,
  phonebook = [],
  miscTasks = [],
  studyTopics = [],
}: PageProps) {
  const t = useT();
  const roundingLayout = normalizeRoundingLayoutPreferences(preferences.roundingLayout);
  const [printMode, setPrintMode] = useState("all");
  const [admissionBriefPrintMode, setAdmissionBriefPrintMode] = useState("compact");
  const [briefInCards, setBriefInCards] = useState(true);
  const [selectedAttending, setSelectedAttending] = useState("");
  const [hideCompletedTasks, setHideCompletedTasks] = useState(true);
  const [density, setDensity] = useState<PrintDensity>(roundingLayout.printDensity);
  const [fontSize, setFontSize] = useState<PrintFontSize>(roundingLayout.printFontSize);
  const [lineSpacing, setLineSpacing] = useState<PrintLineSpacing>(roundingLayout.printLineSpacing);
  const [padding, setPadding] = useState<PrintPadding>(roundingLayout.printPadding);
  const [sortMode, setSortMode] = useState<SortMode>("bed");
  const [team, setTeam] = useState("Team A");
  const [attending, setAttending] = useState("");
  const [resident, setResident] = useState("");
  const [includePhonebook, setIncludePhonebook] = useState(true);
  const [includeMiscTasks, setIncludeMiscTasks] = useState(true);
  const [includeStudyTopics, setIncludeStudyTopics] = useState(true);
  const attendingNames = getActiveAttendingNames(patients);
  const filteredActivePatients = getActivePatients(patients)
    .map((patient) => getPatientDisplaySummary(patient, dailyNotesByPatient).patient)
    .filter((patient) => printMode !== "selected" || patient.attending.trim() === selectedAttending);
  const activePatients = sortPatients(filteredActivePatients, sortMode);
  const groupedPatients = groupPatientsByAttending(activePatients);
  const todayText = new Date().toLocaleDateString();
  const shouldPrintCompactList = admissionBriefPrintMode !== "briefsOnly";
  const unfinishedMiscTasks = includeMiscTasks ? miscTasks.filter((task) => !task.done) : [];
  const openStudyTopics = includeStudyTopics ? studyTopics.filter((topic) => !topic.done) : [];
  const printContacts = includePhonebook ? [...phonebook].sort((a, b) => Number(b.isImportant) - Number(a.isImportant)) : [];

  function admissionBriefPatients() {
    if (admissionBriefPrintMode === "newAdmissions") {
      return activePatients.filter((patient) => patient.isNewAdmission);
    }

    if (admissionBriefPrintMode === "selectedBriefs") {
      return activePatients.filter((patient) => patient.showAdmissionBriefOnPrint);
    }

    if (admissionBriefPrintMode === "briefsOnly") {
      return activePatients.filter((patient) => patient.isNewAdmission || patient.showAdmissionBriefOnPrint);
    }

    return [];
  }

  const selectedAdmissionBriefCandidates = admissionBriefPatients();
  const selectedAdmissionBriefPatients = selectedAdmissionBriefCandidates.filter(hasMeaningfulAdmissionBrief);
  const emptyAdmissionBriefPatients = selectedAdmissionBriefCandidates.filter((patient) => !hasMeaningfulAdmissionBrief(patient));

  function hasMeaningfulAdmissionBrief(patient: Patient) {
    return Boolean(
      (patient.chiefComplaint || patient.admissionChiefConcern).trim() ||
        (patient.presentIllnessOrHPI || patient.hpiOrAdmissionStory).trim() ||
        getAdmissionSummaryText(patient, { allowFallback: false }).trim() ||
        patient.generatedAdmissionNote.trim() ||
        patient.admissionBriefNotes.trim(),
    );
  }

  function printLimits() {
    if (density === "ultra-compact") {
      return {
        generalItems: 6,
        chars: 40,
        detailChars: 52,
        redFlags: 2,
        pmh: 3,
        problems: 3,
        subjective: 1,
        pe: 1,
        labReports: 1,
        labItems: 4,
        images: 1,
        apProblems: 3,
        tasks: 3,
        dcChars: 42,
      };
    }

    if (density === "compact") {
      return {
        generalItems: 8,
        chars: 50,
        detailChars: 66,
        redFlags: 2,
        pmh: 4,
        problems: 4,
        subjective: 2,
        pe: 1,
        labReports: 1,
        labItems: 5,
        images: 1,
        apProblems: 4,
        tasks: 3,
        dcChars: 54,
      };
    }

    return {
      generalItems: 10,
      chars: 62,
      detailChars: 84,
      redFlags: 3,
      pmh: 5,
      problems: 5,
      subjective: 2,
      pe: 2,
      labReports: 2,
      labItems: 7,
      images: 2,
      apProblems: 5,
      tasks: 5,
      dcChars: 68,
    };
  }

  function printLimitsForPatient(patient: Patient) {
    const base = printLimits();
    const soap = patientToSoapDraft(patient, dailyNotesByPatient[patient.id] ?? [], todayKey());
    if (!isComplexPrintDraft(soap)) return base;

    if (density === "ultra-compact") {
      return {
        ...base,
        detailChars: Math.max(base.detailChars, 70),
        redFlags: Math.max(base.redFlags, 3),
        labItems: Math.max(base.labItems, 6),
        images: Math.max(base.images, 2),
        apProblems: Math.max(base.apProblems, 4),
        tasks: Math.max(base.tasks, 5),
        dcChars: Math.max(base.dcChars, 56),
      };
    }

    return {
      ...base,
      chars: Math.max(base.chars, 70),
      detailChars: Math.max(base.detailChars, 112),
      redFlags: Math.max(base.redFlags, 3),
      subjective: Math.max(base.subjective, 3),
      pe: Math.max(base.pe, 2),
      labReports: Math.max(base.labReports, 2),
      labItems: Math.max(base.labItems, 9),
      images: Math.max(base.images, 3),
      apProblems: Math.max(base.apProblems, 5),
      tasks: Math.max(base.tasks, 7),
      dcChars: Math.max(base.dcChars, 90),
    };
  }

  function isExpandedPrintPatient(patient: Patient) {
    if (density === "ultra-compact") return false;
    return isComplexPrintDraft(patientToSoapDraft(patient, dailyNotesByPatient[patient.id] ?? [], todayKey()));
  }

  function cleanPrintLine(value: string) {
    return value
      .replace(/\s+-\s*Reason:\s*.*$/i, "")
      .replace(/\s*\(\s*source:\s*AI\s*\)\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function removePrintEllipsis(value: string) {
    return value
      .replace(/\bClarify current and HBV if\.{3}/i, "Clarify immunosupp/HBV status")
      .replace(/\bif\.{3}$/i, "")
      .replace(/\s*\.{3,}\s*/g, " ")
      .replace(/\s+(?:and|or|if|with|for|to|of)$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function displayPrintLine(value: string) {
    return removePrintEllipsis(cleanPrintLine(value)
      .replace(/^!+/, "")
      .replace(/^(Lab:\s*)!?\s*(?:crit|critical|abn|abnormal|trend|anchor)\s+(?:infx|infection|lyte\/renal|renal\/lyte|anemia|heme|cardio|cardiac|liver|gi|nutrition|onc|tumor|glucose|endocrine|coag|other)\s*:\s*/i, "$1")
      .replace(/^!?\s*(?:crit|critical|abn|abnormal|trend|anchor)\s+(?:infx|infection|lyte\/renal|renal\/lyte|anemia|heme|cardio|cardiac|liver|gi|nutrition|onc|tumor|glucose|endocrine|coag|other)\s*:\s*/i, "")
      .replace(/^(\w[\w/ ]{0,12}:\s*)!?\s*(?:critical|urgent)\s*:\s*/i, "$1* ")
      .replace(/^\s*(?:critical|urgent)\s*:\s*/i, "* ")
      .replace(/\b(?:critical|urgent)\s*:\s*/gi, "* ")
      .replace(/\[\s*URGENT\s*\]\s*/gi, "* ")
      .replace(/\bhigh-normal\b/gi, "\u2197 nl")
      .replace(/\blow-normal\b/gi, "\u2198 nl")
      .replace(/\bhigh\b/gi, "\u2191")
      .replace(/\blow\b/gi, "\u2193")
      .trim());
  }

  function simpleRedFlagText(value: string) {
    return cleanPrintLine(value)
      .replace(/^!+/, "")
      .replace(/:\s*(?:f\/u|follow|trend|verify|confirm|clarify|review|call|repeat|check|order|consult|start|stop|hold|resume|Cx|Abx|CBC|ANC).*/i, "")
      .trim();
  }

  function shortText(value: string, maxChars = printLimits().detailChars) {
    return shortPrintText(value, maxChars);
  }

  function clinicalItems(value: string) {
    const text = plainClinicalText(value, "");
    if (!text || text === "-") return [];
    return text.split(/\s*;\s*|\r?\n/).map(cleanPrintLine).filter(Boolean);
  }

  function compactList(items: string[], maxItems: number, maxChars = printLimits().chars) {
    const cleanItems = items.map(cleanPrintLine).filter(Boolean);
    const visible = cleanItems.slice(0, maxItems).map((item) => shortText(item, maxChars));
    return visible.filter(Boolean).join("; ");
  }

  function patientContextText(patient: Patient, view: RoundNoteViewModel, hasReviewedSoap: boolean) {
    const notes = dailyNotesByPatient[patient.id] ?? [];
    const digest = hasReviewedSoap ? null : getRoundingDigest(patient, notes, { mode: "rounds", hideCompletedTasks });
    const diagnosis = conciseSoapDiagnosisForDisplay({
      headerLines: view.header.map((line) => line.raw),
      apTitles: view.assessmentPlan.map((problem) => problem.title.text),
      fallbacks: [patient.primaryDiagnosis, digest?.diagnosis ?? "", patient.oneLiner],
      maxItems: 2,
      maxChars: 120,
    });
    const headerLines = soapHeaderLinesForDisplay(
      view.header.map((line) => line.raw).filter((line) => isSoapHeaderLineVisible(line, roundingLayout) && !/^Red flags:|^Date:|^Attending:|^Code:|^Allergy:|^Isolation:|^HD\/POD:/i.test(line)),
      {
        dx: diagnosis,
        issues: digest?.issues ?? "",
        pmh: digest?.risks ?? "",
      },
      { maxLines: 5, maxChars: 150 },
    ).filter((line) => !patient.patientCode || !line.includes(patient.patientCode));
    const safetyLines = soapHeaderSafetyLinesForDisplay(view.header.map((line) => line.raw));
    const clinicalContext = headerLines.length > 0 ? headerLines : diagnosis ? [`Dx: ${diagnosis}`] : [];
    return removePrintEllipsis([...safetyLines, ...clinicalContext.slice(0, 3)].map(displayPrintLine).filter(Boolean).join(" | "));
  }

  function taskDcTitle() {
    return [
      isLayoutSectionVisible(roundingLayout, "orders") ? "藥囑" : "",
      isLayoutSectionVisible(roundingLayout, "tasks") ? "Tasks" : "",
      isLayoutSectionVisible(roundingLayout, "dcBarriers") || isLayoutSectionVisible(roundingLayout, "dcPrep") ? "DC" : "",
    ].filter(Boolean).map((item) => (item.includes("藥囑") ? "藥囑" : item)).join(" / ") || "Tasks / DC";
  }

  function printRoundLineLabel(line: RoundNoteLineView) {
    if (line.section === "subjective" || line.section === "assessmentPlan") return "";
    if (line.section === "orders") return "藥";
    if (line.section === "tasks") return "T";
    if (line.section === "dc") return "DC";
    return line.label;
  }

  function renderPrintLineText(line: RoundNoteLineView) {
    if (line.kind !== "ap") {
      return <ClinicalInlineText value={line.text} keywordRules={preferences.keywordHighlightRules} />;
    }

    const separator = line.text.indexOf(": ");
    if (separator < 0) {
      return (
        <strong className="print-ap-title">
          <ClinicalInlineText value={line.text} keywordRules={preferences.keywordHighlightRules} />
        </strong>
      );
    }

    const title = line.text.slice(0, separator).trim();
    const detail = line.text.slice(separator + 2).trim();
    return (
      <>
        <strong className="print-ap-title">
          <ClinicalInlineText value={title} keywordRules={preferences.keywordHighlightRules} />
        </strong>
        {detail && (
          <span className="print-ap-detail">
            <ClinicalInlineText value={detail} keywordRules={preferences.keywordHighlightRules} />
          </span>
        )}
      </>
    );
  }

  function renderRoundPrintLines(lines: RoundNoteLineView[], keyPrefix: string) {
    if (lines.length === 0) return null;
    return (
      <div className="print-visual-list">
        {lines.map((line) => {
          const label = printRoundLineLabel(line);
          return (
            <div
              className={`print-visual-row ${label ? "" : "print-visual-row-unlabeled"} print-visual-${line.kind} print-visual-${line.tone}`}
              key={`${keyPrefix}-${line.id}`}
            >
              {label && <span className="print-visual-label">{label}</span>}
              <span className="print-visual-text">
                {renderPrintLineText(line)}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  function roundSectionBox(title: string, lines: RoundNoteLineView[], labLines: RoundNoteLineView[] = []) {
    if (lines.length === 0 && labLines.length === 0) return null;
    const sectionClass = title === "S"
      ? "print-section-subjective"
      : title === "O"
        ? "print-section-objective"
        : title === "A/P"
          ? "print-section-ap"
          : "print-section-taskdc";
    return (
      <div className={`print-section-box ${sectionClass}`}>
        <div className="print-section-title">{title}</div>
        {renderRoundPrintLines(lines, title)}
        {labLines.length > 0 && (
          <ClinicalLabTable
            density="print"
            lines={labLines}
            keywordRules={preferences.keywordHighlightRules}
          />
        )}
      </div>
    );
  }

  function renderPrintSection(sectionPatients: Patient[], sectionAttending: string, startNewPage = false) {
    return (
      <section
        className={`print-sheet ${startNewPage ? "print-attending-section" : ""}`}
        aria-label={`Printable rounding list for ${sectionAttending}`}
        key={sectionAttending}
      >
        <div className="print-title">
          <h1>{t("print.title")}</h1>
          <div className="print-meta-grid">
            <span>
              <strong>Date:</strong> {todayText}
            </span>
            <span>
              <strong>Team:</strong> {team || "________"}
            </span>
            <span>
              <strong>Attending:</strong> {sectionAttending || attending || "________"}
            </span>
            <span>
              <strong>Resident:</strong> {resident || "________"}
            </span>
            <span>
              <strong>Total active:</strong> {sectionPatients.length}
            </span>
          </div>
          <p>Use de-identified data only.</p>
          {(unfinishedMiscTasks.length > 0 || openStudyTopics.length > 0 || printContacts.length > 0) && (
            <div className="print-general-notes">
              <strong>{t("print.generalNotes")}</strong>
              {printContacts.length > 0 && (
                <span>
                  {t("print.phonebook")}:{" "}
                  {compactList(
                    printContacts.map((contact) => `${contact.name || contact.roleOrUnit} ${contact.phone}`),
                    printLimits().generalItems,
                    printLimits().detailChars,
                  )}
                </span>
              )}
              {unfinishedMiscTasks.length > 0 && (
                <span>
                  {t("print.miscTasks")}: {compactList(unfinishedMiscTasks.map((task) => task.text), printLimits().generalItems, printLimits().detailChars)}
                </span>
              )}
              {openStudyTopics.length > 0 && (
                <span>
                  {t("print.studyTopics")}: {compactList(openStudyTopics.map((topic) => topic.topic), printLimits().generalItems, printLimits().detailChars)}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="print-patient-list">
          {sectionPatients.map((patient) => {
            const soapForPrint = patientToSoapDraft(patient, dailyNotesByPatient[patient.id] ?? [], todayKey());
            const canonicalMeta = getCanonicalSoapText(patient, dailyNotesByPatient[patient.id] ?? [], todayKey());
            const hasReviewedSoap = canonicalMeta.source !== "fallback";
            const chronicRenal = hasChronicRenalContext(patient);
            const roundView = buildRoundNoteViewModelFromDraft(soapForPrint, { chronicRenal });
            const limits = printLimitsForPatient(patient);
            const isExpanded = isExpandedPrintPatient(patient);
            const headline = hasReviewedSoap ? null : getPatientHeadline(patient, dailyNotesByPatient[patient.id] ?? [], { mode: "rounds" });
            const contextText = patientContextText(patient, roundView, hasReviewedSoap);
            const soapRedFlags = isLayoutSectionVisible(roundingLayout, "redFlags")
              ? roundView.header.find((line) => /^Red flags:/i.test(line.raw))?.raw.replace(/^Red flags:\s*/i, "") ?? ""
              : "";
            const redFlagItems = selectRoundNoteLines(
              clinicalItems(soapRedFlags).map((line, index) =>
                makeRoundNoteLineView(
                  simpleRedFlagText(line),
                  "warnings",
                  "red",
                  `print-${patient.id}-red-${index}`,
                  { chronicRenal },
                ),
              ),
              limits.redFlags,
            );
            const subjectiveLines = isLayoutSectionVisible(roundingLayout, "subjective")
              ? selectRoundNoteLines(roundView.subjective, limits.subjective)
              : [];
            const visibleObjectiveLines = roundView.objective.all.filter((line) => isObjectiveSoapLineVisible(line.raw, roundingLayout));
            const objectiveLabLines = visibleObjectiveLines.filter((line) => line.kind === "lab");
            const objectiveLines = selectRoundNoteLines(
              visibleObjectiveLines.filter((line) => line.kind !== "lab"),
              limits.pe + limits.images,
            );
            const assessmentLines = isLayoutSectionVisible(roundingLayout, "assessmentPlan")
              ? selectRoundNoteLines(
                  roundView.assessmentPlan.map((problem, index) =>
                    makeRoundNoteLineView(
                      [problem.title.text, ...problem.lines.map((line) => line.text)].filter(Boolean).join(": "),
                      "assessmentPlan",
                      "ap",
                      `print-${patient.id}-ap-${index}`,
                      { chronicRenal },
                    ),
                  ),
                  limits.apProblems,
                )
              : [];
            const displayedOrders = isLayoutSectionVisible(roundingLayout, "orders")
              ? formatMedicationOrderLinesForDisplay(
                  roundView.orders.map((line) => line.raw),
                  roundingLayout.orderDisplayMode,
                  density === "normal" ? 8 : 4,
                ).map((line, index) => makeRoundNoteLineView(line, "orders", "task", `print-${patient.id}-order-${index}`, { chronicRenal }))
              : [];
            const taskLines = isLayoutSectionVisible(roundingLayout, "tasks")
              ? roundView.tasks.filter((line) => isTaskSoapLineVisible(line.raw, roundingLayout))
              : [];
            const dcLines = roundView.dc.filter((line) => isDcSoapLineVisible(line.raw, roundingLayout));
            const taskDcLines = selectRoundNoteLines([...displayedOrders, ...taskLines, ...dcLines], limits.tasks + (density === "normal" ? 2 : 1));

            return (
              <article className={isExpanded ? "print-patient-block print-patient-expanded" : "print-patient-block"} key={patient.id}>
                <div className="print-patient-header">
                  <span className="print-bed">{patient.bed || "-"}</span>
                  <span>
                    <strong>{patient.patientCode || "-"}</strong> {patient.age || "-"}/{patient.sex || "-"}
                  </span>
                  {isExpanded && <span className="print-complexity-badge">Expanded SOAP</span>}
                  {patient.attending && <span>Att: {patient.attending}</span>}
                  {patient.teamOrService && <span>Svc: {patient.teamOrService}</span>}
                </div>

                {headline && (
                  <div className={`print-headline print-headline-${headline.tone}`}>{headline.text}</div>
                )}

                {contextText && (
                  <div className="print-patient-context">{contextText}</div>
                )}

                {briefInCards && (patient.showAdmissionBriefOnPrint || patient.isNewAdmission) && getAdmissionSummaryText(patient, { allowFallback: false }).trim() && (
                  <div className="print-inline-brief">
                    <ClinicalText value={getAdmissionSummaryText(patient, { allowFallback: false })} keywordRules={preferences.keywordHighlightRules} />
                  </div>
                )}

                {redFlagItems.length > 0 && (
                  <div className="print-red-flags">
                    <strong>Red Flags:</strong>
                    {renderRoundPrintLines(redFlagItems, `red-${patient.id}`)}
                  </div>
                )}

                <div className="print-summary-grid">
                  {roundSectionBox("S", subjectiveLines)}
                  {roundSectionBox("O", objectiveLines, objectiveLabLines)}
                  {roundSectionBox("A/P", assessmentLines)}
                  {roundSectionBox(taskDcTitle(), taskDcLines)}
                </div>
              </article>
            );
          })}
          {sectionPatients.length === 0 && (
            <div className="print-patient-empty">No active patients selected for this print view.</div>
          )}
        </div>
      </section>
    );
  }

  function renderAdmissionBrief(patient: Patient) {
    const chiefComplaint = patient.chiefComplaint || patient.admissionChiefConcern;
    const hpi = patient.presentIllnessOrHPI || patient.hpiOrAdmissionStory;
    const summary = getAdmissionSummaryText(patient, { allowFallback: false });
    const keyLabs = patient.rawLabText || patient.newLabs || patient.initialLabs;
    const keyImages = patient.newImaging || patient.initialImaging;

    return (
      <section className="print-admission-brief" key={`brief-${patient.id}`}>
        <div className="brief-title">
          <h2>
            Admission Brief: {patient.bed || "-"} / {patient.patientCode || "-"}
          </h2>
          <p>
            {patient.age} / {patient.sex} | Attending: {patient.attending || "-"} | Team: {patient.teamOrService || "-"}
          </p>
        </div>
        <div className="brief-grid">
          <div className="span-2">
            <strong>Chief Concern</strong>
            <ClinicalText value={chiefComplaint} keywordRules={preferences.keywordHighlightRules} />
          </div>
          <div className="span-2">
            <strong>PI / HPI</strong>
            <ClinicalText value={hpi} keywordRules={preferences.keywordHighlightRules} />
          </div>
          {summary && (
            <div className="span-2">
              <strong>Concise Admission Summary</strong>
              <ClinicalText value={summary} keywordRules={preferences.keywordHighlightRules} />
            </div>
          )}
          <div>
            <strong>PHx / PMH</strong>
            <ClinicalText value={getPatientPmhText(patient)} keywordRules={preferences.keywordHighlightRules} />
          </div>
          <div>
            <strong>Key Labs / Images</strong>
            <ClinicalText value={[keyLabs ? `Lab: ${keyLabs}` : "", keyImages ? `Image: ${keyImages}` : ""].filter(Boolean).join("\n")} keywordRules={preferences.keywordHighlightRules} />
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className={`page print-page density-${density} print-font-${fontSize} print-line-${lineSpacing} print-padding-${padding}`}>
      <header className="page-header no-print">
        <div>
          <h2>{t("print.title")}</h2>
        </div>
        <button type="button" onClick={() => window.print()}>
          {t("print.print")}
        </button>
      </header>

      <section className="panel no-print print-options">
        <label>
          {t("board.patientScope")}
          <select value={printMode} onChange={(event) => setPrintMode(event.target.value)}>
            <option value="all">{t("board.allActivePatients")}</option>
            <option value="selected">{t("board.selectedAttendingOnly")}</option>
            <option value="separate">{t("board.separateByAttending")}</option>
          </select>
        </label>

        <label>
          {t("print.content")}
          <select
            value={admissionBriefPrintMode}
            onChange={(event) => setAdmissionBriefPrintMode(event.target.value)}
          >
            <option value="compact">{t("print.compactOnly")}</option>
            <option value="newAdmissions">{t("print.withNewAdmissionBriefs")}</option>
            <option value="selectedBriefs">{t("print.withSelectedBriefs")}</option>
            <option value="briefsOnly">{t("print.briefsOnly")}</option>
          </select>
        </label>

        {printMode === "selected" && (
          <label>
            {t("print.selectedAttending")}
            <select value={selectedAttending} onChange={(event) => setSelectedAttending(event.target.value)}>
              <option value="">{t("print.chooseAttending")}</option>
              {attendingNames.map((attendingName) => (
                <option key={attendingName} value={attendingName}>
                  {attendingName}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          {t("action.sort")}
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
            <option value="bed">{t("board.byBed")}</option>
            <option value="dischargeDate">{t("board.byDischargeDate")}</option>
            <option value="urgentFirst">{t("board.urgentFirst")}</option>
          </select>
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={hideCompletedTasks}
            onChange={(event) => setHideCompletedTasks(event.target.checked)}
          />
          {t("action.hideCompleted")}
        </label>

        <label className="checkbox-label">
          <input type="checkbox" checked={briefInCards} onChange={(event) => setBriefInCards(event.target.checked)} />
          {t("print.briefInCards")}
        </label>

        <details className="advanced-fold print-advanced-fold">
          <summary>{t("print.advancedOptions")}</summary>
          <div className="print-options-advanced">
        <label>
          {t("print.team")}
          <input value={team} onChange={(event) => setTeam(event.target.value)} />
        </label>
        <label>
          {t("field.attending")}
          <input value={attending} onChange={(event) => setAttending(event.target.value)} />
        </label>
        <label>
          {t("print.resident")}
          <input value={resident} onChange={(event) => setResident(event.target.value)} />
        </label>
        <label>
          {t("print.density")}
          <select value={density} onChange={(event) => setDensity(event.target.value as PrintDensity)}>
            <option value="normal">{t("print.detailed")}</option>
            <option value="compact">{t("print.compact")}</option>
            <option value="ultra-compact">{t("print.ultraCompact")}</option>
          </select>
        </label>
        <label>
          Font size
          <select value={fontSize} onChange={(event) => setFontSize(event.target.value as PrintFontSize)}>
            <option value="small">Small</option>
            <option value="default">Default</option>
            <option value="large">Large</option>
          </select>
        </label>
        <label>
          Line spacing
          <select value={lineSpacing} onChange={(event) => setLineSpacing(event.target.value as PrintLineSpacing)}>
            <option value="tight">Tight</option>
            <option value="normal">Normal</option>
            <option value="airy">Airy</option>
          </select>
        </label>
        <label>
          Section padding
          <select value={padding} onChange={(event) => setPadding(event.target.value as PrintPadding)}>
            <option value="dense">Dense</option>
            <option value="balanced">Balanced</option>
          </select>
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={includePhonebook} onChange={(event) => setIncludePhonebook(event.target.checked)} />
          {t("print.includePhonebook")}
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={includeMiscTasks} onChange={(event) => setIncludeMiscTasks(event.target.checked)} />
          {t("print.includeMiscTasks")}
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={includeStudyTopics} onChange={(event) => setIncludeStudyTopics(event.target.checked)} />
          {t("print.includeStudyTopics")}
        </label>
          </div>
        </details>
      </section>

      {admissionBriefPrintMode !== "compact" && (
        <section className="panel no-print">
          <h3>{t("print.preview")}</h3>
          {selectedAdmissionBriefPatients.length === 0 ? (
            <p className="muted">
              {t("print.noBriefs")}
              {emptyAdmissionBriefPatients.length > 0 && " Admission summary is empty and will not be printed."}
            </p>
          ) : (
            <p>
              Admission briefs to be printed:{" "}
              {selectedAdmissionBriefPatients
                .map((patient) => `Bed ${patient.bed || "-"} / Patient code ${patient.patientCode || "-"}`)
                .join(", ")}
              {emptyAdmissionBriefPatients.length > 0 && " Some selected admission summaries are empty and will not be printed."}
            </p>
          )}
        </section>
      )}

      {shouldPrintCompactList &&
        (printMode === "separate"
          ? Object.entries(groupedPatients).map(([sectionAttending, sectionPatients], index) =>
              renderPrintSection(sortPatients(sectionPatients, sortMode), sectionAttending, index > 0),
            )
          : renderPrintSection(
              activePatients,
              printMode === "selected" ? selectedAttending : attending,
            ))}

      {selectedAdmissionBriefPatients.length > 0 && (
        <section className="print-briefs-heading">
          <h1>Section 2: Admission Briefs for New Patients</h1>
          <p>Use de-identified data only.</p>
        </section>
      )}
      {selectedAdmissionBriefPatients.map(renderAdmissionBrief)}
    </div>
  );
}

export default PrintRoundingListPage;
