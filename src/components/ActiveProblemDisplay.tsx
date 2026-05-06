import type { ActiveProblemItem } from "../types";

interface ActiveProblemDisplayProps {
  items: ActiveProblemItem[];
  fallbackItems: string[];
}

function ActiveProblemDisplay({ items, fallbackItems }: ActiveProblemDisplayProps) {
  const sortedItems = [...items].sort((a, b) => a.order - b.order).filter((item) => item.title.trim());

  if (sortedItems.length === 0) {
    return (
      <div className="compact-items">
        {fallbackItems.map((item, index) => (
          <span className="compact-item" key={`${item}-${index}`}>{item}</span>
        ))}
      </div>
    );
  }

  return (
    <div className="active-problem-chip-row">
      {sortedItems.map((item, index) => (
        <span className={`active-problem-chip ${item.isImportant ? "important-ap-card" : ""}`} key={item.id || index}>
          <span className="clinical-number-badge">{index + 1}</span>
          <strong>{item.title}</strong>
          {item.note && <span className="muted">{item.note}</span>}
        </span>
      ))}
    </div>
  );
}

export default ActiveProblemDisplay;
