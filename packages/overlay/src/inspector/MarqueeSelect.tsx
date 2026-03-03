import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Rect } from "iterate-ui-core";
import { elementToPicked, type PickedElement } from "./ElementPicker.js";

interface MarqueeSelectProps {
  active: boolean;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onSelect: (elements: PickedElement[]) => void;
  /** Called when marquee drag starts/stops */
  onDragStateChange?: (isDragging: boolean) => void;
}

/**
 * Rubber-band / marquee multi-select overlay.
 * Click-drag on empty space to draw a selection rectangle,
 * then select all elements within the rectangle.
 * Highlights contained elements live during drag.
 */
export function MarqueeSelect({
  active,
  iframeRef,
  onSelect,
  onDragStateChange,
}: MarqueeSelectProps) {
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [previewRects, setPreviewRects] = useState<Rect[]>([]);
  const previewThrottleRef = useRef<number>(0);

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
      onDragStateChange?.(true);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const x = Math.min(start.x, e.clientX);
      const y = Math.min(start.y, e.clientY);
      const width = Math.abs(e.clientX - start.x);
      const height = Math.abs(e.clientY - start.y);

      // Only show marquee after a minimum drag distance
      if (width > 10 || height > 10) {
        const currentRect = { x, y, width, height };
        setMarquee(currentRect);

        // Throttle preview computation to every ~80ms for perf
        const now = Date.now();
        if (now - previewThrottleRef.current > 80) {
          previewThrottleRef.current = now;
          const rects = findElementRectsInRect(targetDoc, currentRect);
          setPreviewRects(rects);
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!isDragging) return;
      isDragging = false;
      onDragStateChange?.(false);

      const currentMarquee = {
        x: Math.min(start.x, e.clientX),
        y: Math.min(start.y, e.clientY),
        width: Math.abs(e.clientX - start.x),
        height: Math.abs(e.clientY - start.y),
      };

      setMarquee(null);
      setStartPoint(null);
      setPreviewRects([]);

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
  }, [active, getTargetDocument, onSelect, onDragStateChange]);

  if (!active || !marquee) return null;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {/* Marquee rectangle */}
      <div
        style={{
          position: "absolute",
          left: marquee.x,
          top: marquee.y,
          width: marquee.width,
          height: marquee.height,
          border: "1.5px dashed #6b9eff",
          backgroundColor: "rgba(107, 158, 255, 0.06)",
          borderRadius: 3,
          pointerEvents: "none",
        }}
      />
      {/* Live highlight frames for contained elements */}
      {previewRects.map((r, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: r.x,
            top: r.y,
            width: r.width,
            height: r.height,
            border: "1.5px solid #6b9eff",
            borderRadius: 4,
            pointerEvents: "none",
            boxSizing: "border-box",
          }}
        />
      ))}
    </div>
  );
}

/** Check if an element's rect is contained within a marquee rect, with tolerance */
function isContained(elRect: DOMRect, rect: Rect, tolerance: number): boolean {
  return (
    elRect.left >= rect.x - tolerance &&
    elRect.right <= rect.x + rect.width + tolerance &&
    elRect.top >= rect.y - tolerance &&
    elRect.bottom <= rect.y + rect.height + tolerance
  );
}

/** Skip non-visual or structural-only tags */
const SKIP_TAGS = new Set(["html", "body", "head", "script", "style", "meta", "link", "noscript"]);

/** Check if an element is part of the iterate overlay (must not be selected) */
const isOverlayElement = (el: Element) => !!el.closest("#__iterate-overlay-root__");

/**
 * Tolerance in px for containment checks. Lets the marquee "forgive" a few
 * pixels of overshoot so dragging roughly around an element still captures it.
 */
const CONTAINMENT_TOLERANCE = 8;

/**
 * Fast version that returns just bounding rects for live preview during drag.
 * Uses the same containment logic but skips expensive elementToPicked conversion.
 *
 * Two-pass "shallowest contained" strategy:
 *  1. Collect every element fully inside the marquee.
 *  2. Keep only elements whose parent is NOT also contained — the top-level items.
 */
function findElementRectsInRect(doc: Document, rect: Rect): Rect[] {
  // First pass: collect all contained elements
  const contained = new Set<Element>();
  const allElements = doc.querySelectorAll("*");

  for (const el of allElements) {
    if (SKIP_TAGS.has(el.tagName.toLowerCase())) continue;
    if (isOverlayElement(el)) continue;

    const elRect = el.getBoundingClientRect();
    if (elRect.width === 0 || elRect.height === 0) continue;
    if (elRect.width > rect.width * 2 && elRect.height > rect.height * 2) continue;

    if (isContained(elRect, rect, CONTAINMENT_TOLERANCE)) {
      contained.add(el);
    }
  }

  // Second pass: keep only shallowest contained elements
  // (those whose parent is NOT also in the contained set)
  const rects: Rect[] = [];
  for (const el of contained) {
    let parent = el.parentElement;
    let parentContained = false;
    while (parent) {
      if (contained.has(parent)) {
        parentContained = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (!parentContained) {
      const elRect = el.getBoundingClientRect();
      rects.push({ x: elRect.x, y: elRect.y, width: elRect.width, height: elRect.height });
    }
  }

  return rects;
}

/**
 * Find all "interesting" elements fully enclosed within the given rectangle.
 * Uses tolerance so near-miss drags still capture the intended element.
 *
 * Two-pass "shallowest contained" strategy:
 *  1. Collect every element fully inside the marquee.
 *  2. Keep only elements whose parent is NOT also contained — the top-level items.
 *
 * This ensures multi-select gives individual items (e.g. list rows) rather
 * than collapsing everything into their shared parent container.
 */
function findElementsInRect(
  doc: Document,
  rect: Rect
): PickedElement[] {
  // First pass: collect all contained elements
  const contained = new Set<Element>();
  const allElements = doc.querySelectorAll("*");

  for (const el of allElements) {
    if (SKIP_TAGS.has(el.tagName.toLowerCase())) continue;
    if (isOverlayElement(el)) continue;

    const elRect = el.getBoundingClientRect();
    if (elRect.width === 0 || elRect.height === 0) continue;
    if (elRect.width > rect.width * 2 && elRect.height > rect.height * 2) continue;

    if (isContained(elRect, rect, CONTAINMENT_TOLERANCE)) {
      contained.add(el);
    }
  }

  // Second pass: keep only shallowest contained elements
  // (those whose parent is NOT also in the contained set)
  const results: PickedElement[] = [];
  for (const el of contained) {
    let parent = el.parentElement;
    let parentContained = false;
    while (parent) {
      if (contained.has(parent)) {
        parentContained = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (!parentContained) {
      results.push(elementToPicked(el));
    }
  }

  return results;
}
