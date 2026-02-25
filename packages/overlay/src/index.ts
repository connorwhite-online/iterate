export { IterateOverlay } from "./IterateOverlay.js";
export type { IterateOverlayProps, ToolMode } from "./IterateOverlay.js";

// Re-export sub-components for advanced usage
export { ElementPicker } from "./inspector/ElementPicker.js";
export type { PickedElement } from "./inspector/ElementPicker.js";
export { MarqueeSelect } from "./inspector/MarqueeSelect.js";
export { TextSelect } from "./inspector/TextSelect.js";
export { SelectionPanel } from "./annotate/SelectionPanel.js";
export { DragHandler } from "./manipulate/DragHandler.js";
export { DaemonConnection } from "./transport/connection.js";
export { FloatingPanel } from "./panel/FloatingPanel.js";

// Utilities
export {
  generateSelector,
  getRelevantStyles,
  identifyElement,
  getElementPath,
  getNearbyText,
  getComponentInfo,
} from "./inspector/selector.js";
