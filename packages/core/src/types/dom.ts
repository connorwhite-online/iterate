import type { Rect } from "./annotations.js";

/** A recorded DOM manipulation (move, reorder, resize) */
export interface DomChange {
  id: string;
  iteration: string;
  selector: string;
  type: "move" | "reorder" | "resize" | "style";
  /** React component name from babel plugin */
  componentName: string | null;
  /** Source file location from babel plugin */
  sourceLocation: string | null;
  before: DomSnapshot;
  after: DomSnapshot;
  timestamp: number;
}

/** Snapshot of a DOM element's layout state */
export interface DomSnapshot {
  rect: Rect;
  computedStyles: Record<string, string>;
  /** Index among siblings (for flex reorder) */
  siblingIndex?: number;
}
