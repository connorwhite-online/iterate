import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Rect } from "@iterate/core";
import { generateSelector, getRelevantStyles } from "../inspector/selector.js";

interface DragHandlerProps {
  active: boolean;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onMove: (data: {
    selector: string;
    from: Rect;
    to: Rect;
    computedStyles: Record<string, string>;
  }) => void;
}

/**
 * Handles drag-to-move for absolutely positioned elements
 * and drag-to-reorder for flex children.
 */
export function DragHandler({ active, iframeRef, onMove }: DragHandlerProps) {
  const [dragging, setDragging] = useState(false);
  const [dragElement, setDragElement] = useState<Element | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [currentOffset, setCurrentOffset] = useState({ x: 0, y: 0 });
  const [originalRect, setOriginalRect] = useState<Rect | null>(null);

  const getIframeDocument = useCallback(() => {
    try {
      return iframeRef.current?.contentDocument ?? null;
    } catch {
      return null;
    }
  }, [iframeRef]);

  useEffect(() => {
    if (!active) {
      setDragging(false);
      setDragElement(null);
      return;
    }

    const iframeDoc = getIframeDocument();
    if (!iframeDoc) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target) return;

      const computed = window.getComputedStyle(target);
      const position = computed.position;
      const parentDisplay = target.parentElement
        ? window.getComputedStyle(target.parentElement).display
        : "";

      // Only allow dragging for absolute/fixed elements or flex children
      const isDraggable =
        position === "absolute" ||
        position === "fixed" ||
        parentDisplay.includes("flex");

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

      const newRect: Rect = {
        x: originalRect.x + (e.clientX - dragStart.x),
        y: originalRect.y + (e.clientY - dragStart.y),
        width: originalRect.width,
        height: originalRect.height,
      };

      onMove({
        selector: generateSelector(dragElement),
        from: originalRect,
        to: newRect,
        computedStyles: getRelevantStyles(dragElement),
      });

      setDragging(false);
      setDragElement(null);
      setDragStart(null);
      setOriginalRect(null);
      setCurrentOffset({ x: 0, y: 0 });
    };

    iframeDoc.addEventListener("mousedown", handleMouseDown, { capture: true });
    iframeDoc.addEventListener("mousemove", handleMouseMove);
    iframeDoc.addEventListener("mouseup", handleMouseUp);

    return () => {
      iframeDoc.removeEventListener("mousedown", handleMouseDown, { capture: true });
      iframeDoc.removeEventListener("mousemove", handleMouseMove);
      iframeDoc.removeEventListener("mouseup", handleMouseUp);
    };
  }, [active, dragging, dragStart, dragElement, originalRect, getIframeDocument, onMove]);

  if (!dragging || !originalRect) return null;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {/* Ghost of the element being dragged */}
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
      {/* Original position indicator */}
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
    </div>
  );
}
