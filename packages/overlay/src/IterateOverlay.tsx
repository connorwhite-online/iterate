import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AnnotationData,
  AnnotationIntent,
  AnnotationSeverity,
  SelectedElement,
  TextSelection,
  DrawingData,
  Rect,
  DomChange,
} from "iterate-ui-core";
import { formatBatchPrompt } from "iterate-ui-core";
import { ElementPicker, type PickedElement } from "./inspector/ElementPicker.js";
import { MarqueeSelect } from "./inspector/MarqueeSelect.js";
import { TextSelect } from "./inspector/TextSelect.js";
import { MarkerDraw } from "./inspector/MarkerDraw.js";
import { SelectionPanel } from "./annotate/SelectionPanel.js";
import { DragHandler, type PendingMove } from "./manipulate/DragHandler.js";
import { DaemonConnection } from "./transport/connection.js";
import { savePendingState, loadPendingState, clearPendingState } from "./storage/persistence.js";

export type ToolMode = "select" | "move" | "draw" | "browse";

export interface IterateOverlayProps {
  /** Which tool mode is active */
  mode: ToolMode;
  /** Name of the current iteration being viewed */
  iteration: string;
  /** WebSocket URL for daemon connection (auto-detected if omitted) */
  wsUrl?: string;
  /** Reference to the iteration iframe */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** Current pending batch count (passed up for toolbar badge) */
  onBatchCountChange?: (count: number) => void;
  /** Current pending move count (passed up for toolbar badge) */
  onMoveCountChange?: (count: number) => void;
  /** Whether live preview is enabled */
  previewMode?: boolean;
  /** Callback to submit the pending batch */
  onSubmitBatch?: () => void;
}

/** Annotation waiting to be submitted (local-only until batch submit) */
export interface PendingAnnotation {
  iteration: string;
  /** Page URL where this annotation was created */
  url?: string;
  elements: SelectedElement[];
  textSelection?: TextSelection;
  drawing?: DrawingData;
  comment: string;
  intent?: AnnotationIntent;
  severity?: AnnotationSeverity;
  /** Where the user clicked to create this annotation (viewport coords, for popup placement) */
  clickPosition?: { x: number; y: number };
  /** Page-absolute coordinates for badge placement (scrolls naturally with the document) */
  pagePosition?: { x: number; y: number };
}

/** Get the current URL from the iteration iframe (same-origin with cross-origin fallback). */
function getIframeUrl(iframeRef: React.RefObject<HTMLIFrameElement | null>): string | undefined {
  try {
    return iframeRef.current?.contentWindow?.location.href;
  } catch {
    return iframeRef.current?.src || undefined;
  }
}

/** Get the current page URL — uses iframe URL if available, otherwise window location. */
function getCurrentPageUrl(iframeRef: React.RefObject<HTMLIFrameElement | null>): string {
  return getIframeUrl(iframeRef) ?? window.location.href;
}

/** Compare two URLs by pathname only (ignoring hash, query, origin differences). */
function urlsMatchPage(a: string, b: string): boolean {
  try {
    return new URL(a).pathname === new URL(b).pathname;
  } catch {
    return a === b;
  }
}

/** Get the current page scroll offset (works for window scroll and document element scroll). */
function getScrollOffset(): { x: number; y: number } {
  return {
    x: window.scrollX || document.documentElement.scrollLeft || document.body.scrollLeft || 0,
    y: window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0,
  };
}

/**
 * Main overlay component for iterate.
 * Renders element selection tools, annotation panel, and drag handler
 * on top of an iteration's iframe.
 */
export function IterateOverlay({
  mode,
  iteration,
  wsUrl,
  iframeRef,
  onBatchCountChange,
  onMoveCountChange,
  previewMode = true,
}: IterateOverlayProps) {
  const connectionRef = useRef<DaemonConnection | null>(null);

  // Selection state
  const [selectedElements, setSelectedElements] = useState<PickedElement[]>([]);
  const [textSelection, setTextSelection] = useState<TextSelection | null>(null);
  const [activeDrawing, setActiveDrawing] = useState<DrawingData | null>(null);
  const [clickPosition, setClickPosition] = useState<{ x: number; y: number } | null>(null);

  // Restore pending state from localStorage (survives navigation and refresh)
  const savedState = useMemo(() => loadPendingState(iteration), [iteration]);

  // Pending batch (accumulated annotations not yet submitted)
  const [pendingBatch, setPendingBatch] = useState<PendingAnnotation[]>(savedState?.pendingBatch ?? []);

  // Pending moves (accumulated DOM moves not yet submitted)
  const [pendingMoves, setPendingMoves] = useState<PendingMove[]>(savedState?.pendingMoves ?? []);

  // Track whether marquee drag is in progress (suppresses ElementPicker hover)
  const [isMarqueeDragging, setIsMarqueeDragging] = useState(false);

  const overlayRef = useRef<HTMLDivElement>(null);

  // Lazily create (or find) a position:absolute markers layer on the document body.
  // Badges rendered here scroll naturally with the page — no JS scroll tracking needed.
  const markersLayerRef = useRef<HTMLDivElement | null>(null);
  if (!markersLayerRef.current && typeof document !== "undefined") {
    let el = document.getElementById("__iterate-markers-layer__") as HTMLDivElement | null;
    if (!el) {
      el = document.createElement("div");
      el.id = "__iterate-markers-layer__";
      el.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:9998;";
      document.body.appendChild(el);
    }
    markersLayerRef.current = el;
  }

  // Track the current page URL so we can hide annotations that belong to other pages.
  // In SPAs (Next.js), the overlay persists across client-side navigations, so we
  // need to detect URL changes and only show annotations matching the current page.
  const [currentUrl, setCurrentUrl] = useState(() => getCurrentPageUrl(iframeRef));

  useEffect(() => {
    // Detect URL changes from client-side navigation (pushState/replaceState/popstate)
    const update = () => setCurrentUrl(getCurrentPageUrl(iframeRef));
    update();

    // Patch pushState/replaceState to detect SPA navigations
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState = (...args) => { origPush(...args); update(); };
    history.replaceState = (...args) => { origReplace(...args); update(); };

    window.addEventListener("popstate", update);

    // Also poll to catch iframe navigations and any edge cases
    const intervalId = setInterval(update, 500);

    return () => {
      history.pushState = origPush;
      history.replaceState = origReplace;
      window.removeEventListener("popstate", update);
      clearInterval(intervalId);
    };
  }, [iframeRef]);

  // Move markers still need scroll-based delta tracking (they render in the fixed overlay).
  // Annotation badges no longer need this — they're in the absolute markers layer.
  useEffect(() => {
    if (pendingMoves.length === 0) return;

    const getDoc = (): Document => {
      try {
        return iframeRef.current?.contentDocument ?? document;
      } catch {
        return document;
      }
    };

    const applyMoveDeltas = () => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const doc = getDoc();
      const pageUrl = getCurrentPageUrl(iframeRef);

      for (let i = 0; i < pendingMoves.length; i++) {
        const move = pendingMoves[i]!;
        const nodes = overlay.querySelectorAll(`[data-move-idx="${i}"]`);
        if (nodes.length === 0) continue;

        const onDifferentPage = move.url && pageUrl && !urlsMatchPage(move.url, pageUrl);
        if (onDifferentPage) {
          for (let n = 0; n < nodes.length; n++) {
            (nodes[n] as HTMLElement).style.display = "none";
          }
          continue;
        }

        const stored = move.from;
        let dx = 0, dy = 0;
        let found = false;
        try {
          const el = doc.querySelector(move.selector);
          if (el) {
            const cur = el.getBoundingClientRect();
            dx = (cur.x + cur.width / 2) - (stored.x + stored.width / 2);
            dy = (cur.y + cur.height / 2) - (stored.y + stored.height / 2);
            found = true;
          }
        } catch { /* cross-origin or invalid selector */ }

        for (let n = 0; n < nodes.length; n++) {
          const node = nodes[n] as HTMLElement;
          node.style.translate = found ? `${dx}px ${dy}px` : "";
          if (node.style.display === "none") node.style.display = "";
        }
      }
    };

    applyMoveDeltas();
    const doc = getDoc();
    doc.addEventListener("scroll", applyMoveDeltas, { capture: true, passive: true });
    const win = doc.defaultView ?? window;
    win.addEventListener("scroll", applyMoveDeltas, { passive: true });
    win.addEventListener("resize", applyMoveDeltas, { passive: true });

    return () => {
      doc.removeEventListener("scroll", applyMoveDeltas, { capture: true });
      win.removeEventListener("scroll", applyMoveDeltas);
      win.removeEventListener("resize", applyMoveDeltas);
    };
  }, [pendingMoves, iframeRef, currentUrl]);

  // Unified undo stack — tracks whether each action was an annotation or move
  const undoStackRef = useRef<Array<"annotation" | "move">>(savedState?.undoStack ?? []);

  // Persist pending state to localStorage on every change
  useEffect(() => {
    savePendingState(iteration, pendingBatch, pendingMoves, undoStackRef.current);
  }, [iteration, pendingBatch, pendingMoves]);

  // Editing state — when editing an existing annotation badge
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [initialComment, setInitialComment] = useState<string | undefined>(undefined);

  // When the selection panel is open, disable pickers so clicks in the panel
  // don't re-contextualize the selection.
  // activeDrawing is included so the popup appears even when the drawn path
  // doesn't overlap any DOM elements (free-form drawing).
  const isAnnotating = selectedElements.length > 0 || textSelection !== null || activeDrawing !== null;

  // Connect to daemon
  useEffect(() => {
    const conn = new DaemonConnection(wsUrl);
    connectionRef.current = conn;
    conn.connect();
    return () => conn.disconnect();
  }, [wsUrl]);

  // Clear localStorage when the agent acknowledges annotations
  useEffect(() => {
    const conn = connectionRef.current;
    if (!conn) return;
    return conn.onMessage((msg) => {
      if (msg.type === "annotation:updated" && msg.payload.status === "acknowledged") {
        clearPendingState(iteration);
      }
    });
  }, [iteration, wsUrl]);

  // Notify parent of batch count changes
  useEffect(() => {
    onBatchCountChange?.(pendingBatch.length);
  }, [pendingBatch.length, onBatchCountChange]);

  // Notify parent of move count changes
  useEffect(() => {
    onMoveCountChange?.(pendingMoves.length);
  }, [pendingMoves.length, onMoveCountChange]);

  // Handle element selection from ElementPicker (click / ctrl+click)
  const handleElementSelect = useCallback(
    (elements: PickedElement[], clickPos?: { x: number; y: number }) => {
      setSelectedElements(elements);
      if (clickPos) setClickPosition(clickPos);
    },
    []
  );

  // Handle marquee selection (replaces the current selection)
  const handleMarqueeSelect = useCallback(
    (elements: PickedElement[]) => {
      setSelectedElements(elements);
      // Position popup at the center-right of the combined selection bounds
      if (elements.length > 0) {
        let maxRight = -Infinity, sumY = 0;
        for (const el of elements) {
          const r = el.rect;
          if (r.x + r.width > maxRight) maxRight = r.x + r.width;
          sumY += r.y + r.height / 2;
        }
        setClickPosition({ x: maxRight, y: sumY / elements.length });
      }
    },
    []
  );

  // Handle text selection
  const handleTextSelect = useCallback(
    (selection: TextSelection | null) => {
      setTextSelection(selection);
    },
    []
  );

  // Handle marker drawing completion
  const handleDrawComplete = useCallback(
    (elements: PickedElement[], drawing: DrawingData) => {
      setSelectedElements(elements);
      setActiveDrawing(drawing);
      // Position popup at the start of the drawing (where the cursor first depressed)
      const startMatch = drawing.path.match(/^M\s+([\d.]+)\s+([\d.]+)/);
      if (startMatch) {
        setClickPosition({
          x: parseFloat(startMatch[1]!),
          y: parseFloat(startMatch[2]!),
        });
      } else {
        setClickPosition({
          x: drawing.bounds.x + drawing.bounds.width,
          y: drawing.bounds.y + drawing.bounds.height / 2,
        });
      }
    },
    []
  );

  // Remove a single element from the selection
  const handleRemoveElement = useCallback(
    (index: number) => {
      setSelectedElements((prev) => {
        const updated = [...prev];
        updated.splice(index, 1);
        return updated;
      });
    },
    []
  );

  // Add current selection as an annotation to the pending batch (or update if editing)
  const handleAddToBatch = useCallback(
    (comment: string, intent?: AnnotationIntent, severity?: AnnotationSeverity) => {
      if (selectedElements.length === 0 && !textSelection && !activeDrawing) return;

      // Convert viewport click position to page-absolute coordinates for the
      // markers layer (position:absolute). Badges placed at page coords scroll
      // naturally with the document — no JS scroll tracking needed.
      const scroll = getScrollOffset();
      let pagePos: { x: number; y: number } | undefined;
      if (clickPosition) {
        pagePos = { x: clickPosition.x + scroll.x, y: clickPosition.y + scroll.y };
      } else if (selectedElements.length > 0) {
        const el = selectedElements[0]!;
        pagePos = {
          x: el.rect.x + el.rect.width / 2 + scroll.x,
          y: el.rect.y + el.rect.height / 2 + scroll.y,
        };
      } else if (activeDrawing) {
        pagePos = {
          x: activeDrawing.bounds.x + activeDrawing.bounds.width / 2 + scroll.x,
          y: activeDrawing.bounds.y + activeDrawing.bounds.height / 2 + scroll.y,
        };
      }

      const annotation: PendingAnnotation = {
        iteration,
        url: getCurrentPageUrl(iframeRef),
        elements: selectedElements.map((el) => ({
          selector: el.selector,
          elementName: el.elementName,
          elementPath: el.elementPath,
          rect: el.rect,
          computedStyles: el.computedStyles,
          nearbyText: el.nearbyText,
          componentName: el.componentName,
          sourceLocation: el.sourceLocation,
        })),
        textSelection: textSelection ?? undefined,
        drawing: activeDrawing ?? undefined,
        comment,
        intent,
        severity,
        clickPosition: clickPosition ?? undefined,
        pagePosition: pagePos,
      };

      if (editingIndex !== null) {
        // Replace existing annotation at the editing index
        setPendingBatch((prev) => prev.map((a, i) => (i === editingIndex ? annotation : a)));
        setEditingIndex(null);
        setInitialComment(undefined);
      } else {
        // Append new annotation
        setPendingBatch((prev) => [...prev, annotation]);
        undoStackRef.current.push("annotation");
      }

      // Clear selection after adding to batch
      setSelectedElements([]);
      setTextSelection(null);
      setActiveDrawing(null);
    },
    [selectedElements, textSelection, activeDrawing, iteration, iframeRef, clickPosition, editingIndex]
  );

  // Delete a single annotation from the pending batch
  const handleDeleteAnnotation = useCallback(
    (index: number) => {
      setPendingBatch((prev) => prev.filter((_, i) => i !== index));
      // Remove the corresponding "annotation" entry from undo stack
      let annotationsSeen = 0;
      const stack = undoStackRef.current;
      for (let i = 0; i < stack.length; i++) {
        if (stack[i] === "annotation") {
          if (annotationsSeen === index) {
            stack.splice(i, 1);
            break;
          }
          annotationsSeen++;
        }
      }
    },
    []
  );

  // Edit an existing annotation — load it into the selection panel
  const handleEditAnnotation = useCallback(
    (index: number) => {
      const annotation = pendingBatch[index];
      if (!annotation) return;

      // Load annotation data into selection state
      setSelectedElements(
        annotation.elements.map((el) => ({
          ...el,
          domElement: null as unknown as Element, // DOM ref unavailable during edit
        }))
      );
      setTextSelection(annotation.textSelection ?? null);
      setActiveDrawing(annotation.drawing ?? null);
      setClickPosition(annotation.clickPosition ?? null);
      setEditingIndex(index);
      setInitialComment(annotation.comment);
    },
    [pendingBatch]
  );

  // Delete annotation while editing (trash button in toolbar)
  const handleDeleteEditingAnnotation = useCallback(() => {
    if (editingIndex !== null) {
      handleDeleteAnnotation(editingIndex);
    }
    setEditingIndex(null);
    setInitialComment(undefined);
    setSelectedElements([]);
    setTextSelection(null);
    setActiveDrawing(null);
  }, [editingIndex, handleDeleteAnnotation]);

  // Clear selection
  const handleClearSelection = useCallback(() => {
    setSelectedElements([]);
    setTextSelection(null);
    setActiveDrawing(null);
    setEditingIndex(null);
    setInitialComment(undefined);
  }, []);

  // Handle drag move — add to pending moves list with current iteration
  const handleMove = useCallback(
    (move: PendingMove) => {
      setPendingMoves((prev) => [...prev, { ...move, iteration, url: getCurrentPageUrl(iframeRef) }]);
      undoStackRef.current.push("move");
    },
    [iteration, iframeRef]
  );

  // Convert pending moves to DomChange format for the wire protocol
  const pendingMovesToDomChanges = useCallback((): DomChange[] => {
    return pendingMoves.map((move, idx) => {
      const isReorder = move.reorderIndex !== undefined;
      return {
        id: `pending-move-${idx}-${Date.now()}`,
        iteration: move.iteration ?? iteration,
        url: move.url,
        selector: move.selector,
        type: isReorder ? ("reorder" as const) : ("move" as const),
        componentName: move.componentName,
        sourceLocation: move.sourceLocation,
        before: {
          rect: move.from,
          computedStyles: move.computedStyles,
        },
        after: {
          rect: move.to,
          computedStyles: move.computedStyles,
          siblingIndex: move.reorderIndex,
        },
        timestamp: Date.now(),
      };
    });
  }, [pendingMoves, iteration]);

  // Expose batch submission to parent (called by Submit button in toolbar)
  useEffect(() => {
    const handler = () => {
      if ((pendingBatch.length === 0 && pendingMoves.length === 0) || !connectionRef.current) return;

      connectionRef.current.send({
        type: "batch:submit",
        payload: {
          iteration,
          annotations: pendingBatch.map((a) => ({
            iteration: a.iteration,
            url: a.url,
            elements: a.elements,
            textSelection: a.textSelection,
            drawing: a.drawing,
            comment: a.comment,
            intent: a.intent,
            severity: a.severity,
          })),
          domChanges: pendingMovesToDomChanges(),
        },
      });

      setPendingBatch([]);
      setPendingMoves([]);
      undoStackRef.current = [];
      clearPendingState(iteration);
    };

    window.addEventListener("iterate:submit-batch", handler);
    return () => window.removeEventListener("iterate:submit-batch", handler);
  }, [pendingBatch, pendingMoves, iteration, pendingMovesToDomChanges]);

  // Handle clearing all pending annotations and moves
  useEffect(() => {
    const handler = () => {
      setPendingBatch([]);
      setPendingMoves([]);
      clearPendingState(iteration);
      setSelectedElements([]);
      setTextSelection(null);
      setActiveDrawing(null);
      undoStackRef.current = [];
    };
    window.addEventListener("iterate:clear-batch", handler);
    return () => window.removeEventListener("iterate:clear-batch", handler);
  }, []);

  // Handle undoing the last change (annotation or move)
  useEffect(() => {
    const handler = () => {
      const lastAction = undoStackRef.current.pop();
      if (!lastAction) return;
      if (lastAction === "annotation") {
        setPendingBatch((prev) => (prev.length === 0 ? prev : prev.slice(0, -1)));
      } else {
        setPendingMoves((prev) => (prev.length === 0 ? prev : prev.slice(0, -1)));
      }
    };
    window.addEventListener("iterate:undo", handler);
    return () => window.removeEventListener("iterate:undo", handler);
  }, []);

  // Handle request for batch text (for cross-tab copy) — returns text via custom event
  useEffect(() => {
    const handler = () => {
      if (pendingBatch.length === 0 && pendingMoves.length === 0) {
        window.dispatchEvent(new CustomEvent("iterate:batch-text-response", { detail: { text: "" } }));
        return;
      }

      const domChanges = pendingMoves.map((m) => ({
        type: (m.reorderIndex !== undefined ? "reorder" : "move") as string,
        selector: m.selector,
        componentName: m.componentName,
        sourceLocation: m.sourceLocation,
        before: { rect: m.from },
        after: { rect: m.to },
      }));

      const text = formatBatchPrompt(pendingBatch, domChanges, iteration);
      window.dispatchEvent(new CustomEvent("iterate:batch-text-response", { detail: { text } }));
    };
    window.addEventListener("iterate:request-batch-text", handler);
    return () => window.removeEventListener("iterate:request-batch-text", handler);
  }, [pendingBatch, pendingMoves, iteration]);

  // Handle copying annotations to clipboard as a human-readable prompt
  useEffect(() => {
    const handler = () => {
      if (pendingBatch.length === 0 && pendingMoves.length === 0) return;

      const domChanges = pendingMoves.map((m) => ({
        type: (m.reorderIndex !== undefined ? "reorder" : "move") as string,
        selector: m.selector,
        componentName: m.componentName,
        sourceLocation: m.sourceLocation,
        before: { rect: m.from },
        after: { rect: m.to },
      }));

      const text = formatBatchPrompt(pendingBatch, domChanges, iteration);
      navigator.clipboard.writeText(text);
    };
    window.addEventListener("iterate:copy-batch", handler);
    return () => window.removeEventListener("iterate:copy-batch", handler);
  }, [pendingBatch, pendingMoves, iteration]);

  return (
    <><div
      ref={overlayRef}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      {/* Element picker for click/ctrl+click selection (disabled while annotating) */}
      <ElementPicker
        active={mode === "select" && !isAnnotating}
        iframeRef={iframeRef}
        selectedElements={selectedElements}
        onSelect={handleElementSelect}
        suppressHover={isMarqueeDragging}
      />

      {/* Marquee / rubber-band selection (disabled while annotating) */}
      <MarqueeSelect
        active={mode === "select" && !isAnnotating}
        iframeRef={iframeRef}
        onSelect={handleMarqueeSelect}
        onDragStateChange={setIsMarqueeDragging}
      />

      {/* Text selection capture (disabled while annotating) */}
      <TextSelect
        active={mode === "select" && !isAnnotating}
        iframeRef={iframeRef}
        onTextSelect={handleTextSelect}
      />

      {/* Marker draw tool (disabled while annotating) */}
      <MarkerDraw
        active={mode === "draw" && !isAnnotating}
        iframeRef={iframeRef}
        onDrawComplete={handleDrawComplete}
      />

      {/* Drag handler for move mode with live preview */}
      <DragHandler
        active={mode === "move"}
        iframeRef={iframeRef}
        onMove={handleMove}
        pendingMoves={pendingMoves}
        previewMode={previewMode}
      />

      {/* Persistent selection frames — shown while annotating so user maintains context.
           Hidden for marker/draw tool since the drawn path itself provides context. */}
      {isAnnotating && !activeDrawing && selectedElements.map((el, i) => (
        <div
          key={`sel-frame-${i}`}
          style={{
            position: "absolute",
            left: el.rect.x,
            top: el.rect.y,
            width: el.rect.width,
            height: el.rect.height,
            border: "1.5px solid #6b9eff",
            borderRadius: 4,
            pointerEvents: "none",
            boxSizing: "border-box",
          }}
        />
      ))}

      {/* Persistent drawing stroke while annotating */}
      {isAnnotating && activeDrawing && (
        <svg
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            overflow: "visible",
          }}
        >
          <path
            d={activeDrawing.path}
            fill="none"
            stroke={activeDrawing.strokeColor}
            strokeWidth={activeDrawing.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.7}
          />
        </svg>
      )}

      {/* Selection panel (shows when elements are selected) */}
      <SelectionPanel
        selectedElements={selectedElements}
        textSelection={textSelection}
        onRemoveElement={handleRemoveElement}
        onAddToBatch={handleAddToBatch}
        onClearSelection={handleClearSelection}
        clickPosition={clickPosition}
        isDrawing={activeDrawing != null}
        initialComment={initialComment}
        onDelete={editingIndex !== null ? handleDeleteEditingAnnotation : undefined}
      />

      {/* Preview badge — shown at click position while annotating (before Add).
           When editing, show the editing badge's number instead of a new one. */}
      {isAnnotating && clickPosition && editingIndex === null && (
        <AnimatedBadge
          key={`preview-${pendingBatch.length}-${clickPosition.x}-${clickPosition.y}`}
          number={pendingBatch.length + 1}
          x={clickPosition.x}
          y={clickPosition.y}
          color="#2563eb"
        />
      )}

      {/* Drawing strokes for marker annotations (stay in fixed overlay) */}
      {pendingBatch.map((annotation, batchIdx) =>
        annotation.drawing ? (
          <svg
            key={`drawing-${batchIdx}`}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
              overflow: "visible",
            }}
          >
            <path
              d={annotation.drawing.path}
              fill="none"
              stroke={annotation.drawing.strokeColor}
              strokeWidth={annotation.drawing.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.5}
            />
          </svg>
        ) : null
      )}
    </div>
    {/* Annotation badges rendered in the absolute markers layer — they scroll
        naturally with the page (no JS scroll tracking). Uses createPortal to
        render outside the fixed overlay into a position:absolute container. */}
    {markersLayerRef.current && createPortal(
      <>
        {pendingBatch.map((annotation, batchIdx) => {
          // Hide annotations on a different page
          const onDifferentPage = annotation.url && currentUrl && !urlsMatchPage(annotation.url, currentUrl);
          if (onDifferentPage) return null;

          // Use page-absolute coordinates (stored at creation time).
          // Fall back to clickPosition for old annotations loaded from localStorage.
          const pos = annotation.pagePosition ?? annotation.clickPosition;
          if (!pos) return null;

          return (
            <InteractiveBadge
              key={`batch-${batchIdx}`}
              number={batchIdx + 1}
              x={pos.x}
              y={pos.y}
              color="#2563eb"
              onEdit={() => handleEditAnnotation(batchIdx)}
              isEditing={editingIndex === batchIdx}
            />
          );
        })}
      </>,
      markersLayerRef.current,
    )}
    </>
  );
}

// Spring-like cubic bezier for badge pop-in
const BADGE_SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/**
 * Animated number badge that pops in at a specific position.
 * Uses CSS transitions: starts at scale(0.75) + opacity 0, then
 * springs up to scale(1) + opacity 1 on the next frame.
 */
function AnimatedBadge({
  number,
  x,
  y,
  color,
}: {
  number: number;
  x: number;
  y: number;
  color: string;
}) {
  const [appeared, setAppeared] = useState(false);

  useEffect(() => {
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
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        left: x - 9,
        top: y - 9,
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: color,
        color: "#fff",
        fontSize: 10,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        transform: appeared ? "scale(1)" : "scale(0.75)",
        opacity: appeared ? 1 : 0,
        transition: `transform 0.35s ${BADGE_SPRING}, opacity 0.2s ease`,
      }}
    >
      {number}
    </div>
  );
}

/**
 * Interactive annotation badge. Clickable circle that opens the edit form
 * when clicked. Visually highlights with a ring when being edited.
 * Rendered inside the absolute markers layer so it scrolls naturally with the page.
 */
function InteractiveBadge({
  number,
  x,
  y,
  color,
  onEdit,
  isEditing,
}: {
  number: number;
  x: number;
  y: number;
  color: string;
  onEdit: () => void;
  isEditing?: boolean;
}) {
  const [appeared, setAppeared] = useState(false);

  useEffect(() => {
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
  }, []);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
      style={{
        position: "absolute",
        left: x - 9,
        top: y - 9,
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: color,
        color: "#fff",
        fontSize: 10,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "auto",
        cursor: "pointer",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        transform: appeared ? "scale(1)" : "scale(0.75)",
        opacity: appeared ? 1 : 0,
        transition: `transform 0.35s ${BADGE_SPRING}, opacity 0.2s ease`,
        boxShadow: isEditing ? `0 0 0 3px ${color}44` : "none",
      }}
    >
      {number}
    </div>
  );
}
