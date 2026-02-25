import React, { useCallback, useEffect, useState } from "react";
import type { Rect } from "@iterate/core";
import { generateSelector, getRelevantStyles } from "./selector.js";

export interface PickedElement {
  element: Element;
  selector: string;
  rect: Rect;
  computedStyles: Record<string, string>;
}

interface ElementPickerProps {
  active: boolean;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onPick: (picked: PickedElement) => void;
}

/**
 * Overlay that highlights elements on hover and captures clicks.
 * Works within an iframe's document (same-origin required).
 */
export function ElementPicker({ active, iframeRef, onPick }: ElementPickerProps) {
  const [highlight, setHighlight] = useState<Rect | null>(null);
  const [hoveredSelector, setHoveredSelector] = useState<string>("");

  const getIframeDocument = useCallback(() => {
    try {
      return iframeRef.current?.contentDocument ?? null;
    } catch {
      return null; // Cross-origin
    }
  }, [iframeRef]);

  useEffect(() => {
    if (!active) {
      setHighlight(null);
      return;
    }

    const iframeDoc = getIframeDocument();
    if (!iframeDoc) return;

    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target || target === iframeDoc.documentElement) return;

      const rect = target.getBoundingClientRect();
      setHighlight({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
      setHoveredSelector(generateSelector(target));
    };

    const handleClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const target = e.target as Element;
      if (!target) return;

      const rect = target.getBoundingClientRect();
      onPick({
        element: target,
        selector: generateSelector(target),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        computedStyles: getRelevantStyles(target),
      });
    };

    iframeDoc.addEventListener("mousemove", handleMouseMove);
    iframeDoc.addEventListener("click", handleClick, { capture: true });

    return () => {
      iframeDoc.removeEventListener("mousemove", handleMouseMove);
      iframeDoc.removeEventListener("click", handleClick, { capture: true });
    };
  }, [active, getIframeDocument, onPick]);

  if (!active || !highlight) return null;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {/* Element highlight box */}
      <div
        style={{
          position: "absolute",
          left: highlight.x,
          top: highlight.y,
          width: highlight.width,
          height: highlight.height,
          border: "2px solid #2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.1)",
          pointerEvents: "none",
          transition: "all 0.1s ease",
        }}
      />
      {/* Selector label */}
      <div
        style={{
          position: "absolute",
          left: highlight.x,
          top: Math.max(0, highlight.y - 24),
          background: "#2563eb",
          color: "#fff",
          padding: "2px 6px",
          borderRadius: 3,
          fontSize: 11,
          fontFamily: "monospace",
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {hoveredSelector}
      </div>
    </div>
  );
}
