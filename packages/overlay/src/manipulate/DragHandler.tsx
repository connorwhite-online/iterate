import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Rect } from "iterate-ui-core";
import { generateSelector, getRelevantStyles, getComponentInfo } from "../inspector/selector.js";
import { TrashIcon } from "../panel/icons.js";
import { useTheme } from "../theme.js";

/** A completed move with rollback info for live preview */
export interface PendingMove {
  iteration?: string;
  /** Page URL where this move was made */
  url?: string;
  selector: string;
  from: Rect;
  to: Rect;
  computedStyles: Record<string, string>;
  componentName: string | null;
  sourceLocation: string | null;
  /** Whether the element is the root of its React component (vs a child inside it) */
  isComponentRoot?: boolean;
  /** For flex/grid reordering: the target sibling index */
  reorderIndex?: number;
  /** For flex/grid reordering: the original sibling index before drag */
  originalSiblingIndex?: number;
  /** The original parent selector for reorder context */
  parentSelector?: string;
  /** The destination parent selector (for cross-parent reparenting) */
  targetParentSelector?: string;
  /** Window scroll offset when this move was created (for scroll-aware rendering) */
  scrollOffset?: { x: number; y: number };
}

interface DragHandlerProps {
  active: boolean;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** Called when a drag completes with full move data */
  onMove: (move: PendingMove) => void;
  /** Pending moves to visualize origin markers for */
  pendingMoves: PendingMove[];
  /** Whether to show the live preview (transforms applied) vs original positions */
  previewMode: boolean;
  /** Called when user deletes a pending move via its badge popup */
  onDeleteMove?: (index: number) => void;
  /** @deprecated No longer used — deltas applied via direct DOM mutation in IterateOverlay */
  moveDeltas?: Record<number, { dx: number; dy: number }>;
}

/**
 * Drag-to-move handler with two behaviors:
 *
 * 1. Flex/grid children: Live DOM reordering — the element physically moves
 *    among its siblings as the user drags. A drop indicator line shows the
 *    target gap. On mouseup the reorder is recorded as a dom-change.
 *
 * 2. All other elements: Records a positional move intent. Element stays in place,
 *    a dotted border shows current position, and an arrow points to where it was
 *    dragged.
 */
export function DragHandler({
  active,
  iframeRef,
  onMove,
  pendingMoves,
  previewMode,
  onDeleteMove,
  moveDeltas = {},
}: DragHandlerProps) {
  // Index of the move badge whose popup is open (-1 = none)
  const [editingMoveIdx, setEditingMoveIdx] = useState(-1);
  const [dragging, setDragging] = useState(false);
  const [dragElement, setDragElement] = useState<Element | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [currentMouse, setCurrentMouse] = useState<{ x: number; y: number } | null>(null);
  const [originalRect, setOriginalRect] = useState<Rect | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ x: number; y: number; width: number; height: number; isVertical: boolean } | null>(null);
  const [isReorderDrag, setIsReorderDrag] = useState(false);
  // Cross-parent reparenting: track the drop target container and its rect for highlighting
  const [dropTarget, setDropTarget] = useState<{ element: Element; rect: Rect } | null>(null);
  const originalParentRef = useRef<Element | null>(null);

  // Refs for reorder tracking (avoid stale closures in event handlers)
  const originalSiblingIndexRef = useRef<number | null>(null);
  const lastAppliedIndexRef = useRef<number | null>(null);
  const dragComponentInfoRef = useRef<{ component: string | null; source: string | null; isComponentRoot: boolean }>({ component: null, source: null, isComponentRoot: false });
  const dragSelectorRef = useRef<string>("");
  // Ghost preview: offset from cursor to element top-left, and ref to the original element for opacity restore
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const draggedElRef = useRef<HTMLElement | null>(null);
  // Auto-scroll: track current mouse position via ref (avoids stale closures in rAF)
  const currentMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const autoScrollRafRef = useRef<number>(0);

  const getTargetDocument = useCallback(() => {
    try {
      return iframeRef.current?.contentDocument ?? document;
    } catch {
      return document;
    }
  }, [iframeRef]);

  /**
   * For flex/grid containers, determine the drop index based on cursor position
   * among the container's children. Returns the sibling index and a visual
   * indicator rect for the drop line.
   */
  const getDropPosition = useCallback((
    parent: Element,
    draggedEl: Element,
    mouseX: number,
    mouseY: number,
  ): { index: number; indicator: { x: number; y: number; width: number; height: number; isVertical: boolean } } | null => {
    const parentStyle = window.getComputedStyle(parent);
    const display = parentStyle.display;
    const isFlexOrGrid = display.includes("flex") || display.includes("grid");
    const isBlock = display === "block" || display === "flow-root" || display === "list-item";
    if (!isFlexOrGrid && !isBlock) return null;

    // Block containers always stack vertically; flex/grid depends on direction
    const isRow = isFlexOrGrid && (
      display.includes("grid") ||
      parentStyle.flexDirection === "row" ||
      parentStyle.flexDirection === "row-reverse" ||
      parentStyle.flexDirection === ""
    );

    const children = Array.from(parent.children).filter(
      (c) => c !== draggedEl && c.getBoundingClientRect().width > 0 && c.getBoundingClientRect().height > 0
    );

    if (children.length === 0) return { index: 0, indicator: { x: 0, y: 0, width: 0, height: 0, isVertical: isRow } };

    // Find which gap the cursor is closest to
    for (let i = 0; i <= children.length; i++) {
      const prevRect = i > 0 ? children[i - 1]!.getBoundingClientRect() : null;
      const nextRect = i < children.length ? children[i]!.getBoundingClientRect() : null;

      if (isRow) {
        const gapX = prevRect
          ? nextRect
            ? (prevRect.right + nextRect.left) / 2
            : prevRect.right + 4
          : nextRect
            ? nextRect.left - 4
            : 0;

        if (
          (i === 0 && mouseX < (nextRect ? nextRect.left + nextRect.width / 2 : Infinity)) ||
          (i === children.length && mouseX >= (prevRect ? prevRect.left + prevRect.width / 2 : 0)) ||
          (prevRect && nextRect && mouseX >= prevRect.left + prevRect.width / 2 && mouseX < nextRect.left + nextRect.width / 2)
        ) {
          const parentRect = parent.getBoundingClientRect();
          return {
            index: i,
            indicator: {
              x: gapX,
              y: parentRect.top + 4,
              width: 2,
              height: parentRect.height - 8,
              isVertical: true,
            },
          };
        }
      } else {
        const gapY = prevRect
          ? nextRect
            ? (prevRect.bottom + nextRect.top) / 2
            : prevRect.bottom + 4
          : nextRect
            ? nextRect.top - 4
            : 0;

        if (
          (i === 0 && mouseY < (nextRect ? nextRect.top + nextRect.height / 2 : Infinity)) ||
          (i === children.length && mouseY >= (prevRect ? prevRect.top + prevRect.height / 2 : 0)) ||
          (prevRect && nextRect && mouseY >= prevRect.top + prevRect.height / 2 && mouseY < nextRect.top + nextRect.height / 2)
        ) {
          const parentRect = parent.getBoundingClientRect();
          return {
            index: i,
            indicator: {
              x: parentRect.left + 4,
              y: gapY,
              width: parentRect.width - 8,
              height: 2,
              isVertical: false,
            },
          };
        }
      }
    }

    return null;
  }, []);

  /**
   * Find a flex/grid container under the cursor that could accept the dragged element.
   * Used for cross-parent reparenting — returns null if only the current parent is found.
   */
  const findDropTarget = useCallback((
    mouseX: number,
    mouseY: number,
    draggedEl: Element,
    currentParent: Element | null,
  ): Element | null => {
    const doc = getTargetDocument();
    const elements = doc.elementsFromPoint(mouseX, mouseY);

    for (const el of elements) {
      // Skip the dragged element itself and its descendants
      if (el === draggedEl || draggedEl.contains(el)) continue;
      // Skip body/html — too broad to be meaningful reparent targets
      const tag = el.tagName?.toLowerCase();
      if (tag === "body" || tag === "html") continue;
      // Skip the current parent itself (caller gates on cursor-outside-parent)
      if (currentParent && el === currentParent) continue;
      // Skip iterate overlay elements
      if (el.closest?.("#__iterate-markers-layer__, #__iterate-fixed-markers-layer__, [data-iterate-popup], [data-iterate-panel]")) continue;

      const display = window.getComputedStyle(el).display;
      if (display.includes("flex") || display.includes("grid") || display === "block" || display === "flow-root" || display === "list-item") {
        const r = el.getBoundingClientRect();
        if (mouseX >= r.left && mouseX <= r.right && mouseY >= r.top && mouseY <= r.bottom) {
          return el;
        }
      }
    }
    return null;
  }, [getTargetDocument]);

  /** Revert a reorder drag to its original position */
  const revertReorderDrag = useCallback((el: Element, originalIdx: number) => {
    const parent = el.parentElement;
    if (!parent) return;
    const children = Array.from(parent.children).filter((c) => c !== el);
    const refChild = children[originalIdx] ?? null;
    parent.insertBefore(el, refChild);
    (el as HTMLElement).style.opacity = "";
    (el as HTMLElement).style.transition = "";
  }, []);

  // Set cursor to "move" on the target document when the move tool is active
  useEffect(() => {
    if (!active) return;
    const doc = getTargetDocument();
    const style = doc.createElement("style");
    style.textContent = "* { cursor: move !important; }";
    doc.head.appendChild(style);
    return () => { style.remove(); };
  }, [active, getTargetDocument]);

  useEffect(() => {
    if (!active) {
      setDragging(false);
      setDragElement(null);
      setDropIndicator(null);
      return;
    }

    const targetDoc = getTargetDocument();

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target) return;

      // Skip non-visual/structural elements
      const tag = target.tagName.toLowerCase();
      if (["html", "body", "head", "script", "style"].includes(tag)) return;

      // Skip clicks on iterate overlay elements (badges, popups, markers layers)
      if (target.closest?.("#__iterate-markers-layer__, #__iterate-fixed-markers-layer__, [data-iterate-popup], [data-iterate-panel]")) return;

      e.preventDefault();
      e.stopPropagation();

      const rect = target.getBoundingClientRect();

      // Check if the element is a flex/grid child for reorder mode
      // Absolute/fixed/sticky elements always use arrow mode (coordinate-based, not flow-based)
      const parentEl = target.parentElement;
      const parentDisplay = parentEl ? window.getComputedStyle(parentEl).display : "";
      const elPosition = window.getComputedStyle(target).position;
      const isOutOfFlow = elPosition === "absolute" || elPosition === "fixed" || elPosition === "sticky";
      const isFlexOrGrid = parentDisplay.includes("flex") || parentDisplay.includes("grid");
      const isBlock = parentDisplay === "block" || parentDisplay === "flow-root" || parentDisplay === "list-item";
      const canReorder = !isOutOfFlow && (isFlexOrGrid || isBlock);

      // Capture original sibling index for reorder tracking
      if (canReorder && parentEl) {
        const siblings = Array.from(parentEl.children);
        const idx = siblings.indexOf(target);
        originalSiblingIndexRef.current = idx;
        lastAppliedIndexRef.current = idx;
      } else {
        originalSiblingIndexRef.current = null;
        lastAppliedIndexRef.current = null;
      }

      // Capture component info and selector now before the element potentially moves in the DOM
      // (selector uses nth-child which changes after reorder)
      dragComponentInfoRef.current = getComponentInfo(target);
      dragSelectorRef.current = generateSelector(target);

      // For reorder drags: capture cursor offset from element corner and dim the original
      if (canReorder) {
        dragOffsetRef.current = { x: e.clientX - rect.x, y: e.clientY - rect.y };
        draggedElRef.current = target as HTMLElement;
        originalParentRef.current = parentEl;
        (target as HTMLElement).style.opacity = "0.3";
      } else {
        dragOffsetRef.current = { x: 0, y: 0 };
        draggedElRef.current = null;
        originalParentRef.current = null;
      }

      setDragElement(target);
      setDragStart({ x: e.clientX, y: e.clientY });
      setCurrentMouse({ x: e.clientX, y: e.clientY });
      setOriginalRect({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
      setIsReorderDrag(canReorder);
      setDragging(true);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging || !dragStart || !dragElement) return;
      currentMouseRef.current = { x: e.clientX, y: e.clientY };
      setCurrentMouse({ x: e.clientX, y: e.clientY });

      // Update drop indicator for flex/grid reordering
      if (isReorderDrag && dragElement.parentElement) {
        // Only look for cross-parent targets when cursor is outside the original parent
        const origParent = originalParentRef.current;
        let newTarget: Element | null = null;
        if (origParent) {
          const pr = origParent.getBoundingClientRect();
          const outside = e.clientX < pr.left || e.clientX > pr.right || e.clientY < pr.top || e.clientY > pr.bottom;
          if (outside) {
            newTarget = findDropTarget(e.clientX, e.clientY, dragElement, origParent);
          }
        }
        const targetContainer = newTarget ?? dragElement.parentElement;

        if (newTarget) {
          const r = newTarget.getBoundingClientRect();
          setDropTarget({ element: newTarget, rect: { x: r.x, y: r.y, width: r.width, height: r.height } });
        } else {
          setDropTarget(null);
        }

        const drop = getDropPosition(targetContainer, dragElement, e.clientX, e.clientY);
        if (drop) {
          // Hide indicator if target position is the same as current (no movement yet)
          const isCurrentPosition = !newTarget && drop.index === originalSiblingIndexRef.current;
          setDropIndicator(isCurrentPosition ? null : drop.indicator);
          lastAppliedIndexRef.current = drop.index;
        } else {
          setDropIndicator(null);
        }
      }
    };

    /** Restore opacity on the dragged element and reset all drag state */
    const cleanupDrag = () => {
      if (draggedElRef.current) {
        draggedElRef.current.style.opacity = "";
        draggedElRef.current = null;
      }
      setDragging(false);
      setDragElement(null);
      setDragStart(null);
      setCurrentMouse(null);
      setOriginalRect(null);
      setDropIndicator(null);
      setDropTarget(null);
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!dragging || !dragElement || !originalRect || !dragStart) {
        cleanupDrag();
        return;
      }

      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;

      // For reorder drags: handle same-parent reorder or cross-parent reparent
      if (isReorderDrag) {
        // Only detect reparent target when cursor is outside the original parent
        const origParent = originalParentRef.current;
        let reparentTarget: Element | null = null;
        if (origParent) {
          const pr = origParent.getBoundingClientRect();
          const outside = e.clientX < pr.left || e.clientX > pr.right || e.clientY < pr.top || e.clientY > pr.bottom;
          if (outside) {
            reparentTarget = findDropTarget(e.clientX, e.clientY, dragElement, origParent);
          }
        }
        const isCrossParent = !!reparentTarget;

        // For same-parent: check if the element actually moved
        if (!isCrossParent && (lastAppliedIndexRef.current === null || lastAppliedIndexRef.current === originalSiblingIndexRef.current)) {
          cleanupDrag();
          return;
        }

        const origParentSelector = originalParentRef.current ? generateSelector(originalParentRef.current) : undefined;

        if (isCrossParent && reparentTarget) {
          // Cross-parent reparent: move element into the new container
          const drop = getDropPosition(reparentTarget, dragElement, e.clientX, e.clientY);
          const insertIdx = drop?.index ?? reparentTarget.children.length;
          const children = Array.from(reparentTarget.children);
          const refChild = children[insertIdx] ?? null;
          reparentTarget.insertBefore(dragElement, refChild);

          const finalRect = dragElement.getBoundingClientRect();
          const { component, source, isComponentRoot } = dragComponentInfoRef.current;

          const pendingMove: PendingMove = {
            selector: dragSelectorRef.current,
            from: { x: finalRect.x, y: finalRect.y, width: finalRect.width, height: finalRect.height },
            to: { x: finalRect.x, y: finalRect.y, width: finalRect.width, height: finalRect.height },
            computedStyles: getRelevantStyles(dragElement),
            componentName: component,
            sourceLocation: source,
            isComponentRoot,
            reorderIndex: insertIdx,
            originalSiblingIndex: originalSiblingIndexRef.current!,
            parentSelector: origParentSelector,
            targetParentSelector: generateSelector(reparentTarget),
            scrollOffset: { x: 0, y: 0 },
          };

          onMove(pendingMove);
        } else {
          // Same-parent reorder: move element among siblings
          const parent = dragElement.parentElement;
          if (parent) {
            const children = Array.from(parent.children).filter((c) => c !== dragElement);
            const refChild = children[lastAppliedIndexRef.current!] ?? null;
            parent.insertBefore(dragElement, refChild);
          }

          const finalRect = dragElement.getBoundingClientRect();
          const { component, source, isComponentRoot } = dragComponentInfoRef.current;

          const pendingMove: PendingMove = {
            selector: dragSelectorRef.current,
            from: { x: finalRect.x, y: finalRect.y, width: finalRect.width, height: finalRect.height },
            to: { x: finalRect.x, y: finalRect.y, width: finalRect.width, height: finalRect.height },
            computedStyles: getRelevantStyles(dragElement),
            componentName: component,
            sourceLocation: source,
            isComponentRoot,
            reorderIndex: lastAppliedIndexRef.current!,
            originalSiblingIndex: originalSiblingIndexRef.current!,
            parentSelector: origParentSelector,
            scrollOffset: { x: 0, y: 0 },
          };

          onMove(pendingMove);
        }

        cleanupDrag();
        return;
      }

      // Non-reorder (positional) moves — skip negligible drags
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
        cleanupDrag();
        return;
      }

      const newRect: Rect = {
        x: originalRect.x + dx,
        y: originalRect.y + dy,
        width: originalRect.width,
        height: originalRect.height,
      };

      const { component, source, isComponentRoot } = dragComponentInfoRef.current;

      const pendingMove: PendingMove = {
        selector: generateSelector(dragElement),
        from: originalRect,
        to: newRect,
        computedStyles: getRelevantStyles(dragElement),
        componentName: component,
        sourceLocation: source,
        isComponentRoot,
        scrollOffset: { x: 0, y: 0 },
      };

      onMove(pendingMove);
      cleanupDrag();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dragging) {
        cleanupDrag();
      }
    };

    targetDoc.addEventListener("mousedown", handleMouseDown, { capture: true });
    targetDoc.addEventListener("mousemove", handleMouseMove);
    targetDoc.addEventListener("mouseup", handleMouseUp);
    targetDoc.addEventListener("keydown", handleKeyDown);

    return () => {
      targetDoc.removeEventListener("mousedown", handleMouseDown, { capture: true });
      targetDoc.removeEventListener("mousemove", handleMouseMove);
      targetDoc.removeEventListener("mouseup", handleMouseUp);
      targetDoc.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, dragging, dragStart, dragElement, originalRect, isReorderDrag, getTargetDocument, onMove, getDropPosition, findDropTarget, revertReorderDrag]);

  // Auto-scroll when cursor is near viewport edges during drag
  useEffect(() => {
    if (!dragging) return;

    const EDGE = 60;
    const MAX_SPEED = 15;

    const tick = () => {
      const mouse = currentMouseRef.current;
      let scrollEl: Element | null = null;
      try {
        const doc = iframeRef.current?.contentDocument;
        scrollEl = doc?.scrollingElement ?? doc?.documentElement ?? null;
      } catch { /* cross-origin */ }
      if (!scrollEl) scrollEl = document.scrollingElement ?? document.documentElement;

      let dx = 0, dy = 0;
      if (mouse.y < EDGE) dy = -MAX_SPEED * (1 - mouse.y / EDGE);
      else if (mouse.y > window.innerHeight - EDGE) dy = MAX_SPEED * (1 - (window.innerHeight - mouse.y) / EDGE);
      if (mouse.x < EDGE) dx = -MAX_SPEED * (1 - mouse.x / EDGE);
      else if (mouse.x > window.innerWidth - EDGE) dx = MAX_SPEED * (1 - (window.innerWidth - mouse.x) / EDGE);

      if (dx || dy) scrollEl.scrollBy(dx, dy);
      autoScrollRafRef.current = requestAnimationFrame(tick);
    };

    autoScrollRafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(autoScrollRafRef.current);
  }, [dragging, iframeRef]);

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {/* Active drag visuals */}
      {dragging && originalRect && currentMouse && dragStart && (
        <>
          {/* For non-reorder drags: dotted border, arrow, ghost */}
          {!isReorderDrag && (
            <>
              {/* Dotted border around element's current position */}
              <div
                style={{
                  position: "absolute",
                  left: originalRect.x,
                  top: originalRect.y,
                  width: originalRect.width,
                  height: originalRect.height,
                  border: "2px dashed #2563eb",
                  borderRadius: 4,
                  pointerEvents: "none",
                }}
              />

              {/* Arrow from element center to current cursor */}
              {(Math.abs(currentMouse.x - dragStart.x) > 10 || Math.abs(currentMouse.y - dragStart.y) > 10) && (
                <svg
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: "100%",
                    height: "100%",
                    pointerEvents: "none",
                    overflow: "visible",
                  }}
                >
                  <defs>
                    <marker
                      id="drag-arrowhead"
                      markerWidth="8"
                      markerHeight="6"
                      refX="8"
                      refY="3"
                      orient="auto"
                    >
                      <polygon
                        points="0 0, 8 3, 0 6"
                        fill="rgba(37, 99, 235, 0.7)"
                      />
                    </marker>
                  </defs>
                  <line
                    x1={originalRect.x + originalRect.width / 2}
                    y1={originalRect.y + originalRect.height / 2}
                    x2={currentMouse.x}
                    y2={currentMouse.y}
                    stroke="rgba(37, 99, 235, 0.5)"
                    strokeWidth="2"
                    strokeDasharray="6 4"
                    markerEnd="url(#drag-arrowhead)"
                  />
                </svg>
              )}

              {/* Ghost outline at cursor position */}
              <div
                style={{
                  position: "absolute",
                  left: originalRect.x + (currentMouse.x - dragStart.x),
                  top: originalRect.y + (currentMouse.y - dragStart.y),
                  width: originalRect.width,
                  height: originalRect.height,
                  border: "2px dashed rgba(37, 99, 235, 0.4)",
                  backgroundColor: "rgba(37, 99, 235, 0.06)",
                  borderRadius: 4,
                  pointerEvents: "none",
                }}
              />
            </>
          )}

          {/* Reorder drag: placeholder outline at original position + ghost following cursor */}
          {isReorderDrag && (
            <>
              {/* Placeholder outline where the element was */}
              <div
                style={{
                  position: "fixed",
                  left: originalRect.x - 1,
                  top: originalRect.y - 1,
                  width: originalRect.width + 2,
                  height: originalRect.height + 2,
                  border: "2px dashed rgba(37, 99, 235, 0.35)",
                  borderRadius: 4,
                  background: "rgba(37, 99, 235, 0.03)",
                  pointerEvents: "none",
                }}
              />
              {/* Ghost preview following cursor */}
              <div
                style={{
                  position: "fixed",
                  left: currentMouse.x - dragOffsetRef.current.x,
                  top: currentMouse.y - dragOffsetRef.current.y,
                  width: originalRect.width,
                  height: originalRect.height,
                  opacity: 0.7,
                  borderRadius: 4,
                  border: "1.5px solid #2563eb",
                  background: "rgba(37, 99, 235, 0.06)",
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
                  pointerEvents: "none",
                  zIndex: 99999,
                }}
              />
            </>
          )}

          {/* Drop indicator line for flex/grid/block reordering */}
          {dropIndicator && (
            <div
              style={{
                position: "absolute",
                left: dropIndicator.x - (dropIndicator.isVertical ? 1 : 0),
                top: dropIndicator.y - (dropIndicator.isVertical ? 0 : 1),
                width: dropIndicator.isVertical ? 2 : dropIndicator.width,
                height: dropIndicator.isVertical ? dropIndicator.height : 2,
                background: "#2563eb",
                borderRadius: 2,
                pointerEvents: "none",
                boxShadow: "0 0 6px rgba(37, 99, 235, 0.4)",
              }}
            />
          )}

          {/* Drop target container highlight (cross-parent reparenting) */}
          {dropTarget && (
            <div
              style={{
                position: "fixed",
                left: dropTarget.rect.x - 2,
                top: dropTarget.rect.y - 2,
                width: dropTarget.rect.width + 4,
                height: dropTarget.rect.height + 4,
                border: "2px dashed #2563eb",
                borderRadius: 6,
                background: "rgba(37, 99, 235, 0.04)",
                pointerEvents: "none",
                transition: "all 0.15s ease",
              }}
            />
          )}
        </>
      )}

      {/* Persistent markers for all pending moves */}
      {pendingMoves.map((move, idx) => {
        const isReorder = move.reorderIndex !== undefined;
        return (
          <MoveBadge
            key={`move-${idx}`}
            move={move}
            idx={idx}
            isReorder={isReorder}
            editing={editingMoveIdx === idx}
            onToggleEdit={() => setEditingMoveIdx(editingMoveIdx === idx ? -1 : idx)}
            onDelete={() => { onDeleteMove?.(idx); setEditingMoveIdx(-1); }}
            onClose={() => setEditingMoveIdx(-1)}
            iframeRef={iframeRef}
          />
        );
      })}
    </div>
  );
}

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/** Move badge that tracks the element's live position via its selector, surviving scroll. */
function MoveBadge({
  move,
  idx,
  isReorder,
  editing,
  onToggleEdit,
  onDelete,
  onClose,
  iframeRef,
}: {
  move: PendingMove;
  idx: number;
  isReorder: boolean;
  editing: boolean;
  onToggleEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}) {
  const [rect, setRect] = useState<Rect | null>(null);

  // Query the element's live bounding rect and update on scroll/resize
  useEffect(() => {
    const doc = (() => { try { return iframeRef.current?.contentDocument ?? document; } catch { return document; } })();
    const scrollEl = (() => { try { return iframeRef.current?.contentWindow ?? window; } catch { return window; } })();

    const update = () => {
      // For reorders: use parentSelector + after.siblingIndex (stable after DOM reorder)
      let el: Element | null = null;
      if (isReorder && move.parentSelector && move.reorderIndex !== undefined) {
        const targetParentSel = move.targetParentSelector ?? move.parentSelector;
        const parent = doc.querySelector(targetParentSel);
        if (parent) el = parent.children[move.reorderIndex] ?? null;
      }
      if (!el) el = doc.querySelector(move.selector);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ x: r.x, y: r.y, width: r.width, height: r.height });
      }
    };

    update();
    scrollEl.addEventListener("scroll", update, { passive: true });
    scrollEl.addEventListener("resize", update, { passive: true });
    return () => {
      scrollEl.removeEventListener("scroll", update);
      scrollEl.removeEventListener("resize", update);
    };
  }, [iframeRef, move.selector, move.parentSelector, move.targetParentSelector, move.reorderIndex, isReorder]);

  if (!rect) return null;

  return (
    <>
      {/* For non-reorder moves: dotted border + arrow */}
      {!isReorder && (
        <>
          <div
            style={{
              position: "fixed",
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              border: "2px dashed rgba(37, 99, 235, 0.5)",
              borderRadius: 4,
              pointerEvents: "none",
            }}
          />
          <svg
            style={{
              position: "fixed",
              left: 0,
              top: 0,
              width: "100vw",
              height: "100vh",
              pointerEvents: "none",
              overflow: "visible",
            }}
          >
            <defs>
              <marker
                id={`arrowhead-${idx}`}
                markerWidth="8"
                markerHeight="6"
                refX="8"
                refY="3"
                orient="auto"
              >
                <polygon
                  points="0 0, 8 3, 0 6"
                  fill="rgba(37, 99, 235, 0.6)"
                />
              </marker>
            </defs>
            <line
              x1={rect.x + rect.width / 2}
              y1={rect.y + rect.height / 2}
              x2={move.to.x + move.to.width / 2}
              y2={move.to.y + move.to.height / 2}
              stroke="rgba(37, 99, 235, 0.4)"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              markerEnd={`url(#arrowhead-${idx})`}
            />
          </svg>
        </>
      )}

      {/* Badge */}
      <div
        onClick={(e) => { e.stopPropagation(); onToggleEdit(); }}
        style={{
          position: "fixed",
          left: rect.x + rect.width - 8,
          top: rect.y - 8,
          width: 18,
          height: 18,
          borderRadius: "50% 50% 50% 2px",
          background: "#2563eb",
          color: "#fff",
          fontSize: 10,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "auto",
          cursor: "pointer",
          fontFamily: FONT_STACK,
          boxShadow: editing ? "0 0 0 3px #2563eb44" : "none",
          zIndex: 10001,
        }}
      >
        {idx + 1}
      </div>

      {/* Move detail popup */}
      {editing && (
        <MovePopup
          x={rect.x + rect.width + 12}
          y={rect.y - 8}
          move={move}
          onDelete={onDelete}
          onClose={onClose}
        />
      )}
    </>
  );
}

/** Move detail popup — styled like the annotation panel with component name, positions, and actions. */
function MovePopup({
  x,
  y,
  move,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  move: PendingMove;
  onDelete: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [appeared, setAppeared] = useState(false);

  useEffect(() => {
    let frame2 = 0;
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => setAppeared(true));
    });
    return () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
    };
  }, []);

  const isReorder = move.reorderIndex !== undefined;
  const isCrossParent = !!(move.targetParentSelector && move.targetParentSelector !== move.parentSelector);
  const popupWidth = 240;
  const margin = 16;
  let left = x;
  if (left + popupWidth + margin > window.innerWidth) {
    left = x - popupWidth - 30;
  }
  left = Math.max(margin, left);
  const top = Math.max(margin, Math.min(y, window.innerHeight - 200));

  return (
    <div
      data-iterate-popup
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 10002,
        pointerEvents: "auto",
        width: popupWidth,
        opacity: appeared ? 1 : 0,
        transform: appeared ? "scale(1)" : "scale(0.92)",
        transition: `opacity 0.2s ease, transform 0.25s ${SPRING}`,
      }}
    >
      <div
        style={{
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          fontFamily: FONT_STACK,
          background: theme.panelBg,
          padding: 4,
        }}
      >
        {/* Header — component/element name */}
        <div
          style={{
            padding: "4px 8px",
            fontSize: 12,
            fontWeight: 500,
            color: theme.textPrimary,
          }}
        >
          {(() => {
            if (move.componentName) return `<${move.componentName}>`;
            const lastPart = move.selector.split(" ").pop() || "";
            const tag = lastPart.replace(/[:.#\[].*$/, "").toLowerCase();
            return tag ? `<${tag}>` : "Element";
          })()}
        </div>

        {/* Main card — position details + actions */}
        <div
          style={{
            background: theme.cardBg,
            border: `1px solid ${theme.border}`,
            borderRadius: 10,
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {/* Position info */}
          <div
            style={{
              fontSize: 10,
              fontFamily: "monospace",
              color: theme.textSecondary,
              lineHeight: 1.7,
              background: theme.drawerBg,
              borderRadius: 6,
              padding: "6px 8px",
            }}
          >
            {isReorder ? (
              isCrossParent ? (
                <>
                  <div><span style={{ color: theme.textTertiary }}>from:</span> {move.parentSelector?.split(" ").pop() ?? "parent"}</div>
                  <div><span style={{ color: theme.textTertiary }}>to:</span> {move.targetParentSelector?.split(" ").pop() ?? "parent"}</div>
                </>
              ) : (
                <>
                  <div><span style={{ color: theme.textTertiary }}>from:</span> index {move.originalSiblingIndex ?? "?"}</div>
                  <div><span style={{ color: theme.textTertiary }}>to:</span> index {move.reorderIndex}</div>
                </>
              )
            ) : (
              <>
                <div><span style={{ color: theme.textTertiary }}>from:</span> {Math.round(move.from.x)}, {Math.round(move.from.y)}</div>
                <div><span style={{ color: theme.textTertiary }}>to:</span> {Math.round(move.to.x)}, {Math.round(move.to.y)}</div>
              </>
            )}
          </div>

          {/* Actions — trash left, Cancel right */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <MoveTrashButton onClick={(e) => { e.stopPropagation(); onDelete(); }} />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              style={{
                padding: "6px 14px",
                background: "transparent",
                border: `1px solid ${theme.border}`,
                borderRadius: 6,
                color: theme.textSecondary,
                cursor: "pointer",
                fontSize: 12,
                fontFamily: FONT_STACK,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Square trash button with red icon and rounded hover background */
function MoveTrashButton({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  const [hovered, setHovered] = React.useState(false);
  const theme = useTheme();
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        borderRadius: 8,
        border: "none",
        background: hovered ? theme.hoverBg : "transparent",
        color: "#dc2626",
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
        transition: "background 0.1s ease",
      }}
    >
      <TrashIcon size={16} />
    </button>
  );
}
