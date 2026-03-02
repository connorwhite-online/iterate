import React, { useCallback, useEffect, useState } from "react";
import type { Rect } from "@iterate/core";
import { elementToPicked, type PickedElement } from "./ElementPicker.js";

interface MarqueeSelectProps {
  active: boolean;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onSelect: (elements: PickedElement[]) => void;
}

/**
 * Rubber-band / marquee multi-select overlay.
 * Click-drag on empty space to draw a selection rectangle,
 * then select all elements within the rectangle.
 */
export function MarqueeSelect({
  active,
  iframeRef,
  onSelect,
}: MarqueeSelectProps) {
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);

  const getTargetDocument = useCallback(() => {
    try {
      return iframeRef.current?.contentDocument ?? document;
    } catch {
      return document;
    }
  }, [iframeRef]);

  useEffect(() => {
    if (!active) {
      setMarquee(null);
      setStartPoint(null);
      return;
    }

    const targetDoc = getTargetDocument();

    let isDragging = false;
    let start = { x: 0, y: 0 };

    const handleMouseDown = (e: MouseEvent) => {
      // Only start marquee on left-click without modifier (Ctrl+Click is for ElementPicker toggle)
      if (e.button !== 0 || e.ctrlKey || e.metaKey) return;

      // Check if we're clicking on a "significant" element (button, link, input, etc.)
      // If so, let ElementPicker handle it. Only start marquee on container/body clicks.
      const target = e.target as Element;
      const tag = target.tagName.toLowerCase();
      const isInteractive = ["button", "a", "input", "select", "textarea", "img", "video"].includes(tag)
        || target.getAttribute("role") === "button"
        || target.getAttribute("role") === "link";

      // Only start marquee on double-purpose containers (check if element is "large")
      const rect = target.getBoundingClientRect();
      const isLargeContainer = rect.width > 200 && rect.height > 200;

      if (isInteractive || !isLargeContainer) return;

      isDragging = true;
      start = { x: e.clientX, y: e.clientY };
      setStartPoint(start);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const x = Math.min(start.x, e.clientX);
      const y = Math.min(start.y, e.clientY);
      const width = Math.abs(e.clientX - start.x);
      const height = Math.abs(e.clientY - start.y);

      // Only show marquee after a minimum drag distance
      if (width > 10 || height > 10) {
        setMarquee({ x, y, width, height });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!isDragging) return;
      isDragging = false;

      const currentMarquee = {
        x: Math.min(start.x, e.clientX),
        y: Math.min(start.y, e.clientY),
        width: Math.abs(e.clientX - start.x),
        height: Math.abs(e.clientY - start.y),
      };

      setMarquee(null);
      setStartPoint(null);

      // Minimum size to count as a marquee selection
      if (currentMarquee.width < 20 || currentMarquee.height < 20) return;

      // Find all elements within the marquee
      const elements = findElementsInRect(targetDoc, currentMarquee);
      if (elements.length > 0) {
        onSelect(elements);
      }
    };

    // Use capture phase so we can intercept before ElementPicker
    targetDoc.addEventListener("mousedown", handleMouseDown);
    targetDoc.addEventListener("mousemove", handleMouseMove);
    targetDoc.addEventListener("mouseup", handleMouseUp);

    return () => {
      targetDoc.removeEventListener("mousedown", handleMouseDown);
      targetDoc.removeEventListener("mousemove", handleMouseMove);
      targetDoc.removeEventListener("mouseup", handleMouseUp);
    };
  }, [active, getTargetDocument, onSelect]);

  if (!active || !marquee) return null;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: marquee.x,
          top: marquee.y,
          width: marquee.width,
          height: marquee.height,
          border: "2px dashed #2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.08)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

/**
 * Find all "interesting" elements fully enclosed within the given rectangle.
 * Only selects elements whose entire bounding box fits inside the marquee.
 * Filters out html/body/large wrapper elements to get meaningful selections.
 */
function findElementsInRect(
  doc: Document,
  rect: Rect
): PickedElement[] {
  const results: PickedElement[] = [];
  const seen = new Set<Element>();

  // Walk all elements and check full enclosure
  const allElements = doc.querySelectorAll("*");

  for (const el of allElements) {
    // Skip non-visual elements
    const tag = el.tagName.toLowerCase();
    if (["html", "body", "head", "script", "style", "meta", "link", "noscript"].includes(tag)) {
      continue;
    }

    const elRect = el.getBoundingClientRect();

    // Skip zero-size elements
    if (elRect.width === 0 || elRect.height === 0) continue;

    // Skip elements larger than the marquee (containers wrapping everything)
    if (elRect.width > rect.width * 2 && elRect.height > rect.height * 2) continue;

    // Check full enclosure — element must be entirely within the marquee box
    if (
      elRect.left >= rect.x &&
      elRect.right <= rect.x + rect.width &&
      elRect.top >= rect.y &&
      elRect.bottom <= rect.y + rect.height
    ) {
      // Skip if a parent is already selected (prefer leaf elements)
      let parentAlreadySelected = false;
      let parent = el.parentElement;
      while (parent) {
        if (seen.has(parent)) {
          parentAlreadySelected = true;
          break;
        }
        parent = parent.parentElement;
      }

      if (!parentAlreadySelected) {
        // Remove any children that were previously added
        for (let i = results.length - 1; i >= 0; i--) {
          if (el.contains(results[i]!.domElement)) {
            results.splice(i, 1);
          }
        }

        seen.add(el);
        results.push(elementToPicked(el));
      }
    }
  }

  return results;
}
