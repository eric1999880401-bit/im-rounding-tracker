import { useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  formatLabVisualSummaryFromLines,
  type LabVisualGroup,
  type LabVisualItem,
} from "../labVisualSummary";
import { labReferenceText } from "../labReference";
import type { KeywordHighlightRule } from "../types";
import type { RoundNoteLineView } from "../roundNoteViewModel";
import { ClinicalInlineText, type LabReferenceDisplayMode } from "./ClinicalText";

export type ClinicalLabTableDensity = "detail" | "board" | "print";

interface ClinicalLabTableProps {
  lines: Array<string | RoundNoteLineView>;
  density?: ClinicalLabTableDensity;
  keywordRules?: KeywordHighlightRule[];
  labReferenceDisplay?: LabReferenceDisplayMode;
  emptyText?: string;
}

function sourceLine(value: string | RoundNoteLineView) {
  return typeof value === "string" ? value : value.raw || value.text;
}

const compactGroupLabels: Record<LabVisualGroup["id"], string> = {
  cbc: "CBC",
  renalLyte: "Renal/Lyte",
  liverCoag: "Liver/Coag",
  infxPerfusion: "Infx",
  urinalysis: "U/A",
  gas: "Gas",
  cardiac: "Cardiac",
  other: "Other",
};

function groupDisplayLabel(group: LabVisualGroup, density: ClinicalLabTableDensity) {
  return density === "detail" ? group.label : compactGroupLabels[group.id];
}

function labItemDisplayParts(item: LabVisualItem) {
  const source = item.text.trim();
  const label = item.label.trim();
  const narrative = item.explicitMark || label === "Microbiology" || label === "Other";
  if (narrative) return { label: "", value: source, previous: "" };

  const startsWithLabel =
    source.slice(0, label.length).toLocaleLowerCase() === label.toLocaleLowerCase() &&
    (!source[label.length] || /[\s:]/.test(source[label.length]));
  const value = (startsWithLabel ? source.slice(label.length).replace(/^\s*:\s*|\s+/, "") : source).trim();
  const previousMatch = value.match(/^([\s\S]*?)(\([^()\r\n]{1,32}\))$/);
  if (!previousMatch) return { label, value, previous: "" };
  return {
    label,
    value: previousMatch[1].trim(),
    previous: previousMatch[2],
  };
}

function LabItemContent({
  item,
  keywordRules,
  labReferenceDisplay,
}: {
  item: LabVisualItem;
  keywordRules: KeywordHighlightRule[];
  labReferenceDisplay: LabReferenceDisplayMode;
}) {
  const [referenceOpen, setReferenceOpen] = useState(false);
  const display = labItemDisplayParts(item);
  const reference = display.label ? labReferenceText(display.label) : "";
  const canExpandReference = labReferenceDisplay === "detail" && Boolean(reference);
  const toggleReference = () => {
    if (canExpandReference) setReferenceOpen((open) => !open);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (!canExpandReference) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleReference();
    } else if (event.key === "Escape") {
      setReferenceOpen(false);
    }
  };

  return (
    <>
      {display.label && <span className="clinical-lab-item-name">{display.label}</span>}
      <span
        className={`clinical-lab-item-value${canExpandReference ? " clinical-lab-item-value-clickable" : ""}`}
        onClick={toggleReference}
        onKeyDown={onKeyDown}
        role={canExpandReference ? "button" : undefined}
        tabIndex={canExpandReference ? 0 : undefined}
        title={labReferenceDisplay === "tooltip" && reference ? reference : undefined}
      >
        <ClinicalInlineText
          value={display.value}
          keywordRules={keywordRules}
          labReferenceDisplay="none"
        />
      </span>
      {display.previous && (
        <span className="clinical-lab-item-previous" aria-label={`previous ${display.previous.slice(1, -1)}`}>
          <span aria-hidden="true">prev </span>{display.previous.slice(1, -1)}
        </span>
      )}
      {labReferenceDisplay === "inline" && reference && (
        <span className="clinical-lab-ref-inline">({reference})</span>
      )}
      {referenceOpen && reference && (
        <span className="clinical-lab-ref-detail">
          Ref: {display.label} {reference.replace(/^ref\s*/i, "")}
        </span>
      )}
    </>
  );
}

export function ClinicalLabTable({
  lines,
  density = "detail",
  keywordRules = [],
  labReferenceDisplay = "none",
  emptyText = "No key lab",
}: ClinicalLabTableProps) {
  const source = lines.map(sourceLine).filter((line) => line.trim()).join("\n");
  const summary = useMemo(
    () => formatLabVisualSummaryFromLines(source, {
      includeLabPrefix: false,
      includePlain: true,
      // Accepted SOAP Lab lines are already clinically selected by the
      // contract layer. Render that complete fact set on every surface so a
      // Board/Print density cap cannot silently remove a required analyte.
      selectionMode: "complete",
      maxItemsPerGroup: Number.POSITIVE_INFINITY,
    }),
    [source],
  );
  // The contract layer has already selected the clinically relevant facts.
  // Display surfaces must not perform a second clinical filter: that was why
  // plain-but-important orientation values such as WBC disappeared on Board.
  const groups = summary.groups;

  if (groups.length === 0) return <span className="clinical-lab-table-empty">{emptyText}</span>;

  return (
    <div className={`clinical-lab-table-wrap clinical-lab-table-${density}`}>
      <table className="clinical-lab-table" aria-label="Key laboratory results">
        <tbody>
          {groups.map((group) => (
            <tr className={`clinical-lab-group clinical-lab-group-${group.tone}`} key={group.id}>
              <th scope="row" title={group.label}>{groupDisplayLabel(group, density)}</th>
              <td>
                <div className="clinical-lab-items">
                  {group.items.map((item) => (
                    <span
                      className={`clinical-lab-item clinical-lab-item-${item.tone}${item.label === "Microbiology" || item.text.length > 42 ? " clinical-lab-item-long" : ""}`}
                      key={`${group.id}-${item.key}-${item.sourceId || item.sourceIndex}`}
                    >
                      <LabItemContent
                        item={item}
                        keywordRules={keywordRules}
                        labReferenceDisplay={labReferenceDisplay}
                      />
                    </span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ClinicalLabTable;
