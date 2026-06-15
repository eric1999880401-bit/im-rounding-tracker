export interface UndoRedoHistory<T> {
  past: T[];
  present: T;
  future: T[];
  limit: number;
}

export interface UndoRedoResult<T> {
  history: UndoRedoHistory<T>;
  changed: boolean;
}

function defaultEquals<T>(left: T, right: T) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createUndoRedoHistory<T>(present: T, limit = 80): UndoRedoHistory<T> {
  return {
    past: [],
    present,
    future: [],
    limit,
  };
}

export function replaceUndoRedoPresent<T>(history: UndoRedoHistory<T>, present: T): UndoRedoHistory<T> {
  return {
    ...history,
    past: [],
    present,
    future: [],
  };
}

export function pushUndoRedoEdit<T>(
  history: UndoRedoHistory<T>,
  nextPresent: T,
  equals: (left: T, right: T) => boolean = defaultEquals,
): UndoRedoHistory<T> {
  if (equals(history.present, nextPresent)) return history;
  return {
    ...history,
    past: [...history.past, history.present].slice(-history.limit),
    present: nextPresent,
    future: [],
  };
}

export function undoEdit<T>(history: UndoRedoHistory<T>): UndoRedoResult<T> {
  if (history.past.length === 0) return { history, changed: false };
  const present = history.past[history.past.length - 1];
  return {
    history: {
      ...history,
      past: history.past.slice(0, -1),
      present,
      future: [history.present, ...history.future].slice(0, history.limit),
    },
    changed: true,
  };
}

export function redoEdit<T>(history: UndoRedoHistory<T>): UndoRedoResult<T> {
  if (history.future.length === 0) return { history, changed: false };
  const present = history.future[0];
  return {
    history: {
      ...history,
      past: [...history.past, history.present].slice(-history.limit),
      present,
      future: history.future.slice(1),
    },
    changed: true,
  };
}

export function canUndo<T>(history: UndoRedoHistory<T>) {
  return history.past.length > 0;
}

export function canRedo<T>(history: UndoRedoHistory<T>) {
  return history.future.length > 0;
}

