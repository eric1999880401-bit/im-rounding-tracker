import { useRef, type RefObject } from "react";

export type SelectableControl = HTMLTextAreaElement | HTMLInputElement;

export interface SelectionRange {
  start: number;
  end: number;
}

// Touch browsers can collapse the text selection before a toolbar button click lands,
// so remember the last non-empty selection and fall back to it when applying colors.
export function useSelectionRange(controlRef: RefObject<SelectableControl | null>) {
  const lastSelectionRef = useRef<SelectionRange>({ start: 0, end: 0 });

  function rememberSelection() {
    const control = controlRef.current;
    if (!control) return;
    const start = control.selectionStart ?? 0;
    const end = control.selectionEnd ?? 0;
    if (start !== end) lastSelectionRef.current = { start, end };
  }

  function getSelectionRange(valueLength: number): SelectionRange | null {
    const control = controlRef.current;
    if (!control) return null;
    const start = control.selectionStart ?? 0;
    const end = control.selectionEnd ?? 0;
    if (start !== end) return { start, end };
    const stored = lastSelectionRef.current;
    if (stored.end > stored.start && stored.end <= valueLength) return stored;
    return null;
  }

  function clearSelection() {
    lastSelectionRef.current = { start: 0, end: 0 };
  }

  return { rememberSelection, getSelectionRange, clearSelection };
}
