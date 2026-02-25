import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  AnnotationData,
  AnnotationIntent,
  AnnotationSeverity,
  SelectedElement,
  TextSelection,
  Rect,
} from "@iterate/core";
import { ElementPicker, type PickedElement } from "./inspector/ElementPicker.js";
import { MarqueeSelect } from "./inspector/MarqueeSelect.js";
import { TextSelect } from "./inspector/TextSelect.js";
import { SelectionPanel } from "./annotate/SelectionPanel.js";
import { DragHandler } from "./manipulate/DragHandler.js";
import { DaemonConnection } from "./transport/connection.js";

export type ToolMode = "select" | "move";

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
  /** Callback to submit the pending batch */
  onSubmitBatch?: () => void;
}

/** Annotation waiting to be submitted (local-only until batch submit) */
interface PendingAnnotation {
  elements: SelectedElement[];
  textSelection?: TextSelection;
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
}: IterateOverlayProps) {
  const connectionRef = useRef<DaemonConnection | null>(null);

  // Selection state
  const [selectedElements, setSelectedElements] = useState<PickedElement[]>([]);
  const [textSelection, setTextSelection] = useState<TextSelection | null>(null);

  // Pending batch (accumulated annotations not yet submitted)
  const [pendingBatch, setPendingBatch] = useState<PendingAnnotation[]>([]);

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
      if (selectedElements.length === 0 && !textSelection) return;

      const annotation: PendingAnnotation = {
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
        comment,
        intent,
        severity,
      };

      setPendingBatch((prev) => [...prev, annotation]);

      // Clear selection after adding to batch
      setSelectedElements([]);
      setTextSelection(null);
    },
    [selectedElements, textSelection]
  );

  // Clear selection
  const handleClearSelection = useCallback(() => {
    setSelectedElements([]);
    setTextSelection(null);
  }, []);

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

  // Expose batch submission to parent (called by Submit button in toolbar)
  useEffect(() => {
    const handler = () => {
      if (pendingBatch.length === 0 || !connectionRef.current) return;

      connectionRef.current.send({
        type: "batch:submit",
        payload: {
          iteration,
          annotations: pendingBatch.map((a) => ({
            iteration,
            elements: a.elements,
            textSelection: a.textSelection,
            comment: a.comment,
            intent: a.intent,
            severity: a.severity,
          })),
          domChanges: [], // DOM changes are already tracked by the daemon
        },
      });

      setPendingBatch([]);
    };

    window.addEventListener("iterate:submit-batch", handler);
    return () => window.removeEventListener("iterate:submit-batch", handler);
  }, [pendingBatch, iteration]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      {/* Element picker for click/ctrl+click selection */}
      <ElementPicker
        active={mode === "select"}
        iframeRef={iframeRef}
        selectedElements={selectedElements}
        onSelect={handleElementSelect}
      />

      {/* Marquee / rubber-band selection */}
      <MarqueeSelect
        active={mode === "select"}
        iframeRef={iframeRef}
        onSelect={handleMarqueeSelect}
      />

      {/* Text selection capture */}
      <TextSelect
        active={mode === "select"}
        iframeRef={iframeRef}
        onTextSelect={handleTextSelect}
      />

      {/* Drag handler for move mode */}
      <DragHandler
        active={mode === "move"}
        iframeRef={iframeRef}
        onMove={handleMove}
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
      {pendingBatch.map((annotation, batchIdx) =>
        annotation.elements.map((el, elIdx) => (
          <div
            key={`batch-${batchIdx}-${elIdx}`}
            style={{
              position: "absolute",
              left: el.rect.x + el.rect.width - 8,
              top: el.rect.y - 8,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "#f59e0b",
              color: "#000",
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
        ))
      )}
    </div>
  );
}
