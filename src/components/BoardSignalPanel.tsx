import { splitHighlightLines } from "../utils";

interface BoardSignalPanelProps {
  value: string;
  fallback?: string;
  kind: "objective" | "lab" | "image";
  maxItems?: number;
}

function parseSignal(rawText: string, kind: BoardSignalPanelProps["kind"]) {
  const clean = rawText.replace(/^!+/, "").trim();
  const match = clean.match(/^([^:]{1,22}):\s*(.+)$/);
  const rawLabel = match?.[1]?.trim() || (kind === "objective" ? "Signal" : kind === "lab" ? "Lab" : "Image");
  const label = /^(critical|urgent)$/i.test(rawLabel) ? "*" : rawLabel;
  const text = (match?.[2]?.trim() || clean)
    .replace(/\[\s*URGENT\s*\]\s*/gi, "* ")
    .replace(/\bhigh-normal\b/gi, "\u2197 nl")
    .replace(/\blow-normal\b/gi, "\u2198 nl")
    .replace(/\bhigh\b/gi, "\u2191")
    .replace(/\blow\b/gi, "\u2193");
  const severity = /^crit\b/i.test(label) ? "critical" : /^abn\b/i.test(label) ? "abnormal" : /^trend\b/i.test(label) ? "trend" : /^anchor\b/i.test(label) ? "anchor" : "";
  const important =
    rawText.trim().startsWith("!") ||
    /^(?:crit|abn)\b/i.test(label) ||
    /critical|urgent|red flag|desat|hypox|hypot|shock|fever|hb drop|aki|k\s*(?:[5-9]|[0-2](?:\.\d+)?)|cr\s*[2-9]|worse|pending/i.test(clean);

  return { label, text, important, severity };
}

export function BoardSignalPanel({ value, fallback = "-", kind, maxItems = 4 }: BoardSignalPanelProps) {
  const signals = splitHighlightLines(value)
    .map((line) => parseSignal(`${line.important ? "!" : ""}${line.text}`, kind))
    .filter((signal) => signal.text)
    .slice(0, maxItems);

  if (signals.length === 0) return <span className="muted">{fallback}</span>;

  return (
    <div className={`board-signal-panel board-signal-${kind}`}>
      {signals.map((signal, index) => (
        <div
          className={[
            "board-signal-card",
            signal.important ? "important-board-signal" : "",
            signal.severity ? `board-signal-${signal.severity}` : "",
          ].filter(Boolean).join(" ")}
          key={`${signal.label}-${signal.text}-${index}`}
        >
          <span className="board-signal-label">{signal.label}</span>
          <span className="board-signal-text">{signal.text}</span>
        </div>
      ))}
    </div>
  );
}
