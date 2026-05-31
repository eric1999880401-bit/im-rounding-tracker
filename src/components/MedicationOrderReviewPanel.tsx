import { useEffect, useMemo, useState } from "react";
import type { ClinicalLineTone } from "../clinicalLineClassifier";
import {
  medicationOrderCategoryLabel,
  medicationOrderCategoryOptions,
  medicationOrderTone,
  parseMedicationOrders,
  summarizeMedicationOrders,
  type MedicationOrderCategory,
  type MedicationOrderDraft,
  type MedicationOrderImportance,
} from "../medicationOrderParser";

export interface MedicationOrderSummaryLine {
  text: string;
  tone: ClinicalLineTone;
}

interface EditableMedicationOrder extends MedicationOrderDraft {
  selected: boolean;
}

interface MedicationOrderReviewPanelProps {
  sourceText?: string;
  compact?: boolean;
  onApply: (lines: MedicationOrderSummaryLine[]) => void;
}

const importanceOptions: Array<{ value: MedicationOrderImportance; label: string }> = [
  { value: "critical", label: "Critical" },
  { value: "important", label: "Important" },
  { value: "normal", label: "Normal" },
  { value: "routine", label: "Routine (hidden from list)" },
];

function buildEditableOrders(rawText: string): EditableMedicationOrder[] {
  return parseMedicationOrders(rawText).map((order) => ({
    ...order,
    selected: !order.hiddenReason,
  }));
}

function toneFromOrders(orders: EditableMedicationOrder[], summary: string): ClinicalLineTone {
  const summaryText = summary.toLowerCase();
  const matched = orders.filter((order) => {
    const medicationName = order.medicationName.toLowerCase().trim();
    const displayPrefix = order.displayText.toLowerCase().trim().slice(0, 24);
    return Boolean(medicationName && summaryText.includes(medicationName)) || Boolean(displayPrefix && summaryText.includes(displayPrefix));
  });
  const source = matched.length > 0 ? matched : orders;
  if (source.some((order) => medicationOrderTone(order) === "critical")) return "critical";
  if (source.some((order) => medicationOrderTone(order) === "important")) return "important";
  return "plain";
}

export function MedicationOrderReviewPanel({ sourceText = "", compact = false, onApply }: MedicationOrderReviewPanelProps) {
  const [rawText, setRawText] = useState("");
  const [orders, setOrders] = useState<EditableMedicationOrder[]>([]);
  const [status, setStatus] = useState("");
  const sourceHasText = sourceText.trim().length > 0;

  useEffect(() => {
    if (rawText.trim() || !sourceHasText) return;
    setRawText(sourceText);
  }, [rawText, sourceHasText, sourceText]);

  const selectedOrders = orders.filter((order) => order.selected && order.displayText.trim());
  const selectedOrdersForSummary = selectedOrders.map((order) => ({ ...order, hiddenReason: "" }));
  const hiddenCount = orders.filter((order) => !order.selected).length;
  const summaryLines = useMemo(() => summarizeMedicationOrders(selectedOrdersForSummary, { maxLines: compact ? 4 : 6, mode: "summary" }), [compact, selectedOrdersForSummary]);

  function handlePreview() {
    const nextOrders = buildEditableOrders(rawText);
    setOrders(nextOrders);
    setStatus(nextOrders.length > 0 ? `${nextOrders.length} orders parsed. Review before Apply.` : "No recognizable order lines found.");
  }

  function updateOrder(id: string, patch: Partial<EditableMedicationOrder>) {
    setOrders((current) => current.map((order) => (order.id === id ? { ...order, ...patch } : order)));
  }

  function applyToDraft() {
    const lines = summaryLines.map((line) => ({
      text: line,
      tone: toneFromOrders(selectedOrders, line),
    }));
    onApply(lines);
    setStatus(`${lines.length} summarized order line(s) applied to local SOAP draft. Save reviewed SOAP to write Firestore.`);
  }

  return (
    <details className="med-order-panel">
      <summary>整理藥囑</summary>
      <div className="med-order-panel-body">
        <div className="med-order-intro">
          <div>
            <strong>Paste HIS order text</strong>
            <p className="muted">Rules clean obvious order noise. Raw pasted text stays local and is not saved.</p>
          </div>
          <div className="form-actions">
            {sourceHasText && (
              <button type="button" className="secondary compact-button" onClick={() => setRawText(sourceText)}>
                載入上方藥囑
              </button>
            )}
            <button type="button" className="secondary compact-button" disabled={!rawText.trim()} onClick={handlePreview}>
              Preview cleanup
            </button>
          </div>
        </div>
        <textarea
          className="med-order-raw-textarea"
          value={rawText}
          onChange={(event) => setRawText(event.target.value)}
          placeholder="Paste copied HIS medication/orders here. Tables, dates, route/frequency, PRN, hold/resume/start/stop are accepted."
          rows={compact ? 4 : 6}
        />
        {status && <p className="status-message">{status}</p>}

        {orders.length > 0 && (
          <div className="med-order-review-grid">
            <div className="med-order-summary-card">
              <div className="med-order-summary-heading">
                <strong>查房摘要 preview</strong>
                <span>{summaryLines.length} shown / {hiddenCount} hidden</span>
              </div>
              {summaryLines.length > 0 ? (
                <div className="med-order-summary-lines">
                  {summaryLines.map((line) => (
                    <div className="med-order-summary-line" key={line}>{line}</div>
                  ))}
                </div>
              ) : (
                <p className="muted">No selected high-yield order yet.</p>
              )}
              <button type="button" disabled={summaryLines.length === 0} onClick={applyToDraft}>
                Apply to SOAP draft
              </button>
            </div>

            <div className="med-order-review-list">
              {orders.map((order) => (
                <article className={order.hiddenReason ? "med-order-row med-order-row-hidden" : `med-order-row med-order-row-${order.importance}`} key={order.id}>
                  <label className="checkbox-label med-order-row-check">
                    <input type="checkbox" checked={order.selected} onChange={(event) => updateOrder(order.id, { selected: event.target.checked })} />
                    <span>{order.selected ? "Show" : "Hide"}</span>
                  </label>
                  <input
                    value={order.displayText}
                    onChange={(event) => updateOrder(order.id, { displayText: event.target.value })}
                    aria-label="Order summary"
                  />
                  <select value={order.category} onChange={(event) => updateOrder(order.id, { category: event.target.value as MedicationOrderCategory })}>
                    {medicationOrderCategoryOptions.map((option) => (
                      <option value={option.value} key={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <select value={order.importance} onChange={(event) => updateOrder(order.id, { importance: event.target.value as MedicationOrderImportance })}>
                    {importanceOptions.map((option) => (
                      <option value={option.value} key={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <div className="med-order-row-meta">
                    <span>{medicationOrderCategoryLabel(order.category)}</span>
                    {order.route && <span>{order.route}</span>}
                    {order.frequency && <span>{order.frequency}</span>}
                    {order.duration && <span>{order.duration}</span>}
                    {order.hiddenReason && <span>{order.hiddenReason}</span>}
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

export default MedicationOrderReviewPanel;
