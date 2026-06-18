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

/**
 * One captured element in a page snapshot — the serializable subset of a
 * "picked" element (no live DOM node). Field-compatible with SelectedElement
 * so findings can be passed straight into the change:create path.
 */
export interface SnapshotNode {
  selector: string;
  elementName: string;
  /** Lowercase tag name (e.g. "button") — drives principle selection */
  tagName: string;
  elementPath: string;
  rect: Rect;
  computedStyles: Record<string, string>;
  nearbyText?: string;
  componentName: string | null;
  sourceLocation: string | null;
  /** Depth in the captured tree (0 = root) — lets the agent reason about hierarchy */
  depth: number;
  /** True if position:fixed/sticky — badge renders in the fixed (viewport) layer */
  isFixed?: boolean;
}

/** A DOM/style snapshot of a page (or region), sent to the agent for critique */
export interface PageSnapshot {
  url: string;
  /** Viewport size at capture time (for responsive reasoning) */
  viewport: { width: number; height: number };
  capturedAt: number;
  /** Optional region the snapshot was limited to (page coords) */
  region?: Rect;
  nodes: SnapshotNode[];
}

/** Severity of a critique finding */
export type CritiqueSeverity = "high" | "medium" | "low";

/** Lifecycle of a single finding */
export type CritiqueFindingStatus = "open" | "applied" | "dismissed";

/** Lifecycle of a critique run */
export type CritiqueRequestStatus = "pending" | "in-progress" | "complete";

/** One prioritized, element-anchored design finding from the agent */
export interface CritiqueFinding {
  id: string;
  iteration: string;
  /** Page URL where the finding was raised */
  url?: string;
  /** Critique run this finding belongs to */
  requestId: string;
  /** The principle this finding cites (id into the corpus) */
  principleId: string;
  principleTitle: string;
  /** typography | spacing | color | hierarchy | a11y | interaction */
  category: string;
  severity: CritiqueSeverity;
  /** The element this finding is anchored to */
  element: SnapshotNode;
  /** Why it's a problem — includes measured-vs-target where possible */
  rationale: string;
  /** Measured value, e.g. "contrast 3.1:1" */
  measured?: string;
  /** Target value, e.g. "≥ 4.5:1 (WCAG AA)" */
  target?: string;
  /** Concrete fix the user can Apply */
  recommendation: string;
  /** Page-absolute coordinates for badge placement (same semantics as Change) */
  pagePosition?: { x: number; y: number };
  /** True if the anchored element is position:fixed/sticky (badge in fixed layer) */
  isFixedPosition?: boolean;
  status: CritiqueFindingStatus;
}

/** A critique run: snapshot in, findings out */
export interface CritiqueRequest {
  id: string;
  iteration: string;
  /** Page URL the snapshot was captured from */
  url?: string;
  snapshot: PageSnapshot;
  status: CritiqueRequestStatus;
  timestamp: number;
}
