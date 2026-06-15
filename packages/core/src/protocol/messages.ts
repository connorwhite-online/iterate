import type { Change, Rect } from "../types/annotations.js";
import type { IterationInfo, IterationStatus } from "../types/iterations.js";
import type { DomChange } from "../types/dom.js";
import type { IterateConfig } from "../types/config.js";

/**
 * Per-phase wall-clock durations (milliseconds) for an iteration's creation
 * pipeline — install, build, dev-server boot, etc., plus a `total`. Keyed by
 * phase name so new phases (e.g. clone/copy, warmup) can be added without a
 * type change. Always optional and additive: clients that don't know about it
 * ignore it. Pairs with the CON-124 progress UI (elapsed-per-phase display).
 */
export type PhaseTimings = Record<string, number>;

// --- Client → Server messages (browser overlay → daemon) ---

export type ClientMessage =
  | { type: "change:create"; payload: Omit<Change, "id" | "timestamp" | "status"> }
  | { type: "change:delete"; payload: { id: string } }
  | { type: "dom-change:create"; payload: Omit<DomChange, "id" | "timestamp"> }
  | { type: "dom-change:delete"; payload: { id: string } }
  | { type: "batch:submit"; payload: {
      iteration: string;
      changes: Omit<Change, "id" | "timestamp" | "status">[];
      domChanges: DomChange[];
    }}
  | { type: "dom:select"; payload: { iteration: string; selector: string } }
  | { type: "dom:move"; payload: { iteration: string; selector: string; from: Rect; to: Rect } }
  | { type: "dom:reorder"; payload: { iteration: string; selector: string; newIndex: number } }
  | { type: "dom:resize"; payload: { iteration: string; selector: string; from: Rect; to: Rect } }
  | { type: "iteration:switch"; payload: { iteration: string } }
  | { type: "iteration:compare"; payload: { iterations: [string, string] } }
  | { type: "tool:set-mode"; payload: { mode: string } };

// --- Server → Client messages (daemon → browser overlay) ---

export type ServerMessage =
  | { type: "state:sync"; payload: IterateState }
  | { type: "iteration:created"; payload: IterationInfo }
  | { type: "iteration:removed"; payload: { name: string } }
  | { type: "iteration:status"; payload: { name: string; status: IterationStatus; error?: string; timings?: PhaseTimings } }
  | { type: "change:created"; payload: Change }
  | { type: "change:updated"; payload: Change }
  | { type: "change:deleted"; payload: { id: string } }
  | { type: "batch:submitted"; payload: { batchId: string; changeCount: number; domChangeCount: number } }
  | { type: "dom:changed"; payload: DomChange }
  | { type: "dom:deleted"; payload: { id: string } }
  | { type: "command:started"; payload: { commandId: string; prompt: string; iterations: string[] } }
  | { type: "tool:mode-changed"; payload: { mode: string } }
  | { type: "error"; payload: { message: string } };

/** Full state synced on WebSocket connection */
export interface IterateState {
  config: IterateConfig;
  iterations: Record<string, IterationInfo>;
  changes: Change[];
  domChanges: DomChange[];
}
