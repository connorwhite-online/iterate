import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ToolMode } from "../IterateOverlay.js";
import type { IterationInfo, IterationStatus } from "iterate-ui-core";
import {
  CursorIcon,
  MoveIcon,
  MarkerIcon,
  CloseIcon,
  LogoIcon,
  TrashIcon,
  CopyIcon,
  CheckIcon,
  UndoIcon,
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
  /** Called when user clicks Trash (clear all annotations and moves) */
  onClearBatch?: () => void;
  /** Called when user clicks Copy (copy annotations to clipboard) */
  onCopyBatch?: () => void;
  /** Called when user clicks Undo (revert last move) */
  onUndoMove?: () => void;
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
  /** Badge counts per tab (tab name → total pending changes) */
  tabBadgeCounts?: Record<string, number>;
}

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const PANEL_MARGIN = 16;
const ICON_SIZE = 24;

// Spring-like cubic bezier
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/** Whether tooltips should appear below (true) or above (false) the buttons */
const TooltipDirectionContext = React.createContext<boolean>(false);

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
 * All collapsible tools live in a single ToolGroup for consistent flex spacing.
 * Sections (separated by dividers):
 * 1. Annotation tools (select, draw, move)
 * 2. Change tools (undo, trash, copy, send) — no internal divider
 * 3. Branching tools (fork/iterate, merge/pick, discard)
 * 4. Close/open toggle (always visible)
 */
export function FloatingPanel({
  mode,
  onModeChange,
  visible,
  onVisibilityChange,
  batchCount = 0,
  moveCount = 0,
  onClearBatch,
  onCopyBatch,
  onUndoMove,
  iterations,
  activeIteration,
  onIterationChange,
  onFork,
  onPick,
  onDiscard,
  isViewingIteration = false,
  tabBadgeCounts = {},
}: FloatingPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [corner, setCorner] = useState<Corner>("bottom-right");
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [forkLoading, setForkLoading] = useState(false);
  const [pickLoading, setPickLoading] = useState(false);
  const [discardLoading, setDiscardLoading] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const iterationNames = iterations
    ? Object.keys(iterations).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : [];
  const hasIterations = iterationNames.length > 0;
  const allStatuses = hasIterations
    ? iterationNames.map((n) => iterations![n]?.status)
    : [];
  const isCreating = allStatuses.some((s) => s === "creating" || s === "installing" || s === "starting");
  // High-water-mark: only move forward through phases, never backwards
  const phaseOrder = ["creating", "installing", "starting"] as const;
  const currentMaxPhase = allStatuses.includes("starting") ? 2
    : allStatuses.includes("installing") ? 1
    : allStatuses.includes("ready") ? 2 // if any are ready, at least "starting" was reached
    : 0;
  const highPhaseRef = useRef(-1);
  if (!isCreating && !forkLoading) { highPhaseRef.current = -1; } // reset when done
  else if (currentMaxPhase > highPhaseRef.current) { highPhaseRef.current = currentMaxPhase; }
  const creatingPhase = highPhaseRef.current >= 0 ? phaseOrder[highPhaseRef.current] : null;
  const totalPending = batchCount + moveCount;
  const isLeftSide = corner === "top-left" || corner === "bottom-left";
  const isTopSide = corner === "top-left" || corner === "top-right";

  // Whether any branching tool is showing (to render divider)
  const branchingVisible =
    (!hasIterations && !forkLoading && !isCreating) ||
    (forkLoading || isCreating) ||
    (hasIterations && isViewingIteration && !pickLoading && !isCreating) ||
    pickLoading ||
    (hasIterations && !isViewingIteration && !discardLoading && !isCreating) ||
    discardLoading;

  // Clean up success timers on unmount
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

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

  // Track whether the page has rendered meaningful content (not just the overlay)
  const [contentReady, setContentReady] = useState(false);
  const wasCreatingRef = useRef(false);
  useEffect(() => {
    if (isCreating || forkLoading) {
      wasCreatingRef.current = true;
      setContentReady(false);
      return;
    }
    if (!wasCreatingRef.current || !hasIterations) return;
    // Poll for actual visible content in the page (beyond just the overlay root)
    let rafId: number;
    const check = () => {
      const children = Array.from(document.body.children);
      const hasContent = children.some(
        (el) => el.id !== "__iterate-overlay-root__" && (el as HTMLElement).offsetHeight > 0 && el.children.length > 0
      );
      if (hasContent) { setContentReady(true); wasCreatingRef.current = false; }
      else { rafId = requestAnimationFrame(check); }
    };
    rafId = requestAnimationFrame(check);
    return () => cancelAnimationFrame(rafId);
  }, [isCreating, forkLoading, hasIterations]);

  // Suspense overlay — also show while page content hasn't rendered after iterations are ready
  const pageStillLoading = wasCreatingRef.current && hasIterations && !contentReady && !pickLoading && !discardLoading;
  const suspenseActive = forkLoading || isCreating || pickLoading || discardLoading || pageStillLoading;
  const suspenseMessage = pickLoading
    ? "Merging preferred changes\u2026"
    : discardLoading
      ? "Removing iteration worktrees\u2026"
      : pageStillLoading && !isCreating && !forkLoading
        ? "Loading page\u2026"
        : creatingPhase === "installing"
          ? "Installing dependencies\u2026"
          : creatingPhase === "starting"
            ? "Starting dev server\u2026"
            : "Creating iteration branches\u2026";

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd+I / Ctrl+I — always toggle toolbar visibility
      if ((e.metaKey || e.ctrlKey) && e.key === "i") {
        e.preventDefault();
        onVisibilityChange(!visible);
        return;
      }

      // All other shortcuts require toolbar to be open and no focused input
      if (!visible) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onVisibilityChange(false);
          break;
        case "s":
          e.preventDefault();
          (document.activeElement as HTMLElement)?.blur?.();
          onModeChange(mode === "select" ? "browse" : "select");
          break;
        case "d":
          e.preventDefault();
          (document.activeElement as HTMLElement)?.blur?.();
          onModeChange(mode === "draw" ? "browse" : "draw");
          break;
        case "m":
          e.preventDefault();
          (document.activeElement as HTMLElement)?.blur?.();
          onModeChange(mode === "move" ? "browse" : "move");
          break;
        case "u":
          e.preventDefault();
          onUndoMove?.();
          break;
        case "x":
          e.preventDefault();
          onClearBatch?.();
          break;
        case "c":
          e.preventDefault();
          onCopyBatch?.();
          setCopySuccess(true);
          if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
          copyTimerRef.current = setTimeout(() => setCopySuccess(false), 3000);
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, onVisibilityChange, mode, onModeChange, onUndoMove, onClearBatch, onCopyBatch]);

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
    <TooltipDirectionContext.Provider value={isTopSide}>
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
          background: "#f7f7f7",
          border: "none",
          borderRadius: 12,
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          display: "flex",
          flexDirection: isTopSide ? "column-reverse" : "column",
          gap: 0,
          cursor: isDragging ? "grabbing" : "grab",
          userSelect: "none",
          overflow: "visible",
          padding: 4,
          transition: `${positionTransition}`,
        }}
      >
        {/* Annotation count badge — always visible, overflows container */}
        {totalPending > 0 && (
          <PanelBadge count={totalPending} isLeftSide={isLeftSide} />
        )}
        {/* Iteration tab layer — recessed lower layer behind the main toolbar */}
        {hasIterations && (
          <div
            style={{
              background: "#f7f7f7",
              maxHeight: visible ? 48 : 0,
              maxWidth: visible ? 999 : 0,
              opacity: visible ? 1 : 0,
              overflow: "hidden",
              // 2px gap between tabs and toolbar — collapses with tabs.
              // In column (bottom-side), tabs are below toolbar → marginTop.
              // In column-reverse (top-side), tabs are above toolbar → marginBottom.
              ...(isTopSide
                ? { marginBottom: visible ? 2 : 0 }
                : { marginTop: visible ? 2 : 0 }),
              // Opening: tabs slide in AFTER tools (0.2s delay)
              // Closing: tabs collapse FIRST and fast (0s delay, 0.12s duration)
              transition: visible
                ? `max-height 0.2s ease 0.2s, max-width 0.2s ease 0.2s, opacity 0.15s ease 0.2s, margin 0.2s ease 0.2s`
                : `max-height 0.12s ease 0s, max-width 0.12s ease 0s, opacity 0.1s ease 0s, margin 0.12s ease 0s`,
            }}
          >
            <div
              style={{
                padding: "4px 4px 4px 4px",
              }}
            >
            <div
              ref={(el) => {
                // Hide WebKit scrollbar via direct style injection
                if (el && !el.dataset.scrollbarHidden) {
                  const style = document.createElement("style");
                  style.textContent = `[data-iterate-tabs]::-webkit-scrollbar { display: none; }`;
                  el.appendChild(style);
                  el.dataset.scrollbarHidden = "1";
                }
              }}
              data-iterate-tabs=""
              style={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                overflowX: "auto",
                scrollbarWidth: "none",
              } as React.CSSProperties}
            >
              {/* Original tab — switch back to the base page */}
              <TabButton
                active={activeIteration === ORIGINAL_TAB}
                hasChanges={(tabBadgeCounts[ORIGINAL_TAB] ?? 0) > 0}
                title="View original page"
                onClick={() => onIterationChange?.(ORIGINAL_TAB)}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: STATUS_COLORS.ready,
                    flexShrink: 0,
                  }}
                />
                Original
              </TabButton>
              {iterationNames.map((name) => {
                const info = iterations![name];
                const isActive = name === activeIteration;
                const badgeCount = tabBadgeCounts[name] ?? 0;
                return (
                  <TabButton
                    key={name}
                    active={isActive}
                    hasChanges={badgeCount > 0}
                    title={info?.commandPrompt || name}
                    onClick={() => onIterationChange?.(name)}
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
                  </TabButton>
                );
              })}
            </div>
            </div>
          </div>
        )}

        {/* Main toolbar row — upper layer */}
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: isLeftSide ? "row-reverse" : "row",
            justifyContent: "flex-end",
            alignItems: "center",
            background: "#fff",
            border: "1px solid #e0e0e0",
            borderRadius: 10,
            padding: 4,
          }}
        >
          {/* === All collapsible tools in a single group === */}
          <ToolGroup reversed={isLeftSide} visible={visible}>
            {/* Annotation tools */}
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

            {/* Change tools — always visible, disabled when no pending changes */}
            <Divider />
            <IconButton
              icon={<UndoIcon size={ICON_SIZE} />}
              label="Undo last change"
              disabled={totalPending === 0}
              onClick={() => onUndoMove?.()}
            />
            <IconButton
              icon={<TrashIcon size={ICON_SIZE} />}
              label="Clear all changes"
              disabled={totalPending === 0}
              onClick={() => onClearBatch?.()}
            />
            <IconButton
              icon={
                <div style={{ position: "relative", width: ICON_SIZE, height: ICON_SIZE }}>
                  <div style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: copySuccess ? 0 : 1,
                    transform: copySuccess ? "scale(0.6)" : "scale(1)",
                    filter: copySuccess ? "blur(4px)" : "blur(0px)",
                    transition: `opacity 0.25s ${SPRING}, transform 0.3s ${SPRING}, filter 0.25s ease`,
                  }}>
                    <CopyIcon size={ICON_SIZE} />
                  </div>
                  <div style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: copySuccess ? 1 : 0,
                    transform: copySuccess ? "scale(1)" : "scale(0.6)",
                    filter: copySuccess ? "blur(0px)" : "blur(4px)",
                    transition: `opacity 0.25s ${SPRING}, transform 0.3s ${SPRING}, filter 0.25s ease`,
                  }}>
                    <CheckIcon size={ICON_SIZE} color="#22c55e" animate />
                  </div>
                </div>
              }
              label={copySuccess ? "Copied!" : "Copy changes to clipboard"}
              disabled={totalPending === 0}
              onClick={() => {
                onCopyBatch?.();
                setCopySuccess(true);
                if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
                copyTimerRef.current = setTimeout(() => setCopySuccess(false), 3000);
              }}
            />

            {/* Branching tools */}
            {branchingVisible && <Divider />}

            {/* Fork button */}
            {!hasIterations && !forkLoading && !isCreating && (
              <IconButton
                icon={<ForkIcon size={ICON_SIZE} />}
                label="Create iterations"
                onClick={() => {
                  setForkLoading(true);
                  onFork?.();
                }}
              />
            )}
            {/* Fork spinner */}
            {(forkLoading || isCreating) && (
              <IconButton
                icon={<SpinnerIcon size={ICON_SIZE} />}
                label="Creating iterations\u2026"
                onClick={() => {}}
              />
            )}
            {/* Pick/Merge button */}
            {hasIterations && isViewingIteration && !pickLoading && !isCreating && (
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
            )}
            {/* Pick spinner */}
            {pickLoading && (
              <IconButton
                icon={<SpinnerIcon size={ICON_SIZE} />}
                label="Merging\u2026"
                onClick={() => {}}
              />
            )}
            {/* Discard button */}
            {hasIterations && !isViewingIteration && !discardLoading && !isCreating && (
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
            )}
            {/* Discard spinner */}
            {discardLoading && (
              <IconButton
                icon={<SpinnerIcon size={ICON_SIZE} />}
                label="Removing iteration worktrees\u2026"
                onClick={() => {}}
              />
            )}

            <Divider />
          </ToolGroup>

          {/* === Close/Open toggle — always visible === */}
          <CloseToggleButton
            visible={visible}
            onVisibilityChange={onVisibilityChange}
          />
        </div>
      </div>
    </TooltipDirectionContext.Provider>
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
        @keyframes iterate-suspense-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        style={{
          animation: active ? `iterate-suspense-spin ${SUSPENSE_DURATION} linear infinite` : "none",
        }}
      >
        <circle cx="20" cy="20" r="17" fill="none" stroke="#e0e0e0" strokeWidth="4" />
        <circle cx="20" cy="20" r="17" fill="none" stroke="#666" strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${Math.PI * 34 * 0.25} ${Math.PI * 34 * 0.75}`}
        />
      </svg>
      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          color: "#555",
          animation: active ? "iterate-suspense-pulse 2s ease-in-out infinite" : "none",
        }}
      >
        {message}
      </div>
    </div>
  );
}

/** Per-item stagger delay in ms */
const STAGGER_MS = 20;
/** Total time for all stagger items to finish appearing — used as the
 *  max-width transition duration so the container tracks the content. */
const GROUP_COLLAPSE_MS = 250;

/**
 * Collapsible wrapper for a group of toolbar items.
 *
 * The outer container collapses width via max-width + overflow:hidden.
 * Each child individually fades/scales in with a subtle stagger delay
 * from the close-button side, creating a smooth directional reveal.
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
  const items = React.Children.toArray(children).filter(Boolean);
  const count = items.length;

  return (
    <div
      style={{
        display: "flex",
        // When reversed (close on left), flip the item order so the trailing
        // divider sits next to the close button and tools read outward.
        flexDirection: reversed ? "row-reverse" : "row",
        alignItems: "center",
        gap: 2,
        overflow: "hidden",
        // Extra vertical padding so badges (top: -4) aren't clipped by overflow.
        // Negative margin compensates so it doesn't affect toolbar row layout.
        paddingTop: 6,
        paddingBottom: 2,
        marginTop: -6,
        marginBottom: -2,
        maxWidth: visible ? 800 : 0,
        transition: visible
          ? `max-width ${GROUP_COLLAPSE_MS}ms ease-out`
          : `max-width 0.25s cubic-bezier(0.4, 0, 0.2, 1)`,
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      {items.map((child, i) => {
        // Stagger from close-button side outward.
        // Items near close appear first. With row-reverse when reversed,
        // high DOM indices are visually near close → stagger high index first.
        // Without reverse, high DOM indices are near close → same logic.
        const staggerIndex = count - 1 - i;
        const openDelay = staggerIndex * STAGGER_MS;
        // Closing: reverse direction, faster
        const closeDelay = (count - 1 - staggerIndex) * STAGGER_MS * 0.5;

        return (
          <div
            key={i}
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? "scale(1)" : "scale(0.85)",
              transition: visible
                ? `opacity 0.15s ease ${openDelay}ms, transform 0.2s ${SPRING} ${openDelay}ms`
                : `opacity 0.1s ease ${closeDelay}ms, transform 0.12s ease ${closeDelay}ms`,
              pointerEvents: visible ? "auto" : "none",
            }}
          >
            {child}
          </div>
        );
      })}
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

/** Close/Open toggle button with hover → primary color */
function CloseToggleButton({
  visible,
  onVisibilityChange,
}: {
  visible: boolean;
  onVisibilityChange: (v: boolean) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onVisibilityChange(!visible);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
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
        transform: pressed ? "scale(0.97)" : "scale(1)",
        transition: "transform 0.1s ease",
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
          transition: `opacity 0.25s ${SPRING}, transform 0.3s ${SPRING}, filter 0.25s ease, color 0.15s ease`,
          color: hovered ? "#141414" : "#666",
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
          transition: `opacity 0.25s ${SPRING}, transform 0.3s ${SPRING}, filter 0.25s ease, color 0.15s ease`,
          color: hovered ? "#141414" : "#999",
        }}
      >
        <CloseIcon size={ICON_SIZE} />
      </div>
    </button>
  );
}

/** Iteration tab button with hover/active color (no font-weight shift to avoid layout shifts).
 *  Shows a PortalTooltip with the full title when text is truncated. */
function TabButton({
  active,
  hasChanges,
  title,
  onClick,
  children,
}: {
  active: boolean;
  /** When true, shows a light blue outline to indicate pending changes */
  hasChanges?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipBelow = React.useContext(TooltipDirectionContext);

  return (
    <button
      ref={buttonRef}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseEnter={() => {
        setHovered(true);
        if (buttonRef.current) {
          setAnchorRect(buttonRef.current.getBoundingClientRect());
          // Check if content is truncated (scrollWidth > clientWidth)
          setIsTruncated(buttonRef.current.scrollWidth > buttonRef.current.clientWidth);
        }
      }}
      onMouseLeave={() => setHovered(false)}
      title={isTruncated ? undefined : title}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 4,
        maxWidth: 80,
        padding: "3px 8px",
        borderRadius: 6,
        border: hasChanges ? "1px solid rgba(37, 99, 235, 0.4)" : "1px solid transparent",
        background: active ? "#e8e8e8" : "transparent",
        color: active || hovered ? "#141414" : "#666",
        cursor: "pointer",
        fontSize: 11,
        fontWeight: 500,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        flexShrink: 0,
        transition: "all 0.15s ease",
      }}
    >
      {children}
      {hovered && isTruncated && anchorRect && createPortal(
        <PortalTooltip label={title} anchorRect={anchorRect} below={tooltipBelow} />,
        document.body,
      )}
    </button>
  );
}

function IconButton({
  icon,
  label,
  active,
  disabled,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  /** When set and > 0, renders an animated amber badge at top-right */
  badge?: number;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipBelow = React.useContext(TooltipDirectionContext);

  return (
    <button
      ref={buttonRef}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      onMouseEnter={() => {
        setHovered(true);
        if (buttonRef.current) {
          setAnchorRect(buttonRef.current.getBoundingClientRect());
        }
      }}
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
        outline: "none",
        background: active ? "#e0e0e0" : hovered ? "#f0f0f0" : "transparent",
        color: (active || hovered) ? "#141414" : "#666",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
        transform: pressed ? "scale(0.97)" : "scale(1)",
        transition: "background 0.1s, color 0.1s, opacity 0.15s, transform 0.1s ease",
        flexShrink: 0,
      }}
    >
      {icon}
      {badge != null && badge > 0 && (
        <AnimatedButtonBadge count={badge} />
      )}
      {hovered && anchorRect && createPortal(
        <PortalTooltip label={label} anchorRect={anchorRect} below={tooltipBelow} />,
        document.body,
      )}
    </button>
  );
}

/** Tooltip rendered via createPortal to escape overflow:hidden containers.
 *  Includes a small arrow pointing towards the anchor button. */
function PortalTooltip({
  label,
  anchorRect,
  below,
}: {
  label: string;
  anchorRect: DOMRect;
  below: boolean;
}) {
  const centerX = anchorRect.left + anchorRect.width / 2;
  const anchorY = below ? anchorRect.bottom + 8 : anchorRect.top - 8;

  return (
    <div
      style={{
        position: "fixed",
        left: centerX,
        top: anchorY,
        transform: below
          ? "translateX(-50%)"
          : "translateX(-50%) translateY(-100%)",
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
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        zIndex: 10003,
      }}
    >
      {/* Arrow */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          width: 8,
          height: 8,
          background: "#fff",
          ...(below
            ? {
                top: -4,
                transform: "translateX(-50%) rotate(45deg)",
                boxShadow: "-1px -1px 0 0 #e0e0e0",
              }
            : {
                bottom: -4,
                transform: "translateX(-50%) rotate(45deg)",
                boxShadow: "1px 1px 0 0 #e0e0e0",
              }),
        }}
      />
      {label}
    </div>
  );
}

/** Small amber badge rendered inline within a tab button.
 *  Perfectly circular for single digits; pill-shaped for double digits.
 *  Animates in with a spring scale-up on mount and when count changes.
 *  Uses inline flow (not absolute positioning) so it is never clipped
 *  by parent overflow containers. */
function TabBadge({ count }: { count: number }) {
  const isDouble = count >= 10;
  const [appeared, setAppeared] = useState(false);
  const prevCountRef = useRef(count);

  useEffect(() => {
    // Re-trigger animation on mount or count change
    setAppeared(false);
    let frame2 = 0;
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        setAppeared(true);
      });
    });
    prevCountRef.current = count;
    return () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
    };
  }, [count]);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        ...(isDouble
          ? { minWidth: 16, height: 16, borderRadius: 8, padding: "0 4px" }
          : { width: 16, height: 16, borderRadius: "50%" }),
        background: "#2563eb",
        color: "#fff",
        fontSize: 9,
        fontWeight: 700,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        lineHeight: 1,
        pointerEvents: "none",
        transform: appeared ? "scale(1)" : "scale(0)",
        transition: `transform 0.3s ${SPRING}`,
      }}
    >
      {count}
    </span>
  );
}

/** Annotation count badge positioned at the corner of the panel container.
 *  Overflows the panel bounds. Always visible (open or closed). */
function PanelBadge({ count, isLeftSide }: { count: number; isLeftSide: boolean }) {
  const isDouble = count >= 10;
  const [appeared, setAppeared] = useState(false);

  useEffect(() => {
    setAppeared(false);
    let frame2 = 0;
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        setAppeared(true);
      });
    });
    return () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
    };
  }, [count]);

  return (
    <span
      style={{
        position: "absolute",
        top: -6,
        ...(isLeftSide ? { left: -6 } : { right: -6 }),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...(isDouble
          ? { minWidth: 18, height: 18, borderRadius: 9, padding: "0 4px" }
          : { width: 18, height: 18, borderRadius: "50%" }),
        background: "#2563eb",
        color: "#fff",
        fontSize: 10,
        fontWeight: 700,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        lineHeight: 1,
        pointerEvents: "none",
        zIndex: 1,
        boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
        transform: appeared ? "scale(1)" : "scale(0)",
        transition: `transform 0.3s ${SPRING}`,
      }}
    >
      {count}
    </span>
  );
}

/** Animated amber badge for IconButton — appears at top-left with spring scale-up.
 *  Re-triggers animation when count changes. */
function AnimatedButtonBadge({ count }: { count: number }) {
  const isDouble = count >= 10;
  const [appeared, setAppeared] = useState(false);

  useEffect(() => {
    setAppeared(false);
    let frame2 = 0;
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        setAppeared(true);
      });
    });
    return () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
    };
  }, [count]);

  return (
    <span
      style={{
        position: "absolute",
        top: -4,
        left: -4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...(isDouble
          ? { minWidth: 16, height: 16, borderRadius: 8, padding: "0 4px" }
          : { width: 16, height: 16, borderRadius: "50%" }),
        background: "#2563eb",
        color: "#fff",
        fontSize: 9,
        fontWeight: 700,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        lineHeight: 1,
        pointerEvents: "none",
        transform: appeared ? "scale(1)" : "scale(0)",
        transition: `transform 0.3s ${SPRING}`,
      }}
    >
      {count}
    </span>
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
