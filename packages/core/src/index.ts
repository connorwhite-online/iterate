// Types
export type {
  Change,
  SelectedElement,
  TextSelection,
  DrawingData,
  Rect,
  ChangeStatus,
  SnapshotNode,
  PageSnapshot,
  CritiqueSeverity,
  CritiqueFindingStatus,
  CritiqueRequestStatus,
  CritiqueFinding,
  CritiqueRequest,
} from "./types/annotations.js";
export type { IterationInfo, IterationStatus, IterationSource } from "./types/iterations.js";
export type { DomChange, DomSnapshot } from "./types/dom.js";
export type { IterateConfig, AppConfig } from "./types/config.js";
export {
  DEFAULT_CONFIG,
  normalizeConfig,
  getApp,
  findApp,
  getDefaultApp,
} from "./types/config.js";

// Protocol
export type {
  ClientMessage,
  ServerMessage,
  IterateState,
  PhaseTimings,
} from "./protocol/messages.js";

// Formatting
export { formatBatchPrompt, formatCritiquePrompt } from "./format.js";
export type { FormatChange, FormatDomChange } from "./format.js";

// Design knowledge
export { DESIGN_PRINCIPLES, getPrinciple, selectPrinciples } from "./knowledge/index.js";
export type { DesignPrinciple, PrincipleCategory } from "./knowledge/index.js";
