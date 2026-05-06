import { useRef } from "react";

interface ColorMarkupTextareaProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  placeholder?: string;
  className?: string;
}

const colors = ["red", "orange", "yellow", "blue", "green", "purple"] as const;

function ColorMarkupTextarea({
  value,
  onChange,
  onBlur,
  onCompositionStart,
  onCompositionEnd,
  placeholder,
  className,
}: ColorMarkupTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function markColor(color: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start === end) return;

    const selectedText = value.slice(start, end);
    const markerStart = `[[${color}:`;
    const markerEnd = "]]";
    const nextValue = `${value.slice(0, start)}${markerStart}${selectedText}${markerEnd}${value.slice(end)}`;
    onChange(nextValue);

    window.setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + markerStart.length, end + markerStart.length);
    }, 0);
  }

  return (
    <div className="color-textarea">
      <textarea
        ref={textareaRef}
        className={className}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        placeholder={placeholder}
      />
      <div className="color-toolbar" aria-label="Color selected text">
        {colors.map((color) => (
          <button
            type="button"
            className={`color-tool color-tool-${color}`}
            key={color}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => markColor(color)}
            title={`Mark selected text ${color}`}
          >
            {color}
          </button>
        ))}
      </div>
    </div>
  );
}

export default ColorMarkupTextarea;
