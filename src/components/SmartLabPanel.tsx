import { useMemo, useRef, useState } from "react";
import type { ParsedLabItem } from "../types";
import { labCatalog, parseLabText } from "../utils";
import { LabChips } from "./LabChips";

interface SmartLabPanelProps {
  rawValue: string;
  items: ParsedLabItem[];
  onChange: (rawValue: string, items: ParsedLabItem[]) => void;
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
    important: false,
    isImportant: false,
    note: "",
  };
}

function SmartLabPanel({
  rawValue,
  items,
  onChange,
  onFieldBlur,
  onCompositionStart,
  onCompositionEnd,
}: SmartLabPanelProps) {
  const [draft, setDraft] = useState<ParsedLabItem>(emptyDraft());
  const [nameQuery, setNameQuery] = useState("");
  const labTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const suggestions = useMemo(() => {
    const query = nameQuery.trim().toLowerCase();
    if (!query) return labCatalog.slice(0, 10);
    return labCatalog.filter((item) => item.name.toLowerCase().includes(query)).slice(0, 10);
  }, [nameQuery]);

  function updateRaw(value: string) {
    onChange(value, parseLabText(value));
  }

  function selectLab(name: string, group: string) {
    setNameQuery(name);
    setDraft({ ...draft, label: name, name, group });
  }

  function addItem() {
    const name = (draft.name || nameQuery).trim();
    if (!name || !draft.value.trim()) return;

    const nextItem: ParsedLabItem = {
      ...draft,
      label: name,
      name,
      group: draft.group || labCatalog.find((item) => item.name === name)?.group || "Custom",
      important: Boolean(draft.important || draft.isImportant),
      isImportant: Boolean(draft.important || draft.isImportant),
    };

    onChange(rawValue, [...items, nextItem]);
    setDraft(emptyDraft());
    setNameQuery("");
  }

  function removeItem(index: number) {
    onChange(rawValue, items.filter((_, itemIndex) => itemIndex !== index));
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

  return (
    <div className="smart-lab-panel">
      <label>
        O - Important Labs
        <textarea
          ref={labTextareaRef}
          value={rawValue}
          onChange={(event) => updateRaw(event.target.value)}
          onBlur={onFieldBlur}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          placeholder="Example: WBC 15800 (Neu 84.7) Osm. 321(300) Cre 1.11 GFR 52.16 UA: WBC 777 LE 3+"
        />
      </label>

      <div className="lab-template-row">
        {[
          ["CBC", "WBC  Hb  Hct  Plt  Neu "],
          ["Renal", "BUN  Cr  eGFR "],
          ["Electrolytes", "Na  K  Cl  Osm "],
          ["LFT", "AST  ALT  T-Bil  D-Bil  Alb "],
          ["Infection", "CRP  PCT  Lactate "],
          ["UA", "UA: WBC  RBC  LE  Nitrite  Protein "],
        ].map(([label, template]) => (
          <button type="button" className="secondary" key={label} onClick={() => insertTemplate(template)}>
            {label}
          </button>
        ))}
      </div>

      <div className="lab-editor-grid">
        <label>
          Lab name
          <input
            value={nameQuery}
            onChange={(event) => {
              setNameQuery(event.target.value);
              setDraft({ ...draft, label: event.target.value, name: event.target.value });
            }}
            list="lab-suggestions"
            onBlur={onFieldBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            placeholder="Type w for WBC"
          />
          <datalist id="lab-suggestions">
            {suggestions.map((item) => (
              <option key={`${item.group}-${item.name}`} value={item.name} />
            ))}
          </datalist>
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

      <div className="lab-suggestion-row">
        {suggestions.map((item) => (
          <button type="button" className="secondary" key={`${item.group}-${item.name}`} onClick={() => selectLab(item.name, item.group)}>
            {item.name}
          </button>
        ))}
      </div>

      <div className="lab-preview">
        <strong>Smart lab chips</strong>
        <LabChips items={items} maxItems={12} />
        {items.length > 0 && (
          <div className="lab-edit-list">
            {items.map((item, index) => (
              <button type="button" className="secondary" key={`${item.label}-${index}`} onClick={() => removeItem(index)}>
                Remove {item.name || item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default SmartLabPanel;
