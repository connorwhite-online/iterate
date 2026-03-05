import React, { useCallback, useEffect, useState } from "react";
import type { Rect } from "iterate-ui-core";
import { generateSelector, getRelevantStyles, getComponentInfo } from "../inspector/selector.js";
import { TrashIcon } from "../panel/icons.js";

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
  /** For flex/grid reordering: the target sibling index */
  reorderIndex?: number;
  /** The parent selector for reorder context */
  parentSelector?: string;
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
 * 1. Flex/grid children: Detects drop position among siblings for DOM reordering
 *    (like dragging frames in Figma auto-layout). Shows a drop indicator line
 *    between siblings during the drag.
 *
 * 2. All other elements: Records a positional move intent. Element stays in place,
 *    a dotted border shows current position, and an arrow points to where it was
 *    dragged.
 *
 * In both cases the element itself is never visually moved — only annotation
 * overlays are rendered to communicate the intent.
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
    if (!display.includes("flex") && !display.includes("grid")) return null;

    const isRow = display.includes("grid") ||
      parentStyle.flexDirection === "row" ||
      parentStyle.flexDirection === "row-reverse" ||
      parentStyle.flexDirection === "";

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
      if (target.closest?.("#__iterate-markers-layer__, #__iterate-fixed-markers-layer__, [data-iterate-popup]")) return;

      e.preventDefault();
      e.stopPropagation();

      const rect = target.getBoundingClientRect();

      // Check if the element is a flex/grid child for reorder mode
      const parentEl = target.parentElement;
      const parentDisplay = parentEl ? window.getComputedStyle(parentEl).display : "";
      const canReorder = parentDisplay.includes("flex") || parentDisplay.includes("grid");

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
      setCurrentMouse({ x: e.clientX, y: e.clientY });

      // Update drop indicator for flex/grid reordering
      if (isReorderDrag && dragElement.parentElement) {
        const drop = getDropPosition(dragElement.parentElement, dragElement, e.clientX, e.clientY);
        if (drop) {
          setDropIndicator(drop.indicator);
        } else {
          setDropIndicator(null);
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!dragging || !dragElement || !originalRect || !dragStart) {
        setDragging(false);
        return;
      }

      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;

      // Skip negligible moves
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
        setDragging(false);
        setDragElement(null);
        setDragStart(null);
        setCurrentMouse(null);
        setOriginalRect(null);
        setDropIndicator(null);
        return;
      }

      const newRect: Rect = {
        x: originalRect.x + dx,
        y: originalRect.y + dy,
        width: originalRect.width,
        height: originalRect.height,
      };

      const { component, source } = getComponentInfo(dragElement);

      const pendingMove: PendingMove = {
        selector: generateSelector(dragElement),
        from: originalRect,
        to: newRect,
        computedStyles: getRelevantStyles(dragElement),
        componentName: component,
        sourceLocation: source,
        scrollOffset: { x: 0, y: 0 },
      };

      // For flex/grid children, determine reorder index
      if (isReorderDrag && dragElement.parentElement) {
        const drop = getDropPosition(dragElement.parentElement, dragElement, e.clientX, e.clientY);
        if (drop) {
          pendingMove.reorderIndex = drop.index;
          pendingMove.parentSelector = generateSelector(dragElement.parentElement);
        }
      }

      onMove(pendingMove);

      setDragging(false);
      setDragElement(null);
      setDragStart(null);
      setCurrentMouse(null);
      setOriginalRect(null);
      setDropIndicator(null);
    };

    targetDoc.addEventListener("mousedown", handleMouseDown, { capture: true });
    targetDoc.addEventListener("mousemove", handleMouseMove);
    targetDoc.addEventListener("mouseup", handleMouseUp);

    return () => {
      targetDoc.removeEventListener("mousedown", handleMouseDown, { capture: true });
      targetDoc.removeEventListener("mousemove", handleMouseMove);
      targetDoc.removeEventListener("mouseup", handleMouseUp);
    };
  }, [active, dragging, dragStart, dragElement, originalRect, isReorderDrag, getTargetDocument, onMove, getDropPosition]);

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {/* Active drag — dotted border around element + arrow to cursor */}
      {dragging && originalRect && currentMouse && dragStart && (
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

          {/* Drop indicator line for flex/grid reordering */}
          {dropIndicator && (
            <div
              style={{
                position: "absolute",
                left: dropIndicator.x - (dropIndicator.isVertical ? 1 : 0),
                top: dropIndicator.y - (dropIndicator.isVertical ? 0 : 1),
                width: dropIndicator.width,
                height: dropIndicator.height,
                background: "#2563eb",
                borderRadius: 1,
                pointerEvents: "none",
                boxShadow: "0 0 4px rgba(37, 99, 235, 0.5)",
              }}
            />
          )}
        </>
      )}

      {/* Persistent markers for all pending moves.
           data-move-idx lets the scroll handler in IterateOverlay apply CSS translate directly. */}
      {pendingMoves.map((move, idx) => (
        <div key={`move-${idx}`} data-move-idx={idx}>
          {/* Dotted border at element's current position */}
          <div
            style={{
              position: "absolute",
              left: move.from.x,
              top: move.from.y,
              width: move.from.width,
              height: move.from.height,
              border: "2px dashed rgba(37, 99, 235, 0.5)",
              borderRadius: 4,
              pointerEvents: "none",
            }}
          />

          {/* Arrow from original to target position */}
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
              x1={move.from.x + move.from.width / 2}
              y1={move.from.y + move.from.height / 2}
              x2={move.to.x + move.to.width / 2}
              y2={move.to.y + move.to.height / 2}
              stroke="rgba(37, 99, 235, 0.4)"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              markerEnd={`url(#arrowhead-${idx})`}
            />
          </svg>

          {/* Reorder badge or move badge */}
          <div
            onClick={(e) => {
              e.stopPropagation();
              setEditingMoveIdx(editingMoveIdx === idx ? -1 : idx);
            }}
            style={{
              position: "absolute",
              left: move.from.x + move.from.width - 8,
              top: move.from.y - 8,
              width: 18,
              height: 18,
              borderRadius: "50%",
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
              boxShadow: editingMoveIdx === idx ? "0 0 0 3px #2563eb44" : "none",
            }}
          >
            {idx + 1}
          </div>

          {/* Minimal popup for move badge */}
          {editingMoveIdx === idx && (
            <MovePopup
              x={move.from.x + move.from.width + 12}
              y={move.from.y - 8}
              onDelete={() => {
                onDeleteMove?.(idx);
                setEditingMoveIdx(-1);
              }}
              onClose={() => setEditingMoveIdx(-1)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/** Minimal popup for move badges — shows "Move" label with delete and cancel buttons. */
function MovePopup({
  x,
  y,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  onDelete: () => void;
  onClose: () => void;
}) {
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

  // Clamp position to viewport
  const popupWidth = 180;
  const margin = 16;
  let left = x;
  if (left + popupWidth + margin > window.innerWidth) {
    left = x - popupWidth - 30; // flip left of badge
  }
  left = Math.max(margin, left);
  const top = Math.max(margin, Math.min(y, window.innerHeight - 80));

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
          borderRadius: 10,
          overflow: "hidden",
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          fontFamily: FONT_STACK,
          background: "#fff",
          border: "1px solid #e0e0e0",
          padding: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <MoveTrashButton onClick={(e) => { e.stopPropagation(); onDelete(); }} />
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: "#333",
          }}
        >
          Move
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          style={{
            padding: "5px 12px",
            background: "transparent",
            border: "1px solid #e0e0e0",
            borderRadius: 6,
            color: "#888",
            cursor: "pointer",
            fontSize: 12,
            fontFamily: FONT_STACK,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Square trash button with red icon and rounded hover background */
function MoveTrashButton({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  const [hovered, setHovered] = React.useState(false);
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
        background: hovered ? "#fef2f2" : "transparent",
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
