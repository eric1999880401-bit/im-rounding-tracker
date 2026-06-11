import { useRef, type ClipboardEvent } from "react";
import {
  applyClinicalColorMarkup,
  clearClinicalColorMarkupAtSelection,
  clinicalMarkColors,
  type ClinicalMarkColor,
} from "../clinicalColorMarkup";
import { hasColorMarkup } from "../utils";
import { ClinicalInlineText } from "./ClinicalText";
import { useSelectionRange } from "./useSelectionRange";

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
  const { rememberSelection, getSelectionRange } = useSelectionRange(textareaRef);

  function applySelection(nextValue: string, start: number, selectedLength: number) {
    onChange(nextValue);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start, start + selectedLength);
    }, 0);
  }

  function markColor(color: ClinicalMarkColor) {
    const range = getSelectionRange(value.length);
    if (!range) return;

    const selectedText = value.slice(range.start, range.end);
    applySelection(
      applyClinicalColorMarkup(value, range.start, range.end, color),
      range.start + `[[${color}:`.length,
      selectedText.length,
    );
  }

  function clearColor() {
    const range = getSelectionRange(value.length);
    if (!range) return;
    applySelection(clearClinicalColorMarkupAtSelection(value, range.start, range.end), range.start, value.slice(range.start, range.end).length);
  }

  return (
    <div className="color-textarea">
      <textarea
        ref={textareaRef}
        className={className}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onSelect={rememberSelection}
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
      {hasColorMarkup(value) && (
        <div className="color-markup-preview" aria-label="Color preview">
          {value.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => (
            <div key={`${line}-${index}`}>
              <ClinicalInlineText value={line} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ColorMarkupTextarea;
