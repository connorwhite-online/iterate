import React, { useCallback, useEffect, useRef, useState } from "react";
import type { DrawingData, Rect } from "@iterate/core";
import { elementToPicked, type PickedElement } from "./ElementPicker.js";

interface MarkerDrawProps {
  active: boolean;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** Called when drawing is complete — returns nearby elements + drawing data */
  onDrawComplete: (elements: PickedElement[], drawing: DrawingData) => void;
}

/** Stroke settings */
const STROKE_COLOR = "#ef4444";
const STROKE_WIDTH = 3;

/**
 * Freehand drawing overlay (marker tool).
 *
 * When active, the user can draw on the screen. On mouseup, the drawing
 * is captured as an SVG path, nearby/underlying elements are identified,
 * and the annotation panel is opened.
 */
export function MarkerDraw({
  active,
  iframeRef,
  onDrawComplete,
}: MarkerDrawProps) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);
  const [completedDrawings, setCompletedDrawings] = useState<DrawingData[]>([]);
  const pointsRef = useRef<{ x: number; y: number }[]>([]);

  const getTargetDocument = useCallback(() => {
    try {
      return iframeRef.current?.contentDocument ?? document;
    } catch {
      return document;
    }
  }, [iframeRef]);

  // Clear completed drawings when tool is deactivated
  useEffect(() => {
    if (!active) {
      setCompletedDrawings([]);
    }
  }, [active]);

  useEffect(() => {
    if (!active) {
      setIsDrawing(false);
      setPoints([]);
      pointsRef.current = [];
      return;
    }

    const targetDoc = getTargetDocument();

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      setIsDrawing(true);
      const pt = { x: e.clientX, y: e.clientY };
      pointsRef.current = [pt];
      setPoints([pt]);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDrawing) return;
      const pt = { x: e.clientX, y: e.clientY };
      pointsRef.current.push(pt);
      // Update state periodically for rendering (every 2nd point for perf)
      if (pointsRef.current.length % 2 === 0) {
        setPoints([...pointsRef.current]);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!isDrawing) return;
      setIsDrawing(false);

      const finalPoints = pointsRef.current;
      if (finalPoints.length < 3) {
        setPoints([]);
        pointsRef.current = [];
        return;
      }

      // Build SVG path data
      const pathData = pointsToPath(finalPoints);

      // Calculate bounding box
      const bounds = pointsBounds(finalPoints);

      const drawing: DrawingData = {
        path: pathData,
        bounds,
        strokeColor: STROKE_COLOR,
        strokeWidth: STROKE_WIDTH,
      };

      // Find elements under/near the drawing
      const elements = findElementsUnderDrawing(targetDoc, bounds);

      // Store this completed drawing for persistent display
      setCompletedDrawings((prev) => [...prev, drawing]);

      setPoints([]);
      pointsRef.current = [];

      onDrawComplete(elements, drawing);
    };

    targetDoc.addEventListener("mousedown", handleMouseDown, { capture: true });
    targetDoc.addEventListener("mousemove", handleMouseMove);
    targetDoc.addEventListener("mouseup", handleMouseUp);

    return () => {
      targetDoc.removeEventListener("mousedown", handleMouseDown, { capture: true });
      targetDoc.removeEventListener("mousemove", handleMouseMove);
      targetDoc.removeEventListener("mouseup", handleMouseUp);
    };
  }, [active, isDrawing, getTargetDocument, onDrawComplete]);

  if (!active) return null;

  const currentPath = points.length >= 2 ? pointsToPath(points) : null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        cursor: "crosshair",
      }}
    >
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
        {/* Previously completed drawings */}
        {completedDrawings.map((d, i) => (
          <path
            key={`completed-${i}`}
            d={d.path}
            fill="none"
            stroke={d.strokeColor}
            strokeWidth={d.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.6}
          />
        ))}

        {/* Current drawing in progress */}
        {currentPath && (
          <path
            d={currentPath}
            fill="none"
            stroke={STROKE_COLOR}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>

      {/* Crosshair cursor overlay — needs pointer-events for custom cursor */}
      {!isDrawing && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "auto",
            cursor: "crosshair",
          }}
        />
      )}
    </div>
  );
}

/** Convert an array of points to an SVG path data string */
function pointsToPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  const parts = [`M ${points[0]!.x} ${points[0]!.y}`];

  // Use quadratic bezier curves for smooth lines
  for (let i = 1; i < points.length - 1; i++) {
    const cp = points[i]!;
    const next = points[i + 1]!;
    const midX = (cp.x + next.x) / 2;
    const midY = (cp.y + next.y) / 2;
    parts.push(`Q ${cp.x} ${cp.y} ${midX} ${midY}`);
  }

  // Line to last point
  if (points.length > 1) {
    const last = points[points.length - 1]!;
    parts.push(`L ${last.x} ${last.y}`);
  }

  return parts.join(" ");
}

/** Calculate the bounding box of a set of points */
function pointsBounds(points: { x: number; y: number }[]): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Find elements whose bounding rects overlap with the drawing bounds */
function findElementsUnderDrawing(
  doc: Document,
  bounds: Rect,
): PickedElement[] {
  const results: PickedElement[] = [];
  const seen = new Set<Element>();

  // Expand bounds slightly for better matching
  const margin = 10;
  const expandedBounds = {
    x: bounds.x - margin,
    y: bounds.y - margin,
    width: bounds.width + margin * 2,
    height: bounds.height + margin * 2,
  };

  const allElements = doc.querySelectorAll("*");
  for (const el of allElements) {
    const tag = el.tagName.toLowerCase();
    if (["html", "body", "head", "script", "style", "meta", "link", "noscript"].includes(tag)) {
      continue;
    }

    const elRect = el.getBoundingClientRect();
    if (elRect.width === 0 || elRect.height === 0) continue;

    // Skip elements much larger than the drawing area
    if (elRect.width > expandedBounds.width * 3 && elRect.height > expandedBounds.height * 3) continue;

    // Check intersection with expanded drawing bounds
    if (
      elRect.left < expandedBounds.x + expandedBounds.width &&
      elRect.right > expandedBounds.x &&
      elRect.top < expandedBounds.y + expandedBounds.height &&
      elRect.bottom > expandedBounds.y
    ) {
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
