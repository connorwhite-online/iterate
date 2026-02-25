import React, { useCallback, useRef, useState } from "react";
import type { SVGPathData } from "@iterate/core";

interface Point {
  x: number;
  y: number;
}

interface SVGCanvasProps {
  active: boolean;
  drawings: SVGPathData[];
  onDrawingComplete: (path: SVGPathData, bounds: { x: number; y: number; width: number; height: number }) => void;
}

/**
 * SVG-based canvas overlay for freehand annotation drawing.
 * When active, captures mouse events to draw circles, lines, and freehand shapes.
 */
export function SVGCanvas({ active, drawings, onDrawingComplete }: SVGCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [currentPath, setCurrentPath] = useState<Point[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!active) return;
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;

      setIsDrawing(true);
      setCurrentPath([{ x: e.clientX - rect.left, y: e.clientY - rect.top }]);
    },
    [active]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!isDrawing || !active) return;
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;

      setCurrentPath((prev) => [
        ...prev,
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
      ]);
    },
    [isDrawing, active]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDrawing || currentPath.length < 2) {
      setIsDrawing(false);
      setCurrentPath([]);
      return;
    }

    // Convert points to SVG path data
    const d = pointsToPath(currentPath);

    // Calculate bounding box
    const xs = currentPath.map((p) => p.x);
    const ys = currentPath.map((p) => p.y);
    const bounds = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };

    const pathData: SVGPathData = {
      d,
      stroke: "#ef4444",
      strokeWidth: 3,
      fill: "none",
    };

    onDrawingComplete(pathData, bounds);
    setIsDrawing(false);
    setCurrentPath([]);
  }, [isDrawing, currentPath, onDrawingComplete]);

  return (
    <svg
      ref={svgRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: active ? "auto" : "none",
        cursor: active ? "crosshair" : "default",
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Existing drawings */}
      {drawings.map((drawing, i) => (
        <path
          key={i}
          d={drawing.d}
          stroke={drawing.stroke}
          strokeWidth={drawing.strokeWidth}
          fill={drawing.fill}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}

      {/* Current drawing in progress */}
      {currentPath.length > 1 && (
        <path
          d={pointsToPath(currentPath)}
          stroke="#ef4444"
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.8}
        />
      )}
    </svg>
  );
}

/** Convert an array of points to an SVG path `d` attribute */
function pointsToPath(points: Point[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  let d = `M ${first!.x} ${first!.y}`;

  for (const point of rest) {
    d += ` L ${point.x} ${point.y}`;
  }

  return d;
}
