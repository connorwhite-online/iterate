/** SVG path data for freehand drawings (circles, arrows, etc.) */
export interface SVGPathData {
  d: string;
  stroke: string;
  strokeWidth: number;
  fill: string;
}

/** Bounding rectangle */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What does the user want done? (inspired by agentation) */
export type AnnotationIntent = "fix" | "change" | "question" | "approve";

/** How important is this? */
export type AnnotationSeverity = "blocking" | "important" | "suggestion";

/** Agent workflow status */
export type AnnotationStatus = "pending" | "acknowledged" | "resolved" | "dismissed";

/** An annotation placed on an element in an iteration */
export interface AnnotationData {
  id: string;
  iteration: string;
  selector: string;
  elementName: string;
  elementPath: string;
  rect: Rect;
  computedStyles: Record<string, string>;
  drawing?: SVGPathData;
  comment: string;
  timestamp: number;

  // Classification (can be set by UI or inferred by agent)
  intent?: AnnotationIntent;
  severity?: AnnotationSeverity;

  // Agent workflow
  status: AnnotationStatus;
  resolvedBy?: "human" | "agent";
  agentReply?: string;

  // Extra context
  nearbyText?: string;
  reactComponent?: string;
}
