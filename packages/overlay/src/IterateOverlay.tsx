import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  Change,
  SelectedElement,
  TextSelection,
  DrawingData,
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
import { saveState, loadState } from "./storage/persistence.js";

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
  /** Current pending change count (passed up for toolbar badge) */
  onBatchCountChange?: (count: number) => void;
  /** Current pending move count (passed up for toolbar badge) */
  onMoveCountChange?: (count: number) => void;
  /** Whether live preview is enabled */
  previewMode?: boolean;
  /** Whether the toolbar is visible — when false, badges are hidden and tools are disabled */
  visible?: boolean;
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
 * Check if an element or any of its ancestors has position:fixed or position:sticky.
 * Returns true if the badge should render in a fixed layer (viewport coords)
 * rather than the absolute layer (page coords).
 */
function isElementFixed(element: Element | null): boolean {
  let current = element;
  while (current && current !== document.documentElement) {
    const pos = window.getComputedStyle(current).position;
    if (pos === "fixed" || pos === "sticky") return true;
    current = current.parentElement;
  }
  return false;
}

/** Create or find a layer div on document.body. */
function getOrCreateLayer(id: string, cssText: string): HTMLDivElement {
  let el = document.getElementById(id) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.style.cssText = cssText;
    document.body.appendChild(el);
  }
  return el;
}

/**
 * Lazily create (or find) the position:absolute markers layer on document.body.
 * Badges rendered inside this layer scroll naturally with the page content.
 */
function getOrCreateMarkersLayer(): HTMLDivElement {
  return getOrCreateLayer(
    "__iterate-markers-layer__",
    "position:absolute;top:0;left:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:10001;"
  );
}

/**
 * Lazily create (or find) the position:fixed markers layer on document.body.
 * Badges for fixed/sticky elements render here so they stay in the viewport.
 */
function getOrCreateFixedMarkersLayer(): HTMLDivElement {
  return getOrCreateLayer(
    "__iterate-fixed-markers-layer__",
    "position:fixed;top:0;left:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:9998;"
  );
}

/**
 * Main overlay component for iterate.
 * Renders element selection tools, change panel, and drag handler
 * on top of an iteration's iframe.
 *
 * Changes and DOM changes are pushed to the daemon immediately on creation
 * (no local batching). The daemon is the source of truth — state is synced via
 * WebSocket and badges are removed when the agent implements them.
 */
export function IterateOverlay({
  mode,
  iteration,
  wsUrl,
  iframeRef,
  onBatchCountChange,
  onMoveCountChange,
  previewMode = true,
  visible = true,
}: IterateOverlayProps) {
  const connectionRef = useRef<DaemonConnection | null>(null);

  // Selection state
  const [selectedElements, setSelectedElements] = useState<PickedElement[]>([]);
  const [textSelection, setTextSelection] = useState<TextSelection | null>(null);
  const [activeDrawing, setActiveDrawing] = useState<DrawingData | null>(null);
  const [clickPosition, setClickPosition] = useState<{ x: number; y: number } | null>(null);

  // Server-side changes — synced from daemon via WebSocket
  const [changes, setChanges] = useState<Change[]>([]);

  // Server-side DOM changes — synced from daemon via WebSocket
  const [domChanges, setDomChanges] = useState<DomChange[]>([]);

  // Track whether marquee drag is in progress (suppresses ElementPicker hover)
  const [isMarqueeDragging, setIsMarqueeDragging] = useState(false);

  // Shared ref: MarqueeSelect sets this after a successful drag so
  // ElementPicker swallows the subsequent click event.
  const justFinishedDragRef = useRef(false);

  const overlayRef = useRef<HTMLDivElement>(null);

  // Markers layers — created once, reused across renders
  // Absolute layer: for normal elements (badges scroll with page)
  // Fixed layer: for fixed/sticky elements (badges stay in viewport)
  const [markersLayer] = useState(() =>
    typeof document !== "undefined" ? getOrCreateMarkersLayer() : null
  );
  const [fixedMarkersLayer] = useState(() =>
    typeof document !== "undefined" ? getOrCreateFixedMarkersLayer() : null
  );

  // Track the current page URL so we can hide changes that belong to other pages.
  const [currentUrl, setCurrentUrl] = useState(() => getCurrentPageUrl(iframeRef));

  useEffect(() => {
    const update = () => setCurrentUrl(getCurrentPageUrl(iframeRef));
    update();
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState = (...args) => { origPush(...args); update(); };
    history.replaceState = (...args) => { origReplace(...args); update(); };
    window.addEventListener("popstate", update);
    const intervalId = setInterval(update, 500);
    return () => {
      history.pushState = origPush;
      history.replaceState = origReplace;
      window.removeEventListener("popstate", update);
      clearInterval(intervalId);
    };
  }, [iframeRef]);

  // Editing state — when editing an existing change badge
  const [editingId, setEditingId] = useState<string | null>(null);
  const [initialComment, setInitialComment] = useState<string | undefined>(undefined);

  // When toolbar is hidden, force browse mode (disables all tools)
  const effectiveMode: ToolMode = visible ? mode : "browse";

  const isAnnotating = selectedElements.length > 0 || textSelection !== null || activeDrawing !== null;

  // Connect to daemon and sync change/dom change state
  useEffect(() => {
    const conn = new DaemonConnection(wsUrl);
    connectionRef.current = conn;
    conn.connect();

    const unsub = conn.onMessage((msg) => {
      switch (msg.type) {
        case "state:sync": {
          // Initial state — load all changes and dom changes for this iteration
          const syncChanges = msg.payload.changes.filter((a: Change) => a.iteration === iteration);
          const syncDomChanges = msg.payload.domChanges.filter((dc: DomChange) => dc.iteration === iteration);

          if (syncChanges.length === 0 && syncDomChanges.length === 0) {
            // Daemon is empty — restore from localStorage (e.g. after daemon restart)
            const cached = loadState(iteration);
            if (cached && (cached.changes.length > 0 || cached.domChanges.length > 0)) {
              // Re-push cached changes to daemon
              for (const a of cached.changes) {
                const { id: _id, timestamp: _ts, status: _st, ...payload } = a;
                conn.send({ type: "change:create", payload });
              }
              for (const dc of cached.domChanges) {
                const { id: _id, timestamp: _ts, ...payload } = dc;
                conn.send({ type: "dom-change:create", payload });
              }
              // State will be populated via the resulting broadcasts
              break;
            }
          }

          setChanges(syncChanges);
          setDomChanges(syncDomChanges);
          break;
        }
        case "change:created":
          if (msg.payload.iteration === iteration) {
            setChanges((prev) => [...prev, msg.payload]);
          }
          break;
        case "change:updated":
          setChanges((prev) =>
            prev.map((a) => (a.id === msg.payload.id ? msg.payload : a))
          );
          break;
        case "change:deleted":
          setChanges((prev) => prev.filter((a) => a.id !== msg.payload.id));
          break;
        case "dom:changed":
          if (msg.payload.iteration === iteration) {
            setDomChanges((prev) => {
              if (prev.some((dc) => dc.id === msg.payload.id)) return prev;
              return [...prev, msg.payload];
            });
          }
          break;
        case "dom:deleted":
          setDomChanges((prev) => prev.filter((dc) => dc.id !== msg.payload.id));
          break;
      }
    });

    return () => {
      unsub();
      conn.disconnect();
    };
  }, [wsUrl, iteration]);

  // Mirror daemon state to localStorage (survives daemon restarts)
  useEffect(() => {
    saveState(iteration, changes, domChanges);
  }, [iteration, changes, domChanges]);

  // Visible changes: queued or in-progress, matching current page
  const visibleChanges = changes.filter((a) => {
    if (a.status === "implemented") return false;
    if (a.url && currentUrl && !urlsMatchPage(a.url, currentUrl)) return false;
    return true;
  });

  // Pending counts for toolbar badges
  const pendingChangeCount = changes.filter((a) => a.status === "queued" || a.status === "in-progress").length;
  const pendingDomChangeCount = domChanges.length;

  // Notify parent of count changes
  useEffect(() => {
    onBatchCountChange?.(pendingChangeCount);
  }, [pendingChangeCount, onBatchCountChange]);

  useEffect(() => {
    onMoveCountChange?.(pendingDomChangeCount);
  }, [pendingDomChangeCount, onMoveCountChange]);

  // Handle element selection from ElementPicker (click / ctrl+click)
  const handleElementSelect = useCallback(
    (elements: PickedElement[], clickPos?: { x: number; y: number }) => {
      setSelectedElements(elements);
      if (clickPos) {
        const scroll = getScrollOffset();
        setClickPosition({ x: clickPos.x + scroll.x, y: clickPos.y + scroll.y });
      }
    },
    []
  );

  // Handle marquee selection (replaces the current selection)
  const handleMarqueeSelect = useCallback(
    (elements: PickedElement[]) => {
      setSelectedElements(elements);
      if (elements.length > 0) {
        const scroll = getScrollOffset();
        let maxRight = -Infinity, sumY = 0;
        for (const el of elements) {
          const r = el.rect;
          if (r.x + r.width > maxRight) maxRight = r.x + r.width;
          sumY += r.y + r.height / 2;
        }
        setClickPosition({ x: maxRight + scroll.x, y: sumY / elements.length + scroll.y });
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
      const scroll = getScrollOffset();
      const startMatch = drawing.path.match(/^M\s+([\d.]+)\s+([\d.]+)/);
      if (startMatch) {
        setClickPosition({
          x: parseFloat(startMatch[1]!) + scroll.x,
          y: parseFloat(startMatch[2]!) + scroll.y,
        });
      } else {
        setClickPosition({
          x: drawing.bounds.x + drawing.bounds.width + scroll.x,
          y: drawing.bounds.y + drawing.bounds.height / 2 + scroll.y,
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

  // Add change — sends directly to daemon (no local batching)
  const handleAddChange = useCallback(
    (comment: string) => {
      if (selectedElements.length === 0 && !textSelection && !activeDrawing) return;
      const conn = connectionRef.current;
      if (!conn) return;

      // Detect if the element is fixed/sticky — if so, store viewport coords
      // and render the badge in the fixed layer instead of the absolute (scrolling) layer.
      const fixed = selectedElements.length > 0 && isElementFixed(selectedElements[0]!.domElement);

      const scroll = getScrollOffset();
      let pagePos: { x: number; y: number } | undefined;
      if (clickPosition) {
        // clickPosition is already in page coordinates
        pagePos = fixed
          ? { x: clickPosition.x - scroll.x, y: clickPosition.y - scroll.y }
          : { x: clickPosition.x, y: clickPosition.y };
      } else if (selectedElements.length > 0) {
        const el = selectedElements[0]!;
        // el.rect is already in viewport coords (from getBoundingClientRect)
        pagePos = fixed
          ? { x: el.rect.x + el.rect.width / 2, y: el.rect.y + el.rect.height / 2 }
          : { x: el.rect.x + el.rect.width / 2 + scroll.x, y: el.rect.y + el.rect.height / 2 + scroll.y };
      } else if (activeDrawing) {
        pagePos = {
          x: activeDrawing.bounds.x + activeDrawing.bounds.width / 2 + scroll.x,
          y: activeDrawing.bounds.y + activeDrawing.bounds.height / 2 + scroll.y,
        };
      }

      // If editing, delete the old change first
      if (editingId !== null) {
        conn.send({ type: "change:delete", payload: { id: editingId } });
        setEditingId(null);
        setInitialComment(undefined);
      }

      // Send new change to daemon — it will broadcast change:created back
      conn.send({
        type: "change:create",
        payload: {
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
          pagePosition: pagePos,
          isFixedPosition: fixed || undefined,
          drawingScrollOffset: activeDrawing ? { x: scroll.x, y: scroll.y } : undefined,
        },
      });

      // Clear selection immediately
      setSelectedElements([]);
      setTextSelection(null);
      setActiveDrawing(null);
    },
    [selectedElements, textSelection, activeDrawing, iteration, iframeRef, clickPosition, editingId]
  );

  // Delete a change from the daemon
  const handleDeleteChange = useCallback(
    (id: string) => {
      connectionRef.current?.send({ type: "change:delete", payload: { id } });
    },
    []
  );

  // Edit an existing change — load it into the selection panel
  const handleEditChange = useCallback(
    (id: string) => {
      const change = changes.find((a) => a.id === id);
      if (!change) return;

      setSelectedElements(
        change.elements.map((el) => ({
          ...el,
          domElement: null as unknown as Element,
        }))
      );
      setTextSelection(change.textSelection ?? null);
      setActiveDrawing(change.drawing ?? null);
      setClickPosition(change.pagePosition ?? null);
      setEditingId(id);
      setInitialComment(change.comment);
    },
    [changes]
  );

  // Delete change while editing (trash button in toolbar)
  const handleDeleteEditingChange = useCallback(() => {
    if (editingId !== null) {
      handleDeleteChange(editingId);
    }
    setEditingId(null);
    setInitialComment(undefined);
    setSelectedElements([]);
    setTextSelection(null);
    setActiveDrawing(null);
  }, [editingId, handleDeleteChange]);

  // Clear selection
  const handleClearSelection = useCallback(() => {
    setSelectedElements([]);
    setTextSelection(null);
    setActiveDrawing(null);
    setEditingId(null);
    setInitialComment(undefined);
  }, []);

  // Handle drag move — send directly to daemon
  const handleMove = useCallback(
    (move: PendingMove) => {
      const conn = connectionRef.current;
      if (!conn) return;

      const isReorder = move.reorderIndex !== undefined;
      conn.send({
        type: "dom-change:create",
        payload: {
          iteration,
          url: getCurrentPageUrl(iframeRef),
          selector: move.selector,
          type: isReorder ? "reorder" : "move",
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
        },
      });
    },
    [iteration, iframeRef]
  );

  // Helper: revert a single reorder move in the DOM
  const revertDomChange = useCallback(
    (change: DomChange) => {
      if (change.type !== "reorder" || change.after.siblingIndex === undefined) return;
      const doc = (() => { try { return iframeRef.current?.contentDocument ?? document; } catch { return document; } })();
      try {
        const el = doc.querySelector(change.selector);
        if (!el || !el.parentElement) return;
        const parent = el.parentElement;
        const children = Array.from(parent.children);
        const refChild = children[change.before.siblingIndex ?? 0] ?? null;
        if (refChild !== el) parent.insertBefore(el, refChild);
      } catch { /* cross-origin or invalid selector */ }
    },
    [iframeRef]
  );

  // Delete a DOM change from the daemon
  const handleDeleteDomChange = useCallback(
    (id: string) => {
      const change = domChanges.find((dc) => dc.id === id);
      if (change) revertDomChange(change);
      connectionRef.current?.send({ type: "dom-change:delete", payload: { id } });
    },
    [domChanges, revertDomChange]
  );

  // Convert DomChange to PendingMove shape for DragHandler rendering
  const pendingMoves: PendingMove[] = domChanges.map((dc) => ({
    iteration: dc.iteration,
    url: dc.url,
    selector: dc.selector,
    from: dc.before.rect,
    to: dc.after.rect,
    computedStyles: dc.before.computedStyles,
    componentName: dc.componentName,
    sourceLocation: dc.sourceLocation,
    reorderIndex: dc.after.siblingIndex,
  }));

  // Handle clearing all pending changes and moves
  useEffect(() => {
    const handler = () => {
      const conn = connectionRef.current;
      if (!conn) return;
      for (const a of changes) {
        if (a.status === "queued") {
          conn.send({ type: "change:delete", payload: { id: a.id } });
        }
      }
      for (let i = domChanges.length - 1; i >= 0; i--) {
        revertDomChange(domChanges[i]!);
        conn.send({ type: "dom-change:delete", payload: { id: domChanges[i]!.id } });
      }
      setSelectedElements([]);
      setTextSelection(null);
      setActiveDrawing(null);
    };
    window.addEventListener("iterate:clear-batch", handler);
    return () => window.removeEventListener("iterate:clear-batch", handler);
  }, [changes, domChanges, revertDomChange]);

  // Handle undoing the last item — delete most recent change or dom change
  useEffect(() => {
    const handler = () => {
      const conn = connectionRef.current;
      if (!conn) return;

      const lastChange = changes.filter((a) => a.status === "queued").at(-1);
      const lastDomChange = domChanges.at(-1);

      if (!lastChange && !lastDomChange) return;

      const changeTime = lastChange?.timestamp ?? 0;
      const domChangeTime = lastDomChange?.timestamp ?? 0;

      if (changeTime >= domChangeTime && lastChange) {
        conn.send({ type: "change:delete", payload: { id: lastChange.id } });
      } else if (lastDomChange) {
        revertDomChange(lastDomChange);
        conn.send({ type: "dom-change:delete", payload: { id: lastDomChange.id } });
      }
    };
    window.addEventListener("iterate:undo", handler);
    return () => window.removeEventListener("iterate:undo", handler);
  }, [changes, domChanges, revertDomChange]);

  // Handle request for batch text (for cross-tab copy)
  useEffect(() => {
    const handler = () => {
      const pending = changes.filter((a) => a.status === "queued" || a.status === "in-progress");
      if (pending.length === 0 && domChanges.length === 0) {
        window.dispatchEvent(new CustomEvent("iterate:batch-text-response", { detail: { text: "" } }));
        return;
      }

      const formattedDomChanges = domChanges.map((dc) => ({
        type: dc.type as string,
        selector: dc.selector,
        componentName: dc.componentName,
        sourceLocation: dc.sourceLocation,
        before: { rect: dc.before.rect },
        after: { rect: dc.after.rect },
        url: dc.url,
      }));

      const text = formatBatchPrompt(pending, formattedDomChanges, iteration);
      window.dispatchEvent(new CustomEvent("iterate:batch-text-response", { detail: { text } }));
    };
    window.addEventListener("iterate:request-batch-text", handler);
    return () => window.removeEventListener("iterate:request-batch-text", handler);
  }, [changes, domChanges, iteration]);

  // Handle copying changes to clipboard
  useEffect(() => {
    const handler = () => {
      const pending = changes.filter((a) => a.status === "queued" || a.status === "in-progress");
      if (pending.length === 0 && domChanges.length === 0) return;

      const formattedDomChanges = domChanges.map((dc) => ({
        type: dc.type as string,
        selector: dc.selector,
        componentName: dc.componentName,
        sourceLocation: dc.sourceLocation,
        before: { rect: dc.before.rect },
        after: { rect: dc.after.rect },
        url: dc.url,
      }));

      const text = formatBatchPrompt(pending, formattedDomChanges, iteration);
      navigator.clipboard.writeText(text);
    };
    window.addEventListener("iterate:copy-batch", handler);
    return () => window.removeEventListener("iterate:copy-batch", handler);
  }, [changes, domChanges, iteration]);

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
        active={effectiveMode === "select" && !isAnnotating}
        iframeRef={iframeRef}
        selectedElements={selectedElements}
        onSelect={handleElementSelect}
        suppressHover={isMarqueeDragging}
        justFinishedDragRef={justFinishedDragRef}
      />

      {/* Marquee / rubber-band selection (disabled while annotating) */}
      <MarqueeSelect
        active={effectiveMode === "select" && !isAnnotating}
        iframeRef={iframeRef}
        onSelect={handleMarqueeSelect}
        onDragStateChange={setIsMarqueeDragging}
        justFinishedDragRef={justFinishedDragRef}
      />

      {/* Text selection capture (disabled while annotating) */}
      <TextSelect
        active={effectiveMode === "select" && !isAnnotating}
        iframeRef={iframeRef}
        onTextSelect={handleTextSelect}
      />

      {/* Marker draw tool (disabled while annotating) */}
      <MarkerDraw
        active={effectiveMode === "draw" && !isAnnotating}
        iframeRef={iframeRef}
        onDrawComplete={handleDrawComplete}
      />

      {/* Drag handler for move mode with live preview */}
      <DragHandler
        active={effectiveMode === "move"}
        iframeRef={iframeRef}
        onMove={handleMove}
        pendingMoves={pendingMoves}
        previewMode={previewMode}
        onDeleteMove={(idx) => {
          const dc = domChanges[idx];
          if (dc) handleDeleteDomChange(dc.id);
        }}
      />

      {/* Persistent selection frames — shown while annotating so user maintains context. */}
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

    </div>
    {/* Change badges rendered in two layers:
        1. Absolute layer (position:absolute) — for normal elements, scrolls with page
        2. Fixed layer (position:fixed) — for fixed/sticky elements, stays in viewport
        Hidden when toolbar is closed. */}
    {visible && markersLayer && createPortal(
      <>
        {/* Selection panel + preview badge — rendered here so they share the same
            absolute coordinate system as the saved badges and scroll with the page */}
        <SelectionPanel
          selectedElements={selectedElements}
          textSelection={textSelection}
          onRemoveElement={handleRemoveElement}
          onAddToBatch={handleAddChange}
          onClearSelection={handleClearSelection}
          clickPosition={clickPosition}
          isDrawing={activeDrawing != null}
          initialComment={initialComment}
          onDelete={editingId !== null ? handleDeleteEditingChange : undefined}
        />
        {isAnnotating && clickPosition && editingId === null && (
          <AnimatedBadge
            key={`preview-${visibleChanges.length}-${clickPosition.x}-${clickPosition.y}`}
            number={visibleChanges.length + 1}
            x={clickPosition.x}
            y={clickPosition.y}
            color="#2563eb"
          />
        )}
        {visibleChanges.map((change, idx) => {
          if (change.isFixedPosition) return null; // rendered in fixed layer
          const pos = change.pagePosition;
          if (!pos) return null;

          return (
            <React.Fragment key={change.id}>
              {change.drawing && (
                <svg
                  style={{
                    position: "absolute",
                    left: change.drawingScrollOffset?.x ?? 0,
                    top: change.drawingScrollOffset?.y ?? 0,
                    width: "100vw",
                    height: "100vh",
                    pointerEvents: "none",
                    overflow: "visible",
                  }}
                >
                  <path
                    d={change.drawing.path}
                    fill="none"
                    stroke={change.drawing.strokeColor}
                    strokeWidth={change.drawing.strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.5}
                  />
                </svg>
              )}
              <InteractiveBadge
                number={idx + 1}
                x={pos.x}
                y={pos.y}
                color={change.status === "in-progress" ? "#16a34a" : "#2563eb"}
                onEdit={() => handleEditChange(change.id)}
                isEditing={editingId === change.id}
              />
            </React.Fragment>
          );
        })}
      </>,
      markersLayer,
    )}
    {visible && fixedMarkersLayer && createPortal(
      <>
        {visibleChanges.map((change, idx) => {
          if (!change.isFixedPosition) return null; // rendered in absolute layer
          const pos = change.pagePosition;
          if (!pos) return null;

          return (
            <React.Fragment key={change.id}>
              {change.drawing && (
                <svg
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: "100vw",
                    height: "100vh",
                    pointerEvents: "none",
                    overflow: "visible",
                  }}
                >
                  <path
                    d={change.drawing.path}
                    fill="none"
                    stroke={change.drawing.strokeColor}
                    strokeWidth={change.drawing.strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.5}
                  />
                </svg>
              )}
              <InteractiveBadge
                number={idx + 1}
                x={pos.x}
                y={pos.y}
                color={change.status === "in-progress" ? "#16a34a" : "#2563eb"}
                onEdit={() => handleEditChange(change.id)}
                isEditing={editingId === change.id}
              />
            </React.Fragment>
          );
        })}
      </>,
      fixedMarkersLayer,
    )}
    </>
  );
}

// Spring-like cubic bezier for badge pop-in
const BADGE_SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/**
 * Animated number badge that pops in at a specific position.
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
 * Interactive change badge. Clickable circle that opens the edit form
 * when clicked. Rendered inside the absolute markers layer so it scrolls
 * naturally with the page.
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
