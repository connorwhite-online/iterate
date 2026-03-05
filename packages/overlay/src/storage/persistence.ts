import type { Change, DomChange } from "iterate-ui-core";

export interface PersistedState {
  changes: Change[];
  domChanges: DomChange[];
}

function storageKey(iteration: string): string {
  return `iterate:state:${iteration}`;
}

/** Save daemon-synced state to localStorage as a backup cache. */
export function saveState(
  iteration: string,
  changes: Change[],
  domChanges: DomChange[],
): void {
  try {
    const data: PersistedState = { changes, domChanges };
    localStorage.setItem(storageKey(iteration), JSON.stringify(data));
  } catch {
    // localStorage unavailable or full — fail silently
  }
}

/** Load cached state from localStorage (used when daemon restarts with empty state). */
export function loadState(iteration: string): PersistedState | null {
  try {
    const raw = localStorage.getItem(storageKey(iteration));
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

/** Clear cached state for an iteration. */
export function clearState(iteration: string): void {
  try {
    localStorage.removeItem(storageKey(iteration));
  } catch {
    // fail silently
  }
}
