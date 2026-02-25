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

/** An annotation placed on an element in an iteration */
export interface AnnotationData {
  id: string;
  iteration: string;
  selector: string;
  rect: Rect;
  computedStyles: Record<string, string>;
  drawing?: SVGPathData;
  comment: string;
  timestamp: number;
}
