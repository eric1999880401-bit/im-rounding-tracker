import { useMemo, useRef, useState } from "react";
import type { LabReport, ParsedLabItem } from "../types";
import { parseLabReports } from "../utils";
import { findLabDictionaryItem, searchLabDictionary } from "../data/labDictionary";
import { LabChips } from "./LabChips";
import { useT } from "../i18n";

interface SmartLabPanelProps {
  rawValue: string;
  labDate: string;
  labReportTitle: string;
  items: ParsedLabItem[];
  labReports: LabReport[];
  onChange: (rawValue: string, items: ParsedLabItem[], labReports: LabReport[]) => void;
  onMetaChange: (labDate: string, labReportTitle: string, labReports: LabReport[], selectedRawValue?: string) => void;
  onFieldBlur?: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
}

function emptyDraft(): ParsedLabItem {
  return {
    label: "",
    name: "",
    value: "",
    unit: "",
    previousValue: "",
    group: "",
    color: "",
    important: false,
    isImportant: false,
    note: "",
  };
}

function normalizeDateForStorage(date: string) {
  const trimmedDate = date.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) return trimmedDate;
  const parsedDate = new Date(trimmedDate);
  if (!Number.isNaN(parsedDate.getTime())) return parsedDate.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function reportTitleForStorage(title: string) {
  return title.trim() || "Labs";
}

function sortLabReports(reports: LabReport[]) {
  return [...reports].sort((a, b) => {
    const dateOrder = normalizeDateForStorage(b.date).localeCompare(normalizeDateForStorage(a.date));
    if (dateOrder !== 0) return dateOrder;
    return reportTitleForStorage(a.title).localeCompare(reportTitleForStorage(b.title));
  });
}

function sameReport(left: LabReport, date: string, title: string) {
  return (
    normalizeDateForStorage(left.date) === normalizeDateForStorage(date) &&
    reportTitleForStorage(left.title).toLowerCase() === reportTitleForStorage(title).toLowerCase()
  );
}

function replaceReportsForSelectedDate(currentReports: LabReport[], nextReports: LabReport[]) {
  if (nextReports.length === 0) return currentReports;
  const replacementKeys = new Set(
    nextReports.map((report) => `${normalizeDateForStorage(report.date)}|${reportTitleForStorage(report.title).toLowerCase()}`),
  );
  const keptReports = currentReports.filter(
    (report) => !replacementKeys.has(`${normalizeDateForStorage(report.date)}|${reportTitleForStorage(report.title).toLowerCase()}`),
  );
  return sortLabReports([...keptReports, ...nextReports]);
}

function SmartLabPanel({
  rawValue,
  labDate,
  labReportTitle,
  items,
  labReports,
  onChange,
  onMetaChange,
  onFieldBlur,
  onCompositionStart,
  onCompositionEnd,
}: SmartLabPanelProps) {
  const t = useT();
  const [draft, setDraft] = useState<ParsedLabItem>(emptyDraft());
  const [nameQuery, setNameQuery] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const labTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const colorOptions = ["red", "orange", "yellow", "blue", "green", "purple"];
  const suggestions = useMemo(() => {
    return searchLabDictionary(nameQuery, 12);
  }, [nameQuery]);

  function parsedReportsFor(value: string, date = labDate, title = labReportTitle) {
    return parseLabReports(value, normalizeDateForStorage(date), reportTitleForStorage(title));
  }

  function updateRaw(value: string) {
    const parsedReports = parsedReportsFor(value);
    const reports = replaceReportsForSelectedDate(labReports, parsedReports);
    onChange(value, reports.flatMap((report) => report.items), reports);
  }

  function updateMeta(nextDate: string, nextTitle: string) {
    const selectedDate = normalizeDateForStorage(nextDate);
    const selectedTitle = reportTitleForStorage(nextTitle);
    const existingReport = labReports.find((report) => sameReport(report, selectedDate, selectedTitle));
    const dateChanged = selectedDate !== normalizeDateForStorage(labDate);
    onMetaChange(selectedDate, nextTitle, sortLabReports(labReports), dateChanged ? (existingReport?.rawText ?? "") : undefined);
  }

  function selectLab(name: string, group: string, unit = "") {
    setNameQuery(name);
    setDraft({ ...draft, label: name, name, group, unit: draft.unit || unit });
    setSuggestionsOpen(false);
  }

  function addItem() {
    const name = (draft.name || nameQuery).trim();
    if (!name || !draft.value.trim()) return;

    const nextItem: ParsedLabItem = {
      ...draft,
      label: name,
      name,
      value: draft.value.trim(),
      unit: draft.unit?.trim() || "",
      previousValue: draft.previousValue?.trim() || "",
      group: draft.group || findLabDictionaryItem(name)?.group || "Custom",
      color: draft.color || "",
      important: Boolean(draft.important || draft.isImportant),
      isImportant: Boolean(draft.important || draft.isImportant),
      note: draft.note?.trim() || "",
    };

    const selectedDate = normalizeDateForStorage(labDate);
    const selectedTitle = reportTitleForStorage(labReportTitle);
    const existingReport = labReports.find((report) => sameReport(report, selectedDate, selectedTitle));
    const nextReport: LabReport = existingReport
      ? { ...existingReport, date: selectedDate, title: selectedTitle, items: [...existingReport.items, nextItem] }
      : {
          id: `manual-${selectedDate}-${selectedTitle.replace(/[^A-Za-z0-9]+/g, "-")}-${Date.now()}`,
          date: selectedDate,
          title: selectedTitle,
          rawText: rawValue,
          items: [nextItem],
        };
    const reports = sortLabReports([
      ...labReports.filter((report) => !sameReport(report, selectedDate, selectedTitle)),
      nextReport,
    ]);

    onChange(rawValue, reports.flatMap((report) => report.items), reports);
    setDraft(emptyDraft());
    setNameQuery("");
  }

  function removeItem(index: number) {
    let seenIndex = -1;
    const reports = sortLabReports(
      labReports
        .map((report) => {
          const nextItems = report.items.filter(() => {
            seenIndex += 1;
            return seenIndex !== index;
          });
          return { ...report, items: nextItems };
        })
        .filter((report) => report.items.length > 0 || report.rawText.trim()),
    );
    onChange(rawValue, reports.flatMap((report) => report.items), reports);
  }

  function insertTemplate(template: string) {
    const textarea = labTextareaRef.current;
    const start = textarea?.selectionStart ?? rawValue.length;
    const end = textarea?.selectionEnd ?? rawValue.length;
    const prefix = rawValue.slice(0, start);
    const suffix = rawValue.slice(end);
    const spacer = prefix && !prefix.endsWith("\n") ? "\n" : "";
    const nextValue = `${prefix}${spacer}${template}${suffix}`;
    updateRaw(nextValue);
    window.setTimeout(() => {
      textarea?.focus();
      const cursor = prefix.length + spacer.length + template.length;
      textarea?.setSelectionRange(cursor, cursor);
    }, 0);
  }

  function markRawLabColor(color: string) {
    const textarea = labTextareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start === end) return;
    const selectedText = rawValue.slice(start, end);
    const markerStart = `[[${color}:`;
    const nextValue = `${rawValue.slice(0, start)}${markerStart}${selectedText}]]${rawValue.slice(end)}`;
    updateRaw(nextValue);
    window.setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + markerStart.length, end + markerStart.length);
    }, 0);
  }

  return (
    <div className="smart-lab-panel">
      <label>
        O - {t("field.lab")}
        <textarea
          ref={labTextareaRef}
          value={rawValue}
          onChange={(event) => updateRaw(event.target.value)}
          onBlur={onFieldBlur}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          placeholder="Example: CBC/DC: WBC 3000 Neu 50&#10;metabolic: AST 20 ALT 18&#10;HbA1c 11.7% UA WBC 20 LE 1+"
        />
      </label>

      <div className="color-toolbar" aria-label="Color selected lab text">
        {colorOptions.map((color) => (
          <button
            type="button"
            className={`color-tool color-tool-${color}`}
            key={color}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => markRawLabColor(color)}
          >
            {color}
          </button>
        ))}
      </div>

      <div className="lab-report-meta">
        <label>
          {t("lab.date")}
          <input
            type="date"
            value={labDate}
            onChange={(event) => updateMeta(event.target.value, labReportTitle)}
            onBlur={onFieldBlur}
          />
        </label>
        <label>
          {t("lab.group")}
          <input
            value={labReportTitle}
            onChange={(event) => updateMeta(labDate, event.target.value)}
            onBlur={onFieldBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            placeholder="Example: CBC/DC, metabolic, coag, UA"
          />
        </label>
      </div>

      <div className="lab-template-row">
        {[
          ["CBC/DC", "CBC/DC: WBC  Hb  Hct  Plt  Neu "],
          ["Renal", "Renal: BUN  Cr  eGFR "],
          ["Electrolytes", "Electrolytes: Na  K  Cl  Osm "],
          ["LFT", "Liver: AST  ALT  T-Bil  D-Bil  Alb "],
          ["Coag", "coag. PT  INR  aPTT  D-dimer "],
          ["UA", "UA WBC  RBC  LE  Nitrite  Protein "],
        ].map(([label, template]) => (
          <button type="button" className="secondary" key={label} onClick={() => insertTemplate(template)}>
            {label}
          </button>
        ))}
      </div>

      <div className="lab-editor-grid">
        <label className="lab-name-field">
          {t("lab.addCustom")}
          <input
            value={nameQuery}
            onChange={(event) => {
              setNameQuery(event.target.value);
              setDraft({ ...draft, label: event.target.value, name: event.target.value });
              setSuggestionsOpen(true);
            }}
            onFocus={() => setSuggestionsOpen(Boolean(nameQuery.trim()))}
            onBlur={() => {
              window.setTimeout(() => setSuggestionsOpen(false), 120);
              onFieldBlur?.();
            }}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            placeholder="Type w for WBC"
          />
          {suggestionsOpen && suggestions.length > 0 && (
            <div className="lab-suggestion-popover">
              {suggestions.map((item) => (
                <button
                  type="button"
                  className="secondary"
                  key={item.key}
                  onClick={() => selectLab(item.displayName, item.group, item.commonUnits[0] ?? "")}
                >
                  <span>{item.displayName}</span>
                  <small>{item.group}</small>
                </button>
              ))}
            </div>
          )}
        </label>

        <label>
          Value
          <input
            value={draft.value}
            onChange={(event) => setDraft({ ...draft, value: event.target.value })}
            onBlur={onFieldBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
          />
        </label>

        <label>
          Unit
          <input
            value={draft.unit}
            onChange={(event) => setDraft({ ...draft, unit: event.target.value })}
            onBlur={onFieldBlur}
          />
        </label>

        <label>
          Previous
          <input
            value={draft.previousValue}
            onChange={(event) => setDraft({ ...draft, previousValue: event.target.value })}
            onBlur={onFieldBlur}
          />
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={Boolean(draft.important || draft.isImportant)}
            onChange={(event) => setDraft({ ...draft, important: event.target.checked, isImportant: event.target.checked })}
          />
          Important
        </label>

        <button type="button" onClick={addItem}>
          Add lab
        </button>
      </div>

      <div className="lab-preview">
        <strong>{t("lab.smartReports")}</strong>
        {labReports.length > 0 && (
          <div className="lab-report-list">
            {labReports.map((report) => (
              <div className="lab-report-card" key={report.id}>
                <div className="lab-report-heading">
                  <span>{report.date || labDate}</span>
                  <strong>{report.title || labReportTitle || "Labs"}</strong>
                </div>
                {report.items.length > 0 ? <LabChips items={report.items} /> : <div className="muted">{report.rawText}</div>}
              </div>
            ))}
          </div>
        )}
        <LabChips items={items} onRemove={removeItem} />
      </div>
    </div>
  );
}

export default SmartLabPanel;
