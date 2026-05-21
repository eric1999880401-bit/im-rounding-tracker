import { useRef, type ClipboardEvent } from "react";
import {
  applyClinicalColorMarkup,
  clearClinicalColorMarkupAtSelection,
  clinicalMarkColors,
  type ClinicalMarkColor,
} from "../clinicalColorMarkup";

interface ColorMarkupTextareaProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  className?: string;
}

function ColorMarkupTextarea({
  value,
  onChange,
  onBlur,
  onCompositionStart,
  onCompositionEnd,
  onPaste,
  placeholder,
  className,
}: ColorMarkupTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function applySelection(nextValue: string, start: number, selectedLength: number) {
    onChange(nextValue);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start, start + selectedLength);
    }, 0);
  }

  function markColor(color: ClinicalMarkColor) {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start === end) return;

    const selectedText = value.slice(start, end);
    applySelection(applyClinicalColorMarkup(value, start, end, color), start + `[[${color}:`.length, selectedText.length);
  }

  function clearColor() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start === end) return;
    applySelection(clearClinicalColorMarkupAtSelection(value, start, end), start, value.slice(start, end).length);
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
        onPaste={onPaste}
        placeholder={placeholder}
      />
      <div className="color-toolbar" aria-label="Color selected text">
        {clinicalMarkColors.map((color) => (
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
        <button type="button" className="color-tool color-tool-clear" onMouseDown={(event) => event.preventDefault()} onClick={clearColor} title="Clear selected color">
          clear
        </button>
      </div>
    </div>
  );
}

export default ColorMarkupTextarea;
