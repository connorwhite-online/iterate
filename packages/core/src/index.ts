// Types
export type {
  AnnotationData,
  SVGPathData,
  Rect,
  AnnotationIntent,
  AnnotationSeverity,
  AnnotationStatus,
} from "./types/annotations.js";
export type { IterationInfo, IterationStatus } from "./types/iterations.js";
export type { DomChange, DomSnapshot } from "./types/dom.js";
export type { IterateConfig } from "./types/config.js";
export { DEFAULT_CONFIG } from "./types/config.js";

// Protocol
export type {
  ClientMessage,
  ServerMessage,
  IterateState,
} from "./protocol/messages.js";
