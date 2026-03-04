import type { PendingAnnotation } from "../IterateOverlay.js";
import type { PendingMove } from "../manipulate/DragHandler.js";

export interface PersistedState {
  pendingBatch: PendingAnnotation[];
  pendingMoves: PendingMove[];
  undoStack: Array<"annotation" | "move">;
}

function storageKey(iteration: string): string {
  return `iterate:pending:${iteration}`;
}

export function savePendingState(
  iteration: string,
  batch: PendingAnnotation[],
  moves: PendingMove[],
  undoStack: Array<"annotation" | "move">,
): void {
  try {
    const data: PersistedState = { pendingBatch: batch, pendingMoves: moves, undoStack };
    localStorage.setItem(storageKey(iteration), JSON.stringify(data));
  } catch {
    // localStorage unavailable or full — fail silently
  }
}

export function loadPendingState(iteration: string): PersistedState | null {
  try {
    const raw = localStorage.getItem(storageKey(iteration));
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

export function clearPendingState(iteration: string): void {
  try {
    localStorage.removeItem(storageKey(iteration));
  } catch {
    // fail silently
  }
}
