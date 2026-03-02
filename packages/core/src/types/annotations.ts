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

/** A single selected element within an annotation */
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

/** A text selection within an annotation */
export interface TextSelection {
  text: string;
  containingElement: SelectedElement;
  startOffset: number;
  endOffset: number;
}

/** A freehand drawing annotation (marker tool) */
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

/** An annotation targeting one or more elements in an iteration */
export interface AnnotationData {
  id: string;
  iteration: string;
  /** Selected elements this annotation targets */
  elements: SelectedElement[];
  /** Optional highlighted text selection */
  textSelection?: TextSelection;
  /** Optional freehand drawing (marker tool) */
  drawing?: DrawingData;
  comment: string;
  timestamp: number;

  // Classification (can be set by UI or inferred by agent)
  intent?: AnnotationIntent;
  severity?: AnnotationSeverity;

  // Agent workflow
  status: AnnotationStatus;
  resolvedBy?: "human" | "agent";
  agentReply?: string;
}
