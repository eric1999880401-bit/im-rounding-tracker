import { useMemo } from "react";
import { formatLabVisualSummaryFromLines, type LabVisualGroup } from "../labVisualSummary";
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

function visibleGroups(groups: LabVisualGroup[], density: ClinicalLabTableDensity) {
  if (density === "detail") return groups;
  const limit = density === "board" ? 5 : 6;
  const mandatory = new Set(groups.filter((group) => group.tone !== "plain").map((group) => group.id));
  const selected = new Set(mandatory);
  groups.forEach((group) => {
    if (selected.size < limit) selected.add(group.id);
  });
  return groups.filter((group) => selected.has(group.id));
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
      maxItemsPerGroup: density === "detail" ? 10 : 8,
    }),
    [density, source],
  );
  const groups = visibleGroups(summary.groups, density);

  if (groups.length === 0) return <span className="clinical-lab-table-empty">{emptyText}</span>;

  return (
    <div className={`clinical-lab-table-wrap clinical-lab-table-${density}`}>
      <table className="clinical-lab-table" aria-label="Key laboratory results">
        <tbody>
          {groups.map((group) => (
            <tr className={`clinical-lab-group clinical-lab-group-${group.tone}`} key={group.id}>
              <th scope="row">{group.label}</th>
              <td>
                <div className="clinical-lab-items">
                  {group.items.map((item) => (
                    <span
                      className={`clinical-lab-item clinical-lab-item-${item.tone}${item.label === "Microbiology" || item.text.length > 42 ? " clinical-lab-item-long" : ""}`}
                      key={`${group.id}-${item.key}-${item.sourceId || item.sourceIndex}`}
                    >
                      <ClinicalInlineText
                        value={item.text}
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
