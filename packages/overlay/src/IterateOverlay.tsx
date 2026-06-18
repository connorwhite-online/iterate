import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  Change,
  SelectedElement,
  TextSelection,
  DrawingData,
  DomChange,
  CritiqueFinding,
  CritiqueRequest,
} from "iterate-ui-core";
import { formatBatchPrompt } from "iterate-ui-core";
import { ElementPicker, type PickedElement } from "./inspector/ElementPicker.js";
import { capturePageSnapshot } from "./inspector/snapshot.js";
import { MarqueeSelect } from "./inspector/MarqueeSelect.js";
import { TextSelect } from "./inspector/TextSelect.js";
import { MarkerDraw } from "./inspector/MarkerDraw.js";
import { SelectionPanel } from "./annotate/SelectionPanel.js";
import { DragHandler, type PendingMove } from "./manipulate/DragHandler.js";
import { DaemonConnection } from "./transport/connection.js";
import { saveState, loadState } from "./storage/persistence.js";

export type ToolMode = "select" | "move" | "draw" | "browse" | "critique";

/** Severity → badge color for critique findings. */
const SEVERITY_COLORS: Record<string, string> = {
  high: "#dc2626",
  medium: "#d97706",
  low: "#2563eb",
};

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
  /** Whether any changes are currently being processed (in-progress) */
  onProcessingChange?: (processing: boolean) => void;
  /** Whether live preview is enabled */
  previewMode?: boolean;
  /** Whether the toolbar is visible — when false, badges are hidden and tools are disabled */
  visible?: boolean;
  /** Incrementing trigger — each new value runs a critique on the current screen */
  critiqueNonce?: number;
  /** Focus request — scrolls to and opens a finding's card when nonce changes */
  focusFinding?: { id: string; nonce: number };
  /** Current open-finding count (passed up for toolbar badge) */
  onCritiqueCountChange?: (count: number) => void;
  /** Whether a critique run is in progress (passed up for scanning indicator) */
  onCritiqueScanningChange?: (scanning: boolean) => void;
  /** Open critique findings for the current iteration (passed up for the panel results list) */
  onCritiqueFindingsChange?: (findings: CritiqueFinding[]) => void;
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
  onProcessingChange,
  previewMode = true,
  visible = true,
  critiqueNonce = 0,
  focusFinding,
  onCritiqueCountChange,
  onCritiqueScanningChange,
  onCritiqueFindingsChange,
}: IterateOverlayProps) {
  const connectionRef = useRef<DaemonConnection | null>(null);

  // Selection state
  const [selectedElements, setSelectedElements] = useState<PickedElement[]>([]);
  const [textSelection, setTextSelection] = useState<TextSelection | null>(null);
  const [activeDrawing, setActiveDrawing] = useState<DrawingData | null>(null);
  const [clickPosition, setClickPosition] = useState<{ x: number; y: number } | null>(null);
  const [drawingScroll, setDrawingScroll] = useState({ x: 0, y: 0 });

  // Server-side changes — synced from daemon via WebSocket
  const [changes, setChanges] = useState<Change[]>([]);

  // Critique state — synced from daemon via WebSocket
  const [critiqueFindings, setCritiqueFindings] = useState<CritiqueFinding[]>([]);
  const [critiqueRequests, setCritiqueRequests] = useState<CritiqueRequest[]>([]);
  // Which finding's detail card is open
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);

  // Server-side DOM changes — synced from daemon via WebSocket
  const [domChanges, setDomChanges] = useState<DomChange[]>([]);
  const domChangesRef = useRef<DomChange[]>([]);
  // Track which DOM change IDs have been applied to the live DOM (survives re-renders, not reloads)
  const appliedDomChangesRef = useRef<Set<string>>(new Set());

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
  const [editingIsFixed, setEditingIsFixed] = useState(false);

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
          setCritiqueFindings(
            (msg.payload.critiqueFindings ?? []).filter((f: CritiqueFinding) => f.iteration === iteration)
          );
          setCritiqueRequests(
            (msg.payload.critiqueRequests ?? []).filter((r: CritiqueRequest) => r.iteration === iteration)
          );
          break;
        }
        case "critique:requested":
          if (msg.payload.iteration === iteration) {
            setCritiqueRequests((prev) => [...prev, msg.payload]);
          }
          break;
        case "critique:request-updated":
          setCritiqueRequests((prev) => prev.map((r) => (r.id === msg.payload.id ? msg.payload : r)));
          break;
        case "critique:finding-created":
          if (msg.payload.iteration === iteration) {
            setCritiqueFindings((prev) => [...prev, msg.payload]);
          }
          break;
        case "critique:finding-updated":
          setCritiqueFindings((prev) => prev.map((f) => (f.id === msg.payload.id ? msg.payload : f)));
          break;
        case "critique:finding-deleted":
          setCritiqueFindings((prev) => prev.filter((f) => f.id !== msg.payload.id));
          break;
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
            // Mark as already applied — during a live session, the DOM mutation
            // happened before the change was recorded, so no replay needed
            appliedDomChangesRef.current.add(msg.payload.id);
            setDomChanges((prev) => {
              if (prev.some((dc) => dc.id === msg.payload.id)) return prev;
              // For reorders, replace any existing entry for the same selector (coalescing)
              const filtered = msg.payload.type === "reorder"
                ? prev.filter((dc) => !(dc.type === "reorder" && dc.selector === msg.payload.selector))
                : prev;
              return [...filtered, msg.payload];
            });
          }
          break;
        case "dom:deleted":
          appliedDomChangesRef.current.delete(msg.payload.id);
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
  const isProcessing = changes.some((a) => a.status === "in-progress");

  // Notify parent of count changes
  useEffect(() => {
    onBatchCountChange?.(pendingChangeCount);
  }, [pendingChangeCount, onBatchCountChange]);

  useEffect(() => {
    onMoveCountChange?.(pendingDomChangeCount);
  }, [pendingDomChangeCount, onMoveCountChange]);

  useEffect(() => {
    onProcessingChange?.(isProcessing);
  }, [isProcessing, onProcessingChange]);

  // Open findings for the current page (applied/dismissed are filtered out;
  // applied findings live on as a queued Change badge instead).
  const visibleFindings = critiqueFindings.filter((f) => {
    if (f.status !== "open") return false;
    if (f.url && currentUrl && !urlsMatchPage(f.url, currentUrl)) return false;
    return true;
  });
  const critiqueScanning = critiqueRequests.some((r) => r.status !== "complete");

  useEffect(() => {
    onCritiqueCountChange?.(visibleFindings.length);
  }, [visibleFindings.length, onCritiqueCountChange]);

  useEffect(() => {
    onCritiqueScanningChange?.(critiqueScanning);
  }, [critiqueScanning, onCritiqueScanningChange]);

  useEffect(() => {
    onCritiqueFindingsChange?.(visibleFindings);
    // visibleFindings is recomputed each render; depend on a stable signature
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [critiqueFindings, currentUrl]);

  // Run a critique when the trigger nonce changes. Captures a snapshot of the
  // current screen (same-origin document) and sends it to the daemon, which
  // auto-runs the analysis agent.
  const lastCritiqueNonce = useRef(0);
  useEffect(() => {
    if (critiqueNonce <= 0 || critiqueNonce === lastCritiqueNonce.current) return;
    lastCritiqueNonce.current = critiqueNonce;
    const conn = connectionRef.current;
    if (!conn) return;
    let targetDoc: Document = document;
    try {
      targetDoc = iframeRef.current?.contentDocument ?? document;
    } catch {
      targetDoc = document;
    }
    const snapshot = capturePageSnapshot(targetDoc, getScrollOffset());
    conn.send({
      type: "critique:request",
      payload: { iteration, url: getCurrentPageUrl(iframeRef), snapshot },
    });
  }, [critiqueNonce, iteration, iframeRef]);

  // Apply a finding: create a normal queued change from it (so iterate:go
  // implements it), then mark the finding applied so its badge is replaced.
  const handleApplyFinding = useCallback(
    (id: string) => {
      const conn = connectionRef.current;
      const finding = critiqueFindings.find((f) => f.id === id);
      if (!conn || !finding) return;
      const { tagName: _t, depth: _d, isFixed: _f, ...element } = finding.element;
      conn.send({
        type: "change:create",
        payload: {
          iteration,
          url: finding.url ?? getCurrentPageUrl(iframeRef),
          elements: [element as SelectedElement],
          comment: `${finding.recommendation} — ${finding.principleTitle} (${finding.severity})`,
          pagePosition: finding.pagePosition,
          isFixedPosition: finding.isFixedPosition || undefined,
        },
      });
      conn.send({ type: "critique:finding-apply", payload: { id } });
      setSelectedFindingId(null);
    },
    [critiqueFindings, iteration, iframeRef]
  );

  // Dismiss a finding: removes it from the daemon (and its badge).
  const handleDismissFinding = useCallback((id: string) => {
    connectionRef.current?.send({ type: "critique:finding-dismiss", payload: { id } });
    setSelectedFindingId((prev) => (prev === id ? null : prev));
  }, []);

  // Focus a finding from the panel list: scroll its element into view and open the card.
  const lastFocusNonce = useRef(0);
  useEffect(() => {
    if (!focusFinding || focusFinding.nonce === lastFocusNonce.current) return;
    lastFocusNonce.current = focusFinding.nonce;
    const finding = critiqueFindings.find((f) => f.id === focusFinding.id);
    if (!finding) return;
    setSelectedFindingId(finding.id);
    try {
      const doc = iframeRef.current?.contentDocument ?? document;
      const el = doc.querySelector(finding.element.selector);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      // Best-effort scroll; ignore invalid selectors / cross-origin docs.
    }
  }, [focusFinding, critiqueFindings, iframeRef]);

  // Handle element selection from ElementPicker (click / ctrl+click)
  const handleElementSelect = useCallback(
    (elements: PickedElement[], clickPos?: { x: number; y: number }) => {
      const scroll = getScrollOffset();
      // Convert viewport rects to page coordinates so highlights scroll with the page
      setSelectedElements(elements.map((el) => ({
        ...el,
        rect: { ...el.rect, x: el.rect.x + scroll.x, y: el.rect.y + scroll.y },
      })));
      if (clickPos) {
        setClickPosition({ x: clickPos.x + scroll.x, y: clickPos.y + scroll.y });
      }
    },
    []
  );

  // Handle marquee selection (replaces the current selection)
  const handleMarqueeSelect = useCallback(
    (elements: PickedElement[]) => {
      const scroll = getScrollOffset();
      // Convert viewport rects to page coordinates
      setSelectedElements(elements.map((el) => ({
        ...el,
        rect: { ...el.rect, x: el.rect.x + scroll.x, y: el.rect.y + scroll.y },
      })));
      if (elements.length > 0) {
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
      const scroll = getScrollOffset();
      // Convert viewport rects to page coordinates
      setSelectedElements(elements.map((el) => ({
        ...el,
        rect: { ...el.rect, x: el.rect.x + scroll.x, y: el.rect.y + scroll.y },
      })));
      setActiveDrawing(drawing);
      setDrawingScroll(scroll);
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
      // When editing, domElement is null, so fall back to the original change's flag.
      const fixed = editingId !== null
        ? editingIsFixed
        : selectedElements.length > 0 && isElementFixed(selectedElements[0]!.domElement);

      const scroll = getScrollOffset();
      let pagePos: { x: number; y: number } | undefined;
      if (clickPosition) {
        // clickPosition is already in page coordinates
        pagePos = fixed
          ? { x: clickPosition.x - scroll.x, y: clickPosition.y - scroll.y }
          : { x: clickPosition.x, y: clickPosition.y };
      } else if (selectedElements.length > 0) {
        const el = selectedElements[0]!;
        // el.rect is already in page coordinates
        pagePos = fixed
          ? { x: el.rect.x - scroll.x + el.rect.width / 2, y: el.rect.y - scroll.y + el.rect.height / 2 }
          : { x: el.rect.x + el.rect.width / 2, y: el.rect.y + el.rect.height / 2 };
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
    [selectedElements, textSelection, activeDrawing, iteration, iframeRef, clickPosition, editingId, editingIsFixed]
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
      // Fixed-position changes store viewport coords — convert to page coords
      // since the SelectionPanel is rendered in the absolute markers layer
      if (change.pagePosition) {
        const scroll = getScrollOffset();
        setClickPosition(
          change.isFixedPosition
            ? { x: change.pagePosition.x + scroll.x, y: change.pagePosition.y + scroll.y }
            : change.pagePosition
        );
      } else {
        setClickPosition(null);
      }
      setEditingId(id);
      setEditingIsFixed(!!change.isFixedPosition);
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
    setEditingIsFixed(false);
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
    setEditingIsFixed(false);
    setInitialComment(undefined);
  }, []);

  // Keep ref in sync for use in callbacks without stale closures
  useEffect(() => { domChangesRef.current = domChanges; }, [domChanges]);

  // Handle drag move — send directly to daemon
  const handleMove = useCallback(
    (move: PendingMove) => {
      const conn = connectionRef.current;
      if (!conn) return;

      const isReorder = move.reorderIndex !== undefined;

      // Coalesce reorders: if there's already a reorder for this element,
      // delete the old one and preserve its original before.siblingIndex and parentSelector
      let originalSiblingIndex = move.originalSiblingIndex;
      let originalParentSelector = move.parentSelector;
      if (isReorder) {
        const existing = domChangesRef.current.find(
          (dc) => dc.type === "reorder" && dc.selector === move.selector
        );
        if (existing) {
          // Preserve the true original position from the first move
          originalSiblingIndex = existing.before.siblingIndex;
          originalParentSelector = existing.parentSelector;
          conn.send({ type: "dom-change:delete", payload: { id: existing.id } });
        }

        // If dragged back to original parent at original index, just delete — no net change
        const sameParent = !move.targetParentSelector || move.targetParentSelector === originalParentSelector;
        if (sameParent && move.reorderIndex === originalSiblingIndex) {
          return;
        }
      }

      conn.send({
        type: "dom-change:create",
        payload: {
          iteration,
          url: getCurrentPageUrl(iframeRef),
          selector: move.selector,
          parentSelector: originalParentSelector,
          targetParentSelector: move.targetParentSelector,
          type: isReorder ? "reorder" : "move",
          componentName: move.componentName,
          sourceLocation: move.sourceLocation,
          before: {
            rect: move.from,
            computedStyles: move.computedStyles,
            siblingIndex: originalSiblingIndex,
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
  /** Apply a persisted DOM change to the live page (used on reload to replay reorders) */
  const applyDomChange = useCallback(
    (change: DomChange) => {
      if (change.type !== "reorder" || change.after.siblingIndex === undefined) return;
      const doc = (() => { try { return iframeRef.current?.contentDocument ?? document; } catch { return document; } })();
      try {
        const isCrossParent = change.targetParentSelector && change.targetParentSelector !== change.parentSelector;

        if (isCrossParent) {
          // Cross-parent apply: find element in original parent, move to target parent
          const originalParent = change.parentSelector ? doc.querySelector(change.parentSelector) : null;
          const targetParent = doc.querySelector(change.targetParentSelector!);
          if (!originalParent || !targetParent) return;
          const el = change.before.siblingIndex !== undefined
            ? originalParent.children[change.before.siblingIndex] ?? null
            : null;
          if (!el) return;
          const targetChildren = Array.from(targetParent.children);
          const refChild = targetChildren[change.after.siblingIndex] ?? null;
          targetParent.insertBefore(el, refChild);
          return;
        }

        // Same-parent apply: find element at before index, move to after index
        const parent = change.parentSelector ? doc.querySelector(change.parentSelector) : null;
        if (!parent) return;
        const el = change.before.siblingIndex !== undefined
          ? parent.children[change.before.siblingIndex] ?? null
          : null;
        if (!el) return;
        const children = Array.from(parent.children).filter((c) => c !== el);
        const refChild = children[change.after.siblingIndex] ?? null;
        parent.insertBefore(el, refChild);
      } catch { /* cross-origin or invalid selector */ }
    },
    [iframeRef]
  );

  // Replay persisted DOM changes on reload — apply any reorders that haven't been applied yet
  useEffect(() => {
    if (domChanges.length === 0) return;
    const unapplied = domChanges
      .filter((dc) => dc.type === "reorder" && !appliedDomChangesRef.current.has(dc.id))
      .sort((a, b) => a.timestamp - b.timestamp);
    for (const dc of unapplied) {
      applyDomChange(dc);
      appliedDomChangesRef.current.add(dc.id);
    }
  }, [domChanges, applyDomChange]);

  const revertDomChange = useCallback(
    (change: DomChange) => {
      if (change.type !== "reorder" || change.before.siblingIndex === undefined) return;
      const doc = (() => { try { return iframeRef.current?.contentDocument ?? document; } catch { return document; } })();
      try {
        const isCrossParent = change.targetParentSelector && change.targetParentSelector !== change.parentSelector;

        if (isCrossParent) {
          // Cross-parent revert: find element in target parent, move back to original parent
          const targetParent = doc.querySelector(change.targetParentSelector!);
          const originalParent = change.parentSelector ? doc.querySelector(change.parentSelector) : null;
          if (!targetParent || !originalParent) return;
          const el = change.after.siblingIndex !== undefined
            ? targetParent.children[change.after.siblingIndex] ?? null
            : null;
          if (!el) return;
          const origChildren = Array.from(originalParent.children);
          const refChild = origChildren[change.before.siblingIndex] ?? null;
          originalParent.insertBefore(el, refChild);
          return;
        }

        // Same-parent revert: find the element, move it back to original sibling index
        let el: Element | null = null;
        // Prefer using parentSelector + after.siblingIndex (stable after DOM reorder)
        // since the element's own selector uses nth-child which becomes stale after reordering
        if (change.parentSelector && change.after.siblingIndex !== undefined) {
          const parent = doc.querySelector(change.parentSelector);
          if (parent) {
            el = parent.children[change.after.siblingIndex] ?? null;
          }
        }
        // Fallback to direct selector
        if (!el) el = doc.querySelector(change.selector);
        if (!el || !el.parentElement) return;
        const parent = el.parentElement;
        // Filter out the element itself to get the correct insertion reference
        const children = Array.from(parent.children).filter((c) => c !== el);
        const refChild = children[change.before.siblingIndex] ?? null;
        parent.insertBefore(el, refChild);
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
    originalSiblingIndex: dc.before.siblingIndex,
    parentSelector: dc.parentSelector,
    targetParentSelector: dc.targetParentSelector,
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



    </div>
    {/* Change badges rendered in two layers:
        1. Absolute layer (position:absolute) — for normal elements, scrolls with page
        2. Fixed layer (position:fixed) — for fixed/sticky elements, stays in viewport
        Hidden when toolbar is closed. */}
    {visible && markersLayer && createPortal(
      <>
        {/* Persistent drawing stroke while annotating — page coordinates */}
        {isAnnotating && activeDrawing && (
          <svg
            style={{
              position: "absolute",
              left: drawingScroll.x,
              top: drawingScroll.y,
              width: "100vw",
              height: "100vh",
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

        {/* Selected element highlights — page coordinates so they scroll with the page */}
        {!activeDrawing && selectedElements.map((el, i) => {
          const px = el.rect.x;
          const py = el.rect.y;
          return (
            <React.Fragment key={el.selector + i}>
              <div
                style={{
                  position: "absolute",
                  left: px,
                  top: py,
                  width: el.rect.width,
                  height: el.rect.height,
                  border: "1.5px solid #6b9eff",
                  backgroundColor: "rgba(107, 158, 255, 0.06)",
                  borderRadius: 4,
                  pointerEvents: "none",
                  boxSizing: "border-box",
                }}
              />
              {!isAnnotating && (
                <div
                  style={{
                    position: "absolute",
                    left: px,
                    top: py - 26,
                    background: "#6b9eff",
                    color: "#fff",
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontSize: 10,
                    fontFamily: "monospace",
                    whiteSpace: "nowrap",
                    pointerEvents: "none",
                    display: "flex",
                    gap: 6,
                    alignItems: "center",
                    maxWidth: 400,
                    overflow: "hidden",
                  }}
                >
                  <span style={{ fontWeight: 700 }}>
                    {el.elementName}
                  </span>
                  {el.sourceLocation && (
                    <span style={{ opacity: 0.7, fontSize: 9 }}>
                      {el.sourceLocation}
                    </span>
                  )}
                </div>
              )}
            </React.Fragment>
          );
        })}

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
            elementRect={activeDrawing ? { ...activeDrawing.bounds, x: activeDrawing.bounds.x + drawingScroll.x, y: activeDrawing.bounds.y + drawingScroll.y } : selectedElements[0]?.rect}
          />
        )}
        {visibleChanges.map((change, idx) => {
          if (change.isFixedPosition) return null; // rendered in fixed layer
          const pos = change.pagePosition;
          if (!pos) return null;
          const scrollOff = change.drawingScrollOffset ?? { x: 0, y: 0 };
          const badgeRect = change.drawing
            ? { x: change.drawing.bounds.x + scrollOff.x, y: change.drawing.bounds.y + scrollOff.y, width: change.drawing.bounds.width, height: change.drawing.bounds.height }
            : change.elements[0]?.rect;

          return (
            <React.Fragment key={change.id}>
              {change.drawing && (
                <svg
                  style={{
                    position: "absolute",
                    left: scrollOff.x,
                    top: scrollOff.y,
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
                elementRect={badgeRect}
              />
            </React.Fragment>
          );
        })}

        {/* Critique finding badges (severity-colored), anchored to elements */}
        {visibleFindings.map((finding) => {
          if (finding.isFixedPosition) return null; // rendered in fixed layer
          const pos = finding.pagePosition;
          if (!pos) return null;
          return (
            <InteractiveBadge
              key={finding.id}
              number="!"
              x={pos.x}
              y={pos.y}
              color={SEVERITY_COLORS[finding.severity] ?? "#2563eb"}
              onEdit={() => setSelectedFindingId(finding.id)}
              isEditing={selectedFindingId === finding.id}
              elementRect={finding.element.rect}
            />
          );
        })}

        {/* Critique finding detail card */}
        {selectedFindingId && (() => {
          const finding = visibleFindings.find((f) => f.id === selectedFindingId);
          if (!finding || !finding.pagePosition) return null;
          const pos = finding.isFixedPosition
            ? { x: finding.pagePosition.x + getScrollOffset().x, y: finding.pagePosition.y + getScrollOffset().y }
            : finding.pagePosition;
          return (
            <FindingCard
              finding={finding}
              x={pos.x}
              y={pos.y}
              onApply={() => handleApplyFinding(finding.id)}
              onDismiss={() => handleDismissFinding(finding.id)}
              onClose={() => setSelectedFindingId(null)}
            />
          );
        })()}
      </>,
      markersLayer,
    )}
    {visible && fixedMarkersLayer && createPortal(
      <>
        {visibleChanges.map((change, idx) => {
          if (!change.isFixedPosition) return null; // rendered in absolute layer
          const pos = change.pagePosition;
          if (!pos) return null;
          const fixedBadgeRect = change.drawing
            ? change.drawing.bounds
            : change.elements[0]?.rect;

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
                elementRect={fixedBadgeRect}
              />
            </React.Fragment>
          );
        })}

        {/* Critique finding badges for fixed/sticky elements */}
        {visibleFindings.map((finding) => {
          if (!finding.isFixedPosition) return null; // rendered in absolute layer
          const pos = finding.pagePosition;
          if (!pos) return null;
          return (
            <InteractiveBadge
              key={finding.id}
              number="!"
              x={pos.x}
              y={pos.y}
              color={SEVERITY_COLORS[finding.severity] ?? "#2563eb"}
              onEdit={() => setSelectedFindingId(finding.id)}
              isEditing={selectedFindingId === finding.id}
              elementRect={finding.element.rect}
            />
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
 * Compute border-radius so the pointy corner faces toward the element center.
 */
function badgeCornerRadius(
  badgeX: number,
  badgeY: number,
  elementRect?: { x: number; y: number; width: number; height: number },
): string {
  if (!elementRect) return "50% 50% 2px 50%";
  const cx = elementRect.x + elementRect.width / 2;
  const cy = elementRect.y + elementRect.height / 2;
  const left = badgeX <= cx;
  const above = badgeY <= cy;
  // Pointy corner faces toward element center (opposite side from badge position)
  if (left && above) return "50% 50% 2px 50%";   // bottom-right pointy
  if (!left && above) return "50% 50% 50% 2px";   // bottom-left pointy
  if (!left && !above) return "2px 50% 50% 50%";  // top-left pointy
  return "50% 2px 50% 50%";                        // top-right pointy
}

/**
 * Animated number badge that pops in at a specific position.
 */
function AnimatedBadge({
  number,
  x,
  y,
  color,
  elementRect,
}: {
  number: number;
  x: number;
  y: number;
  color: string;
  elementRect?: { x: number; y: number; width: number; height: number };
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
        borderRadius: badgeCornerRadius(x, y, elementRect),
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
 * Detail card for a critique finding. Anchored near the finding's badge,
 * shows the cited principle, measured-vs-target rationale and recommendation,
 * with Apply (→ queued change) and Dismiss actions.
 */
function FindingCard({
  finding,
  x,
  y,
  onApply,
  onDismiss,
  onClose,
}: {
  finding: CritiqueFinding;
  x: number;
  y: number;
  onApply: () => void;
  onDismiss: () => void;
  onClose: () => void;
}) {
  const color = SEVERITY_COLORS[finding.severity] ?? "#2563eb";
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: x + 14,
        top: y - 10,
        width: 300,
        maxWidth: "90vw",
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        boxShadow: "0 8px 28px rgba(0,0,0,0.16)",
        padding: 14,
        pointerEvents: "auto",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "#111827",
        zIndex: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span
          style={{
            background: color,
            color: "#fff",
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            padding: "2px 6px",
            borderRadius: 4,
            letterSpacing: 0.4,
          }}
        >
          {finding.severity}
        </span>
        <span style={{ fontSize: 11, color: "#6b7280" }}>{finding.category}</span>
        <button
          onClick={onClose}
          style={{
            marginLeft: "auto",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            color: "#9ca3af",
          }}
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{finding.principleTitle}</div>
      <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.5, marginBottom: 8 }}>
        {finding.rationale}
      </div>
      {(finding.measured || finding.target) && (
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8, fontFamily: "monospace" }}>
          {finding.measured ?? "?"} → {finding.target ?? "?"}
        </div>
      )}
      <div
        style={{
          fontSize: 12,
          color: "#111827",
          background: "#f9fafb",
          border: "1px solid #f3f4f6",
          borderRadius: 6,
          padding: "6px 8px",
          marginBottom: 10,
          lineHeight: 1.5,
        }}
      >
        {finding.recommendation}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onApply}
          style={{
            flex: 1,
            border: "none",
            background: "#111827",
            color: "#fff",
            borderRadius: 6,
            padding: "7px 0",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Apply
        </button>
        <button
          onClick={onDismiss}
          style={{
            flex: 1,
            border: "1px solid #e5e7eb",
            background: "#fff",
            color: "#374151",
            borderRadius: 6,
            padding: "7px 0",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Dismiss
        </button>
      </div>
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
  elementRect,
}: {
  number: number | string;
  x: number;
  y: number;
  color: string;
  onEdit: () => void;
  isEditing?: boolean;
  elementRect?: { x: number; y: number; width: number; height: number };
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
        borderRadius: badgeCornerRadius(x, y, elementRect),
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
