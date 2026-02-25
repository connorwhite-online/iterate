export { IterateOverlay } from "./IterateOverlay.js";
export type { IterateOverlayProps, ToolMode } from "./IterateOverlay.js";

// Re-export sub-components for advanced usage
export { SVGCanvas } from "./canvas/SVGCanvas.js";
export { ElementPicker } from "./inspector/ElementPicker.js";
export { AnnotationDialog } from "./annotate/AnnotationDialog.js";
export { DragHandler } from "./manipulate/DragHandler.js";
export { DaemonConnection } from "./transport/connection.js";

// Utilities
export { generateSelector, getRelevantStyles } from "./inspector/selector.js";
