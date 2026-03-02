import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  AnnotationData,
  AnnotationIntent,
  AnnotationSeverity,
  SelectedElement,
  TextSelection,
  DrawingData,
  Rect,
  DomChange,
} from "iterate-ui-core";
import { formatBatchPrompt } from "iterate-ui-core";
import { ElementPicker, type PickedElement } from "./inspector/ElementPicker.js";
import { MarqueeSelect } from "./inspector/MarqueeSelect.js";
import { TextSelect } from "./inspector/TextSelect.js";
import { MarkerDraw } from "./inspector/MarkerDraw.js";
import { SelectionPanel } from "./annotate/SelectionPanel.js";
import { DragHandler, type PendingMove } from "./manipulate/DragHandler.js";
import { DaemonConnection } from "./transport/connection.js";

export type ToolMode = "select" | "move" | "draw" | "browse";

export interface IterateOverlayProps {
  /** Which tool mode is active */
  mode: ToolMode;
  /** Name of the current iteration being viewed */
  iteration: string;
  /** WebSocket URL for daemon connection (auto-detected if omitted) */
  wsUrl?: string;
  /** Reference to the iteration iframe */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** Current pending batch count (passed up for toolbar badge) */
  onBatchCountChange?: (count: number) => void;
  /** Current pending move count (passed up for toolbar badge) */
  onMoveCountChange?: (count: number) => void;
  /** Whether live preview is enabled */
  previewMode?: boolean;
  /** Callback to submit the pending batch */
  onSubmitBatch?: () => void;
}

/** Annotation waiting to be submitted (local-only until batch submit) */
interface PendingAnnotation {
  iteration: string;
  elements: SelectedElement[];
  textSelection?: TextSelection;
  drawing?: DrawingData;
  comment: string;
  intent?: AnnotationIntent;
  severity?: AnnotationSeverity;
}

/**
 * Main overlay component for iterate.
 * Renders element selection tools, annotation panel, and drag handler
 * on top of an iteration's iframe.
 */
export function IterateOverlay({
  mode,
  iteration,
  wsUrl,
  iframeRef,
  onBatchCountChange,
  onMoveCountChange,
  previewMode = true,
}: IterateOverlayProps) {
  const connectionRef = useRef<DaemonConnection | null>(null);

  // Selection state
  const [selectedElements, setSelectedElements] = useState<PickedElement[]>([]);
  const [textSelection, setTextSelection] = useState<TextSelection | null>(null);
  const [activeDrawing, setActiveDrawing] = useState<DrawingData | null>(null);

  // Pending batch (accumulated annotations not yet submitted)
  const [pendingBatch, setPendingBatch] = useState<PendingAnnotation[]>([]);

  // Pending moves (accumulated DOM moves not yet submitted)
  const [pendingMoves, setPendingMoves] = useState<PendingMove[]>([]);

  // When the selection panel is open, disable pickers so clicks in the panel
  // don't re-contextualize the selection
  const isAnnotating = selectedElements.length > 0 || textSelection !== null;

  // Connect to daemon
  useEffect(() => {
    const conn = new DaemonConnection(wsUrl);
    connectionRef.current = conn;
    conn.connect();
    return () => conn.disconnect();
  }, [wsUrl]);

  // Notify parent of batch count changes
  useEffect(() => {
    onBatchCountChange?.(pendingBatch.length);
  }, [pendingBatch.length, onBatchCountChange]);

  // Notify parent of move count changes
  useEffect(() => {
    onMoveCountChange?.(pendingMoves.length);
  }, [pendingMoves.length, onMoveCountChange]);

  // Handle element selection from ElementPicker (click / ctrl+click)
  const handleElementSelect = useCallback(
    (elements: PickedElement[]) => {
      setSelectedElements(elements);
    },
    []
  );

  // Handle marquee selection (replaces the current selection)
  const handleMarqueeSelect = useCallback(
    (elements: PickedElement[]) => {
      setSelectedElements(elements);
    },
    []
  );

  // Handle text selection
  const handleTextSelect = useCallback(
    (selection: TextSelection | null) => {
      setTextSelection(selection);
    },
    []
  );

  // Handle marker drawing completion
  const handleDrawComplete = useCallback(
    (elements: PickedElement[], drawing: DrawingData) => {
      setSelectedElements(elements);
      setActiveDrawing(drawing);
    },
    []
  );

  // Remove a single element from the selection
  const handleRemoveElement = useCallback(
    (index: number) => {
      setSelectedElements((prev) => {
        const updated = [...prev];
        updated.splice(index, 1);
        return updated;
      });
    },
    []
  );

  // Add current selection as an annotation to the pending batch
  const handleAddToBatch = useCallback(
    (comment: string, intent?: AnnotationIntent, severity?: AnnotationSeverity) => {
      if (selectedElements.length === 0 && !textSelection && !activeDrawing) return;

      const annotation: PendingAnnotation = {
        iteration,
        elements: selectedElements.map((el) => ({
          selector: el.selector,
          elementName: el.elementName,
          elementPath: el.elementPath,
          rect: el.rect,
          computedStyles: el.computedStyles,
          nearbyText: el.nearbyText,
          componentName: el.componentName,
          sourceLocation: el.sourceLocation,
        })),
        textSelection: textSelection ?? undefined,
        drawing: activeDrawing ?? undefined,
        comment,
        intent,
        severity,
      };

      setPendingBatch((prev) => [...prev, annotation]);

      // Clear selection after adding to batch
      setSelectedElements([]);
      setTextSelection(null);
      setActiveDrawing(null);
    },
    [selectedElements, textSelection, activeDrawing, iteration]
  );

  // Clear selection
  const handleClearSelection = useCallback(() => {
    setSelectedElements([]);
    setTextSelection(null);
    setActiveDrawing(null);
  }, []);

  // Handle drag move — add to pending moves list with current iteration
  const handleMove = useCallback(
    (move: PendingMove) => {
      setPendingMoves((prev) => [...prev, { ...move, iteration }]);
    },
    [iteration]
  );

  // Convert pending moves to DomChange format for the wire protocol
  const pendingMovesToDomChanges = useCallback((): DomChange[] => {
    return pendingMoves.map((move, idx) => {
      const isReorder = move.reorderIndex !== undefined;
      return {
        id: `pending-move-${idx}-${Date.now()}`,
        iteration: move.iteration ?? iteration,
        selector: move.selector,
        type: isReorder ? ("reorder" as const) : ("move" as const),
        componentName: move.componentName,
        sourceLocation: move.sourceLocation,
        before: {
          rect: move.from,
          computedStyles: move.computedStyles,
        },
        after: {
          rect: move.to,
          computedStyles: move.computedStyles,
          siblingIndex: move.reorderIndex,
        },
        timestamp: Date.now(),
      };
    });
  }, [pendingMoves, iteration]);

  // Expose batch submission to parent (called by Submit button in toolbar)
  useEffect(() => {
    const handler = () => {
      if ((pendingBatch.length === 0 && pendingMoves.length === 0) || !connectionRef.current) return;

      connectionRef.current.send({
        type: "batch:submit",
        payload: {
          iteration,
          annotations: pendingBatch.map((a) => ({
            iteration: a.iteration,
            elements: a.elements,
            textSelection: a.textSelection,
            drawing: a.drawing,
            comment: a.comment,
            intent: a.intent,
            severity: a.severity,
          })),
          domChanges: pendingMovesToDomChanges(),
        },
      });

      setPendingBatch([]);
      setPendingMoves([]);
    };

    window.addEventListener("iterate:submit-batch", handler);
    return () => window.removeEventListener("iterate:submit-batch", handler);
  }, [pendingBatch, pendingMoves, iteration, pendingMovesToDomChanges]);

  // Handle clearing all pending annotations and moves
  useEffect(() => {
    const handler = () => {
      setPendingBatch([]);
      setPendingMoves([]);
      setSelectedElements([]);
      setTextSelection(null);
      setActiveDrawing(null);
    };
    window.addEventListener("iterate:clear-batch", handler);
    return () => window.removeEventListener("iterate:clear-batch", handler);
  }, []);

  // Handle undoing the last move
  useEffect(() => {
    const handler = () => {
      setPendingMoves((prev) => {
        if (prev.length === 0) return prev;
        return prev.slice(0, -1);
      });
    };
    window.addEventListener("iterate:undo-move", handler);
    return () => window.removeEventListener("iterate:undo-move", handler);
  }, []);

  // Handle copying annotations to clipboard as a human-readable prompt
  useEffect(() => {
    const handler = () => {
      if (pendingBatch.length === 0 && pendingMoves.length === 0) return;

      const domChanges = pendingMoves.map((m) => ({
        type: (m.reorderIndex !== undefined ? "reorder" : "move") as string,
        selector: m.selector,
        componentName: m.componentName,
        sourceLocation: m.sourceLocation,
        before: { rect: m.from },
        after: { rect: m.to },
      }));

      const text = formatBatchPrompt(pendingBatch, domChanges, iteration);
      navigator.clipboard.writeText(text);
    };
    window.addEventListener("iterate:copy-batch", handler);
    return () => window.removeEventListener("iterate:copy-batch", handler);
  }, [pendingBatch, pendingMoves, iteration]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      {/* Element picker for click/ctrl+click selection (disabled while annotating) */}
      <ElementPicker
        active={mode === "select" && !isAnnotating}
        iframeRef={iframeRef}
        selectedElements={selectedElements}
        onSelect={handleElementSelect}
      />

      {/* Marquee / rubber-band selection (disabled while annotating) */}
      <MarqueeSelect
        active={mode === "select" && !isAnnotating}
        iframeRef={iframeRef}
        onSelect={handleMarqueeSelect}
      />

      {/* Text selection capture (disabled while annotating) */}
      <TextSelect
        active={mode === "select" && !isAnnotating}
        iframeRef={iframeRef}
        onTextSelect={handleTextSelect}
      />

      {/* Marker draw tool (disabled while annotating) */}
      <MarkerDraw
        active={mode === "draw" && !isAnnotating}
        iframeRef={iframeRef}
        onDrawComplete={handleDrawComplete}
      />

      {/* Drag handler for move mode with live preview */}
      <DragHandler
        active={mode === "move"}
        iframeRef={iframeRef}
        onMove={handleMove}
        pendingMoves={pendingMoves}
        previewMode={previewMode}
      />

      {/* Selection panel (shows when elements are selected) */}
      <SelectionPanel
        selectedElements={selectedElements}
        textSelection={textSelection}
        onRemoveElement={handleRemoveElement}
        onAddToBatch={handleAddToBatch}
        onClearSelection={handleClearSelection}
      />

      {/* Pending batch indicator markers on elements */}
      {pendingBatch.map((annotation, batchIdx) => (
        <React.Fragment key={`batch-${batchIdx}`}>
          {/* Drawing strokes for marker annotations */}
          {annotation.drawing && (
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
              <path
                d={annotation.drawing.path}
                fill="none"
                stroke={annotation.drawing.strokeColor}
                strokeWidth={annotation.drawing.strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.5}
              />
            </svg>
          )}
          {/* Element markers */}
          {annotation.elements.map((el, elIdx) => (
            <div
              key={`batch-${batchIdx}-${elIdx}`}
              style={{
                position: "absolute",
                left: el.rect.x + el.rect.width / 2 - 9,
                top: el.rect.y + el.rect.height / 2 - 9,
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: annotation.drawing ? "#ef4444" : "#f59e0b",
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
              {batchIdx + 1}
            </div>
          ))}
          {/* Drawing badge when no elements were found */}
          {annotation.drawing && annotation.elements.length === 0 && (
            <div
              style={{
                position: "absolute",
                left: annotation.drawing.bounds.x + annotation.drawing.bounds.width / 2 - 9,
                top: annotation.drawing.bounds.y + annotation.drawing.bounds.height / 2 - 9,
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "#ef4444",
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
              {batchIdx + 1}
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
