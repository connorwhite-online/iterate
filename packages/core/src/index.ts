// Types
export type {
  Change,
  SelectedElement,
  TextSelection,
  DrawingData,
  Rect,
  ChangeStatus,
  AnimationSnapshot,
} from "./types/annotations.js";
export type { IterationInfo, IterationStatus, IterationSource } from "./types/iterations.js";
export type { DomChange, DomSnapshot } from "./types/dom.js";
export type { IterateConfig } from "./types/config.js";
export { DEFAULT_CONFIG } from "./types/config.js";

// Protocol
export type {
  ClientMessage,
  ServerMessage,
  IterateState,
} from "./protocol/messages.js";

// Formatting
export { formatBatchPrompt } from "./format.js";
export type { FormatChange, FormatDomChange } from "./format.js";
