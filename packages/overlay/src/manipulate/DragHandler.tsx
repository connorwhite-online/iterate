import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Rect } from "@iterate/core";
import { generateSelector, getRelevantStyles, getComponentInfo } from "../inspector/selector.js";

/** A completed move with rollback info for live preview */
export interface PendingMove {
  selector: string;
  from: Rect;
  to: Rect;
  computedStyles: Record<string, string>;
  componentName: string | null;
  sourceLocation: string | null;
}

/** Internal tracking for rollback */
interface AppliedMove {
  element: Element;
  originalTransform: string;
  move: PendingMove;
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
}

/**
 * Handles drag-to-move with live DOM preview.
 *
 * When an element is dragged:
 * 1. A ghost follows the cursor during the drag
 * 2. On drop, a CSS transform is applied to the actual element (live preview)
 * 3. The original position is shown as a dashed marker
 * 4. All transforms can be toggled on/off via previewMode
 * 5. Transforms are rolled back when moves are cleared
 */
export function DragHandler({
  active,
  iframeRef,
  onMove,
  pendingMoves,
  previewMode,
}: DragHandlerProps) {
  const [dragging, setDragging] = useState(false);
  const [dragElement, setDragElement] = useState<Element | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [currentOffset, setCurrentOffset] = useState({ x: 0, y: 0 });
  const [originalRect, setOriginalRect] = useState<Rect | null>(null);

  // Track all applied transforms for rollback
  const appliedMovesRef = useRef<AppliedMove[]>([]);

  const getTargetDocument = useCallback(() => {
    try {
      return iframeRef.current?.contentDocument ?? document;
    } catch {
      return document;
    }
  }, [iframeRef]);

  // Apply or revert transforms based on previewMode
  useEffect(() => {
    for (const applied of appliedMovesRef.current) {
      if (previewMode) {
        const dx = applied.move.to.x - applied.move.from.x;
        const dy = applied.move.to.y - applied.move.from.y;
        applied.element.setAttribute(
          "style",
          `${applied.originalTransform ? '' : ''}transform: translate(${dx}px, ${dy}px) !important; transition: transform 0.2s ease !important;`
        );
      } else {
        // Revert to original
        if (applied.originalTransform) {
          (applied.element as HTMLElement).style.transform = applied.originalTransform;
        } else {
          (applied.element as HTMLElement).style.removeProperty("transform");
        }
        (applied.element as HTMLElement).style.removeProperty("transition");
      }
    }
  }, [previewMode]);

  // Sync applied moves with pendingMoves (handle clears/undos)
  useEffect(() => {
    const pendingSelectors = new Set(pendingMoves.map((m) => m.selector));
    const toRemove: AppliedMove[] = [];

    for (const applied of appliedMovesRef.current) {
      if (!pendingSelectors.has(applied.move.selector)) {
        // This move was cleared — revert its transform
        if (applied.originalTransform) {
          (applied.element as HTMLElement).style.transform = applied.originalTransform;
        } else {
          (applied.element as HTMLElement).style.removeProperty("transform");
        }
        (applied.element as HTMLElement).style.removeProperty("transition");
        toRemove.push(applied);
      }
    }

    if (toRemove.length > 0) {
      appliedMovesRef.current = appliedMovesRef.current.filter(
        (a) => !toRemove.includes(a)
      );
    }
  }, [pendingMoves]);

  // Clean up all transforms on unmount
  useEffect(() => {
    return () => {
      for (const applied of appliedMovesRef.current) {
        if (applied.originalTransform) {
          (applied.element as HTMLElement).style.transform = applied.originalTransform;
        } else {
          (applied.element as HTMLElement).style.removeProperty("transform");
        }
        (applied.element as HTMLElement).style.removeProperty("transition");
      }
      appliedMovesRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!active) {
      setDragging(false);
      setDragElement(null);
      return;
    }

    const targetDoc = getTargetDocument();

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target) return;

      const computed = window.getComputedStyle(target);
      const position = computed.position;
      const parentDisplay = target.parentElement
        ? window.getComputedStyle(target.parentElement).display
        : "";

      // Allow dragging for absolute/fixed elements or flex/grid children
      const isDraggable =
        position === "absolute" ||
        position === "fixed" ||
        parentDisplay.includes("flex") ||
        parentDisplay.includes("grid");

      if (!isDraggable) return;

      e.preventDefault();
      e.stopPropagation();

      const rect = target.getBoundingClientRect();
      setDragElement(target);
      setDragStart({ x: e.clientX, y: e.clientY });
      setOriginalRect({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
      setDragging(true);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging || !dragStart) return;
      setCurrentOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
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
        setOriginalRect(null);
        setCurrentOffset({ x: 0, y: 0 });
        return;
      }

      const newRect: Rect = {
        x: originalRect.x + dx,
        y: originalRect.y + dy,
        width: originalRect.width,
        height: originalRect.height,
      };

      const { component, source } = getComponentInfo(dragElement);

      // Apply live transform to the actual element
      const htmlElement = dragElement as HTMLElement;
      const originalTransform = htmlElement.style.transform || "";

      if (previewMode) {
        htmlElement.style.setProperty("transform", `translate(${dx}px, ${dy}px)`, "important");
        htmlElement.style.setProperty("transition", "transform 0.2s ease", "important");
      }

      const pendingMove: PendingMove = {
        selector: generateSelector(dragElement),
        from: originalRect,
        to: newRect,
        computedStyles: getRelevantStyles(dragElement),
        componentName: component,
        sourceLocation: source,
      };

      // Track for rollback
      appliedMovesRef.current.push({
        element: dragElement,
        originalTransform,
        move: pendingMove,
      });

      onMove(pendingMove);

      setDragging(false);
      setDragElement(null);
      setDragStart(null);
      setOriginalRect(null);
      setCurrentOffset({ x: 0, y: 0 });
    };

    targetDoc.addEventListener("mousedown", handleMouseDown, { capture: true });
    targetDoc.addEventListener("mousemove", handleMouseMove);
    targetDoc.addEventListener("mouseup", handleMouseUp);

    return () => {
      targetDoc.removeEventListener("mousedown", handleMouseDown, { capture: true });
      targetDoc.removeEventListener("mousemove", handleMouseMove);
      targetDoc.removeEventListener("mouseup", handleMouseUp);
    };
  }, [active, dragging, dragStart, dragElement, originalRect, getTargetDocument, onMove, previewMode]);

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {/* Active drag ghost */}
      {dragging && originalRect && (
        <>
          {/* Ghost following cursor */}
          <div
            style={{
              position: "absolute",
              left: originalRect.x + currentOffset.x,
              top: originalRect.y + currentOffset.y,
              width: originalRect.width,
              height: originalRect.height,
              border: "2px dashed #2563eb",
              backgroundColor: "rgba(37, 99, 235, 0.15)",
              borderRadius: 4,
              pointerEvents: "none",
            }}
          />
          {/* Original position */}
          <div
            style={{
              position: "absolute",
              left: originalRect.x,
              top: originalRect.y,
              width: originalRect.width,
              height: originalRect.height,
              border: "1px dashed #555",
              pointerEvents: "none",
            }}
          />
        </>
      )}

      {/* Origin markers for all pending moves (show where things were) */}
      {previewMode &&
        pendingMoves.map((move, idx) => (
          <div key={`origin-${idx}`}>
            {/* Original position marker */}
            <div
              style={{
                position: "absolute",
                left: move.from.x,
                top: move.from.y,
                width: move.from.width,
                height: move.from.height,
                border: "1px dashed rgba(245, 158, 11, 0.5)",
                backgroundColor: "rgba(245, 158, 11, 0.05)",
                borderRadius: 4,
                pointerEvents: "none",
              }}
            />
            {/* Arrow from original to new position */}
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
                    fill="rgba(245, 158, 11, 0.6)"
                  />
                </marker>
              </defs>
              <line
                x1={move.from.x + move.from.width / 2}
                y1={move.from.y + move.from.height / 2}
                x2={move.to.x + move.to.width / 2}
                y2={move.to.y + move.to.height / 2}
                stroke="rgba(245, 158, 11, 0.4)"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                markerEnd={`url(#arrowhead-${idx})`}
              />
            </svg>
            {/* Move badge */}
            <div
              style={{
                position: "absolute",
                left: move.from.x + move.from.width - 8,
                top: move.from.y - 8,
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "#7c3aed",
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
                fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              }}
            >
              {idx + 1}
            </div>
          </div>
        ))}
    </div>
  );
}
