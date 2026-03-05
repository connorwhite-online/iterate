/** Bounding rectangle */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Agent workflow status */
export type ChangeStatus = "queued" | "in-progress" | "implemented";

/** A single selected element within a change */
export interface SelectedElement {
  selector: string;
  elementName: string;
  elementPath: string;
  rect: Rect;
  computedStyles: Record<string, string>;
  nearbyText?: string;
  /** React component name from babel plugin (e.g. "HeroSection") */
  componentName: string | null;
  /** Source file location from babel plugin (e.g. "src/Hero.tsx:42") */
  sourceLocation: string | null;
}

/** A text selection within a change */
export interface TextSelection {
  text: string;
  containingElement: SelectedElement;
  startOffset: number;
  endOffset: number;
}

/** A freehand drawing (marker tool) */
export interface DrawingData {
  /** SVG path data string (d attribute) */
  path: string;
  /** Bounding box of the drawing */
  bounds: Rect;
  /** Stroke color used */
  strokeColor: string;
  /** Stroke width used */
  strokeWidth: number;
}

/** A change targeting one or more elements in an iteration */
export interface Change {
  id: string;
  iteration: string;
  /** Page URL where the change was created */
  url?: string;
  /** Selected elements this change targets */
  elements: SelectedElement[];
  /** Optional highlighted text selection */
  textSelection?: TextSelection;
  /** Optional freehand drawing (marker tool) */
  drawing?: DrawingData;
  comment: string;
  timestamp: number;
  /** Page-absolute coordinates for badge placement (scrolls naturally with the document) */
  pagePosition?: { x: number; y: number };
  /** True if the annotated element is position:fixed or position:sticky — badge renders
   *  in a fixed layer (viewport coords) instead of the absolute layer (page coords). */
  isFixedPosition?: boolean;
  /** Scroll offset when drawing was created (to convert viewport drawing coords to page coords) */
  drawingScrollOffset?: { x: number; y: number };

  // Agent workflow
  status: ChangeStatus;
  implementedBy?: "human" | "agent";
  agentSummary?: string;
}
