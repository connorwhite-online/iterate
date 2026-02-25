import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AnnotationData, AnnotationIntent, AnnotationSeverity, SVGPathData, Rect } from "@iterate/core";
import { SVGCanvas } from "./canvas/SVGCanvas.js";
import { ElementPicker, type PickedElement } from "./inspector/ElementPicker.js";
import { AnnotationDialog } from "./annotate/AnnotationDialog.js";
import { DragHandler } from "./manipulate/DragHandler.js";
import { DaemonConnection } from "./transport/connection.js";
import {
  generateSelector,
  getRelevantStyles,
  identifyElement,
  getElementPath,
  getNearbyText,
} from "./inspector/selector.js";

export type ToolMode = "select" | "annotate" | "move";

export interface IterateOverlayProps {
  /** Which tool mode is active */
  mode: ToolMode;
  /** Name of the current iteration being viewed */
  iteration: string;
  /** WebSocket URL for daemon connection (auto-detected if omitted) */
  wsUrl?: string;
  /** Reference to the iteration iframe */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}

/**
 * Main overlay component for iterate.
 * Renders the annotation canvas, element picker, and drag handler
 * on top of an iteration's iframe.
 */
export function IterateOverlay({
  mode,
  iteration,
  wsUrl,
  iframeRef,
}: IterateOverlayProps) {
  const connectionRef = useRef<DaemonConnection | null>(null);
  const [drawings, setDrawings] = useState<SVGPathData[]>([]);
  const [pendingAnnotation, setPendingAnnotation] = useState<{
    drawing: SVGPathData;
    bounds: { x: number; y: number; width: number; height: number };
    selector?: string;
    elementName?: string;
    elementPath?: string;
    nearbyText?: string;
    rect?: Rect;
    computedStyles?: Record<string, string>;
  } | null>(null);

  // Connect to daemon
  useEffect(() => {
    const conn = new DaemonConnection(wsUrl);
    connectionRef.current = conn;
    conn.connect();

    conn.onMessage((msg) => {
      if (msg.type === "annotation:created") {
        const annotation = msg.payload as AnnotationData;
        if (annotation.drawing) {
          setDrawings((prev) => [...prev, annotation.drawing!]);
        }
      }
    });

    return () => conn.disconnect();
  }, [wsUrl]);

  // Handle completed drawing → show annotation dialog
  const handleDrawingComplete = useCallback(
    (path: SVGPathData, bounds: { x: number; y: number; width: number; height: number }) => {
      // Try to find the element at the center of the drawing
      try {
        const iframeDoc = iframeRef.current?.contentDocument;
        if (iframeDoc) {
          const centerX = bounds.x + bounds.width / 2;
          const centerY = bounds.y + bounds.height / 2;
          const element = iframeDoc.elementFromPoint(centerX, centerY);

          if (element) {
            const rect = element.getBoundingClientRect();
            setPendingAnnotation({
              drawing: path,
              bounds,
              selector: generateSelector(element),
              elementName: identifyElement(element),
              elementPath: getElementPath(element),
              nearbyText: getNearbyText(element),
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              computedStyles: getRelevantStyles(element),
            });
            return;
          }
        }
      } catch {
        // Cross-origin or other error
      }

      setPendingAnnotation({ drawing: path, bounds });
    },
    [iframeRef]
  );

  // Submit annotation to daemon
  const handleAnnotationSubmit = useCallback(
    (comment: string, intent?: AnnotationIntent, severity?: AnnotationSeverity) => {
      if (!pendingAnnotation || !connectionRef.current) return;

      connectionRef.current.send({
        type: "annotation:create",
        payload: {
          iteration,
          selector: pendingAnnotation.selector ?? "",
          elementName: pendingAnnotation.elementName ?? "",
          elementPath: pendingAnnotation.elementPath ?? "",
          nearbyText: pendingAnnotation.nearbyText,
          rect: pendingAnnotation.rect ?? pendingAnnotation.bounds,
          computedStyles: pendingAnnotation.computedStyles ?? {},
          drawing: pendingAnnotation.drawing,
          comment,
          intent,
          severity,
        },
      });

      setDrawings((prev) => [...prev, pendingAnnotation.drawing]);
      setPendingAnnotation(null);
    },
    [pendingAnnotation, iteration]
  );

  // Handle element pick (in select mode)
  const handleElementPick = useCallback(
    (picked: PickedElement) => {
      // For now, log the picked element. In Phase 3, this feeds into MCP context.
      console.log("[iterate] Selected element:", picked.selector, picked.computedStyles);
    },
    []
  );

  // Handle drag move
  const handleMove = useCallback(
    (data: { selector: string; from: Rect; to: Rect; computedStyles: Record<string, string> }) => {
      connectionRef.current?.send({
        type: "dom:move",
        payload: {
          iteration,
          selector: data.selector,
          from: data.from,
          to: data.to,
        },
      });
    },
    [iteration]
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      {/* SVG annotation canvas */}
      <SVGCanvas
        active={mode === "annotate"}
        drawings={drawings}
        onDrawingComplete={handleDrawingComplete}
      />

      {/* Element picker for select mode */}
      <ElementPicker
        active={mode === "select"}
        iframeRef={iframeRef}
        onPick={handleElementPick}
      />

      {/* Drag handler for move mode */}
      <DragHandler
        active={mode === "move"}
        iframeRef={iframeRef}
        onMove={handleMove}
      />

      {/* Annotation dialog (after drawing) */}
      {pendingAnnotation && (
        <AnnotationDialog
          position={{
            x: pendingAnnotation.bounds.x + pendingAnnotation.bounds.width / 2,
            y: pendingAnnotation.bounds.y + pendingAnnotation.bounds.height,
          }}
          onSubmit={handleAnnotationSubmit}
          onCancel={() => setPendingAnnotation(null)}
        />
      )}
    </div>
  );
}
