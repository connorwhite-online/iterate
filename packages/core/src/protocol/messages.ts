import type { AnnotationData, Rect } from "../types/annotations.js";
import type { IterationInfo, IterationStatus } from "../types/iterations.js";
import type { DomChange } from "../types/dom.js";
import type { IterateConfig } from "../types/config.js";

// --- Client → Server messages (browser overlay → daemon) ---

export type ClientMessage =
  | { type: "annotation:create"; payload: Omit<AnnotationData, "id" | "timestamp" | "status"> }
  | { type: "annotation:delete"; payload: { id: string } }
  | { type: "batch:submit"; payload: {
      iteration: string;
      annotations: Omit<AnnotationData, "id" | "timestamp" | "status">[];
      domChanges: DomChange[];
    }}
  | { type: "dom:select"; payload: { iteration: string; selector: string } }
  | { type: "dom:move"; payload: { iteration: string; selector: string; from: Rect; to: Rect } }
  | { type: "dom:reorder"; payload: { iteration: string; selector: string; newIndex: number } }
  | { type: "dom:resize"; payload: { iteration: string; selector: string; from: Rect; to: Rect } }
  | { type: "iteration:switch"; payload: { iteration: string } }
  | { type: "iteration:compare"; payload: { iterations: [string, string] } };

// --- Server → Client messages (daemon → browser overlay) ---

export type ServerMessage =
  | { type: "state:sync"; payload: IterateState }
  | { type: "iteration:created"; payload: IterationInfo }
  | { type: "iteration:removed"; payload: { name: string } }
  | { type: "iteration:status"; payload: { name: string; status: IterationStatus } }
  | { type: "annotation:created"; payload: AnnotationData }
  | { type: "annotation:updated"; payload: AnnotationData }
  | { type: "annotation:deleted"; payload: { id: string } }
  | { type: "batch:submitted"; payload: { batchId: string; annotationCount: number; domChangeCount: number } }
  | { type: "dom:changed"; payload: DomChange }
  | { type: "command:started"; payload: { commandId: string; prompt: string; iterations: string[] } }
  | { type: "error"; payload: { message: string } };

/** Full state synced on WebSocket connection */
export interface IterateState {
  config: IterateConfig;
  iterations: Record<string, IterationInfo>;
  annotations: AnnotationData[];
  domChanges: DomChange[];
}
