import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ToolMode } from "../IterateOverlay.js";
import type { IterationInfo, IterationStatus } from "@iterate/core";
import {
  CursorIcon,
  MoveIcon,
  MarkerIcon,
  SendIcon,
  CloseIcon,
  LogoIcon,
  TrashIcon,
  CopyIcon,
  UndoIcon,
  PreviewIcon,
  ForkIcon,
  PickIcon,
  SpinnerIcon,
  DiscardIcon,
} from "./icons.js";

export const ORIGINAL_TAB = "__original__";

export interface FloatingPanelProps {
  mode: ToolMode;
  onModeChange: (mode: ToolMode) => void;
  visible: boolean;
  onVisibilityChange: (visible: boolean) => void;
  /** Number of annotations in the pending batch */
  batchCount?: number;
  /** Number of pending moves */
  moveCount?: number;
  /** Called when user clicks Submit */
  onSubmitBatch?: () => void;
  /** Called when user clicks Trash (clear all annotations and moves) */
  onClearBatch?: () => void;
  /** Called when user clicks Copy (copy annotations to clipboard) */
  onCopyBatch?: () => void;
  /** Called when user clicks Undo (revert last move) */
  onUndoMove?: () => void;
  /** Whether live preview mode is active */
  previewMode?: boolean;
  /** Toggle live preview mode */
  onPreviewModeChange?: (enabled: boolean) => void;
  /** Available iterations (from daemon state) */
  iterations?: Record<string, IterationInfo>;
  /** Currently active iteration name */
  activeIteration?: string;
  /** Called when user switches iteration */
  onIterationChange?: (name: string) => void;
  /** Called when user wants to create iterations (fork) */
  onFork?: () => void;
  /** Called when user wants to pick the active iteration */
  onPick?: (name: string) => void | Promise<void>;
  /** Called when user wants to discard all iterations and keep original */
  onDiscard?: () => void | Promise<void>;
  /** Whether currently viewing an iteration (not Original) */
  isViewingIteration?: boolean;
}

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const PANEL_MARGIN = 16;
const ICON_SIZE = 24;

// Spring-like cubic bezier
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

// Duration for suspense overlay animations (spinner + text sync)
const SUSPENSE_DURATION = "1.2s";

const STATUS_COLORS: Record<IterationStatus, string> = {
  ready: "#22c55e",
  creating: "#eab308",
  installing: "#eab308",
  starting: "#eab308",
  error: "#ef4444",
  stopped: "#888",
};

/**
 * Floating toolbar panel with icon-based tools and iteration selector.
 * Single container that animates between collapsed (logo only) and expanded states.
 * Can be dragged to any corner of the screen.
 *
 * Toolbar sections (separated by dividers):
 * 1. Annotation tools (cursor, move)
 * 2. Revision tools (undo, preview, trash)
 * 3. Agent context tools (send, copy)
 * 4. Branching tools (fork/iterate, merge/pick, discard)
 * 5. Close/open toggle
 */
export function FloatingPanel({
  mode,
  onModeChange,
  visible,
  onVisibilityChange,
  batchCount = 0,
  moveCount = 0,
  onSubmitBatch,
  onClearBatch,
  onCopyBatch,
  onUndoMove,
  previewMode = true,
  onPreviewModeChange,
  iterations,
  activeIteration,
  onIterationChange,
  onFork,
  onPick,
  onDiscard,
  isViewingIteration = false,
}: FloatingPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [corner, setCorner] = useState<Corner>("bottom-right");
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [forkLoading, setForkLoading] = useState(false);
  const [pickLoading, setPickLoading] = useState(false);
  const [discardLoading, setDiscardLoading] = useState(false);

  const iterationNames = iterations
    ? Object.keys(iterations).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : [];
  const hasIterations = iterationNames.length > 0;
  const isCreating = hasIterations && iterationNames.some(
    (n) => {
      const s = iterations![n]?.status;
      return s === "creating" || s === "installing" || s === "starting";
    }
  );
  const totalPending = batchCount + moveCount;
  const isLeftSide = corner === "top-left" || corner === "bottom-left";
  const isTopSide = corner === "top-left" || corner === "top-right";

  // Clear local fork loading state once real iterations appear
  useEffect(() => {
    if (hasIterations) setForkLoading(false);
  }, [hasIterations]);

  // Clear pick/discard loading when iterations are removed
  useEffect(() => {
    if (!hasIterations) {
      setPickLoading(false);
      setDiscardLoading(false);
    }
  }, [hasIterations]);

  // Suspense overlay
  const suspenseActive = forkLoading || isCreating || pickLoading || discardLoading;
  const suspenseMessage = pickLoading
    ? "Merging preferred changes\u2026"
    : discardLoading
      ? "Removing iteration branches\u2026"
      : "Creating iteration branches\u2026";

  // Hotkey: Alt+Shift+I to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.key === "I") {
        e.preventDefault();
        onVisibilityChange(!visible);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, onVisibilityChange]);

  // Drag start — only from the panel background, not buttons
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      const panel = panelRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      setIsDragging(true);
      setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      setDragPos({ x: rect.left, y: rect.top });
      e.preventDefault();
    },
    []
  );

  // Drag move + drop to nearest corner
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setDragPos({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y,
      });
    };

    const handleMouseUp = (e: MouseEvent) => {
      setIsDragging(false);
      const x = e.clientX;
      const y = e.clientY;
      const midX = window.innerWidth / 2;
      const midY = window.innerHeight / 2;
      const newCorner: Corner =
        x < midX
          ? y < midY
            ? "top-left"
            : "bottom-left"
          : y < midY
            ? "top-right"
            : "bottom-right";
      setCorner(newCorner);
      setDragPos(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  const positionStyle = dragPos
    ? { left: dragPos.x, top: dragPos.y }
    : getCornerPosition(corner);

  const positionTransition = isDragging
    ? "none"
    : "left 0.3s ease, top 0.3s ease, right 0.3s ease, bottom 0.3s ease";

  return (
    <>
      {/* Suspense overlay — covers page while creating/merging worktrees */}
      <SuspenseOverlay active={suspenseActive} message={suspenseMessage} />

      <div
        ref={panelRef}
        onMouseDown={handleMouseDown}
        style={{
          position: "fixed",
          ...positionStyle,
          zIndex: 10001,
          pointerEvents: "auto",
          background: "#fff",
          border: "1px solid #e0e0e0",
          borderRadius: 12,
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          display: "flex",
          flexDirection: isTopSide ? "column-reverse" : "column",
          gap: 0,
          cursor: isDragging ? "grabbing" : "grab",
          userSelect: "none",
          overflow: "hidden",
          transition: `${positionTransition}`,
        }}
      >
        {/* Iteration tab layer — recessed lower layer behind the main toolbar */}
        {hasIterations && (
          <div
            style={{
              background: "#f7f7f7",
              maxHeight: visible ? 40 : 0,
              opacity: visible ? 1 : 0,
              overflow: "hidden",
              transition: `max-height 0.25s ease ${visible ? "0s" : "0.15s"}, opacity 0.2s ease ${visible ? "0s" : "0.1s"}`,
            }}
          >
            <div
              style={{
                padding: "4px 4px 6px 4px",
              }}
            >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                overflowX: "auto",
              }}
            >
              {/* Original tab — switch back to the base page */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onIterationChange?.(ORIGINAL_TAB);
                }}
                title="View original page"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 8px",
                  borderRadius: 6,
                  border: "1px solid transparent",
                  background: activeIteration === ORIGINAL_TAB ? "#e8e8e8" : "transparent",
                  color: activeIteration === ORIGINAL_TAB ? "#141414" : "#666",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: activeIteration === ORIGINAL_TAB ? 600 : 400,
                  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  transition: "all 0.15s ease",
                }}
              >
                Original
              </button>
              {iterationNames.map((name) => {
                const info = iterations![name];
                const isActive = name === activeIteration;
                return (
                  <button
                    key={name}
                    onClick={(e) => {
                      e.stopPropagation();
                      onIterationChange?.(name);
                    }}
                    title={info?.commandPrompt || name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "3px 8px",
                      borderRadius: 6,
                      border: "1px solid transparent",
                      background: isActive ? "#e8e8e8" : "transparent",
                      color: isActive ? "#141414" : "#666",
                      cursor: "pointer",
                      fontSize: 11,
                      fontWeight: isActive ? 600 : 400,
                      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                      transition: "all 0.15s ease",
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: STATUS_COLORS[info?.status ?? "stopped"],
                        flexShrink: 0,
                      }}
                    />
                    {name}
                  </button>
                );
              })}
            </div>
            </div>
          </div>
        )}

        {/* Main toolbar row — upper layer with top radii and upward shadow */}
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: isLeftSide ? "row-reverse" : "row",
            alignItems: "center",
            background: "#fff",
            borderRadius: isTopSide ? "0 0 12px 12px" : "12px 12px 0 0",
            boxShadow: isTopSide ? "0 3px 8px rgba(0,0,0,0.06)" : "0 -3px 8px rgba(0,0,0,0.06)",
            padding: 4,
          }}
        >
          {/* === Section 1: Annotation tools === */}
          <ToolGroup reversed={isLeftSide} visible={visible}>
            <IconButton
              icon={<CursorIcon size={ICON_SIZE} />}
              label="Select"
              active={mode === "select"}
              onClick={() => onModeChange(mode === "select" ? "browse" : "select")}
            />
            <IconButton
              icon={<MarkerIcon size={ICON_SIZE} />}
              label="Draw"
              active={mode === "draw"}
              onClick={() => onModeChange(mode === "draw" ? "browse" : "draw")}
            />
            <IconButton
              icon={<MoveIcon size={ICON_SIZE} />}
              label="Move"
              active={mode === "move"}
              onClick={() => onModeChange(mode === "move" ? "browse" : "move")}
            />
          </ToolGroup>

          {/* === Section 2: Revision tools === */}
          <ToolGroup reversed={isLeftSide} visible={visible && (moveCount > 0 || totalPending > 0)}>
            <Divider />
            {moveCount > 0 && (
              <IconButton
                icon={<PreviewIcon size={ICON_SIZE} />}
                label={previewMode ? "Showing preview \u2014 click to show original" : "Showing original \u2014 click to show preview"}
                active={previewMode}
                onClick={() => onPreviewModeChange?.(!previewMode)}
              />
            )}
            {moveCount > 0 && (
              <IconButton
                icon={<UndoIcon size={ICON_SIZE} />}
                label="Undo last move"
                onClick={() => onUndoMove?.()}
              />
            )}
            <IconButton
              icon={<TrashIcon size={ICON_SIZE} />}
              label="Clear all changes"
              onClick={() => onClearBatch?.()}
            />
            {moveCount > 0 && <MoveBadge count={moveCount} />}
          </ToolGroup>

          {/* === Section 3: Agent context tools === */}
          <ToolGroup reversed={isLeftSide} visible={visible && totalPending > 0}>
            <Divider />
            <IconButton
              icon={<SendIcon size={ICON_SIZE} />}
              label={`Submit ${totalPending} change${totalPending !== 1 ? "s" : ""} (${batchCount} annotation${batchCount !== 1 ? "s" : ""}, ${moveCount} move${moveCount !== 1 ? "s" : ""})`}
              onClick={() => onSubmitBatch?.()}
            />
            <IconButton
              icon={<CopyIcon size={ICON_SIZE} />}
              label="Copy changes to clipboard"
              onClick={() => onCopyBatch?.()}
            />
          </ToolGroup>

          {/* === Section 4: Branching tools === */}

          {/* Fork / Iterate button — shown when no iterations exist and not loading */}
          <ToolGroup reversed={isLeftSide} visible={visible && !hasIterations && !forkLoading && !isCreating}>
            <Divider />
            <IconButton
              icon={<ForkIcon size={ICON_SIZE} />}
              label="Create iterations"
              onClick={() => {
                setForkLoading(true);
                onFork?.();
              }}
            />
          </ToolGroup>

          {/* Fork/Create spinner — shown while creating iterations */}
          <ToolGroup reversed={isLeftSide} visible={visible && (forkLoading || isCreating)}>
            <Divider />
            <IconButton
              icon={<SpinnerIcon size={ICON_SIZE} />}
              label="Creating iterations\u2026"
              onClick={() => {}}
            />
          </ToolGroup>

          {/* Pick/Merge button — merge the active iteration */}
          <ToolGroup reversed={isLeftSide} visible={visible && hasIterations && isViewingIteration && !pickLoading && !isCreating}>
            <Divider />
            <IconButton
              icon={<PickIcon size={ICON_SIZE} />}
              label={`Merge "${activeIteration}"`}
              onClick={async () => {
                if (!activeIteration || activeIteration === ORIGINAL_TAB) return;
                setPickLoading(true);
                try {
                  await onPick?.(activeIteration);
                } finally {
                  setPickLoading(false);
                }
              }}
            />
          </ToolGroup>

          {/* Pick/Merge spinner — shown while merging */}
          <ToolGroup reversed={isLeftSide} visible={visible && pickLoading}>
            <Divider />
            <IconButton
              icon={<SpinnerIcon size={ICON_SIZE} />}
              label="Merging\u2026"
              onClick={() => {}}
            />
          </ToolGroup>

          {/* Discard button — discard all iterations, keep original */}
          <ToolGroup reversed={isLeftSide} visible={visible && hasIterations && !isViewingIteration && !discardLoading && !isCreating}>
            <Divider />
            <IconButton
              icon={<DiscardIcon size={ICON_SIZE} />}
              label="Discard all iterations"
              onClick={async () => {
                setDiscardLoading(true);
                try {
                  await onDiscard?.();
                } finally {
                  setDiscardLoading(false);
                }
              }}
            />
          </ToolGroup>

          {/* Discard spinner — shown while discarding */}
          <ToolGroup reversed={isLeftSide} visible={visible && discardLoading}>
            <Divider />
            <IconButton
              icon={<SpinnerIcon size={ICON_SIZE} />}
              label="Removing iterations\u2026"
              onClick={() => {}}
            />
          </ToolGroup>

          {/* === Divider before close/open button === */}
          <ToolGroup reversed={isLeftSide} visible={visible}>
            <Divider />
          </ToolGroup>

          {/* === Section 5: Close/Open toggle — always visible, rightmost === */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onVisibilityChange(!visible);
            }}
            title={undefined}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 4,
              borderRadius: 8,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              width: ICON_SIZE + 8,
              height: ICON_SIZE + 8,
              flexShrink: 0,
            }}
          >
            {/* Logo icon — fades out when open */}
            <div
              style={{
                position: "absolute",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: visible ? 0 : 1,
                transform: visible ? "scale(0.6)" : "scale(1)",
                filter: visible ? "blur(4px)" : "blur(0px)",
                transition: `opacity 0.25s ${SPRING}, transform 0.3s ${SPRING}, filter 0.25s ease`,
                color: "#666",
              }}
            >
              <LogoIcon size={ICON_SIZE} />
            </div>
            {/* Close icon — fades in when open */}
            <div
              style={{
                position: "absolute",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: visible ? 1 : 0,
                transform: visible ? "scale(1)" : "scale(0.6)",
                filter: visible ? "blur(0px)" : "blur(4px)",
                transition: `opacity 0.25s ${SPRING}, transform 0.3s ${SPRING}, filter 0.25s ease`,
                color: "#999",
              }}
            >
              <CloseIcon size={ICON_SIZE} />
            </div>
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * Full-screen suspense overlay shown while worktrees are being created or merged.
 * Sits beneath the toolbar's z-index but covers the page content.
 * Uses purely CSS animations for performance.
 */
function SuspenseOverlay({ active, message }: { active: boolean; message: string }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(255, 255, 255, 0.96)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        opacity: active ? 1 : 0,
        pointerEvents: active ? "auto" : "none",
        transition: "opacity 0.3s ease",
      }}
    >
      <style>{`
        @keyframes iterate-suspense-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes iterate-suspense-text {
          0% {
            background-position: 200% center;
            transform: scale(1);
          }
          50% {
            transform: scale(1.02);
          }
          100% {
            background-position: -200% center;
            transform: scale(1);
          }
        }
      `}</style>
      {/* Chunky loading spinner — 40px diameter, 4px stroke */}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          border: "4px solid #e0e0e0",
          borderTopColor: "#666",
          boxSizing: "border-box",
          animation: active ? `iterate-suspense-spin ${SUSPENSE_DURATION} linear infinite` : "none",
        }}
      />
      {/* Status text with gradient pulse wave synced to spinner rotation */}
      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          background: "linear-gradient(90deg, #888 0%, #888 35%, #333 50%, #888 65%, #888 100%)",
          backgroundSize: "200% 100%",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          WebkitTextFillColor: "transparent",
          color: "transparent",
          animation: active ? `iterate-suspense-text ${SUSPENSE_DURATION} ease-in-out infinite` : "none",
        }}
      >
        {message}
      </div>
    </div>
  );
}

/**
 * Animated wrapper that scales/fades its children in and out.
 * Uses max-width to animate the container width with a spring curve.
 */
function ToolGroup({
  visible,
  reversed,
  children,
}: {
  visible: boolean;
  reversed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        overflow: "hidden",
        maxWidth: visible ? 500 : 0,
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1)" : "scale(0.85)",
        transformOrigin: reversed ? "right center" : "left center",
        transition: `max-width 0.35s ${SPRING}, opacity 0.2s ease, transform 0.3s ${SPRING}`,
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      {children}
    </div>
  );
}

function Divider() {
  return (
    <div
      style={{
        width: 1,
        height: 20,
        background: "#e0e0e0",
        margin: "0 2px",
        flexShrink: 0,
      }}
    />
  );
}

function IconButton({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => { if (!disabled) setPressed(true); }}
      onMouseUp={() => setPressed(false)}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 4,
        borderRadius: 8,
        border: "none",
        background: active ? "#e8e8e8" : "transparent",
        color: (active || hovered) ? "#141414" : "#666",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
        transform: pressed ? "scale(0.97)" : "scale(1)",
        transition: "background 0.1s, color 0.1s, opacity 0.15s, transform 0.1s ease",
        flexShrink: 0,
      }}
    >
      {icon}
      {hovered && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#fff",
            color: "#333",
            border: "1px solid #e0e0e0",
            borderRadius: 6,
            padding: "4px 8px",
            fontSize: 11,
            fontWeight: 500,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            zIndex: 10003,
          }}
        >
          {label}
        </div>
      )}
    </button>
  );
}

/** Small badge showing the number of pending moves */
function MoveBadge({ count }: { count: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        background: "#7c3aed",
        color: "#fff",
        fontSize: 10,
        fontWeight: 700,
        padding: "0 4px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        flexShrink: 0,
      }}
    >
      {count}
    </div>
  );
}

function getCornerPosition(corner: Corner): React.CSSProperties {
  switch (corner) {
    case "top-left":
      return { left: PANEL_MARGIN, top: PANEL_MARGIN };
    case "top-right":
      return { right: PANEL_MARGIN, top: PANEL_MARGIN };
    case "bottom-left":
      return { left: PANEL_MARGIN, bottom: PANEL_MARGIN };
    case "bottom-right":
      return { right: PANEL_MARGIN, bottom: PANEL_MARGIN };
  }
}
