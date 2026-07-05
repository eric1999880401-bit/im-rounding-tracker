import type { ClipboardEvent } from "react";

// Historically wrapped the textarea with manual color-markup buttons; those
// were removed (user request: raw [[color:...]] markup in plain textareas was
// noisy and error-prone). Existing stored color marks still render everywhere
// via ClinicalText; automatic keyword highlighting lives in Settings.
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
  return (
    <textarea
      className={className}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
      onPaste={onPaste}
      placeholder={placeholder}
    />
  );
}

export default ColorMarkupTextarea;
