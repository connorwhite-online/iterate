import React, { useCallback, useEffect, useState } from "react";
import type { TextSelection } from "@iterate/core";
import { elementToPicked, type PickedElement } from "./ElementPicker.js";

interface TextSelectProps {
  active: boolean;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onTextSelect: (selection: TextSelection | null) => void;
}

/**
 * Captures text selections within the iframe.
 * When the user highlights text using native browser selection,
 * captures the text, containing element, and range offsets.
 */
export function TextSelect({
  active,
  iframeRef,
  onTextSelect,
}: TextSelectProps) {
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedText, setSelectedText] = useState<string>("");

  const getTargetDocument = useCallback(() => {
    try {
      return iframeRef.current?.contentDocument ?? document;
    } catch {
      return document;
    }
  }, [iframeRef]);

  useEffect(() => {
    if (!active) {
      setTooltipPos(null);
      setSelectedText("");
      return;
    }

    const targetDoc = getTargetDocument();

    const handleSelectionChange = () => {
      const selection = targetDoc.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        setTooltipPos(null);
        setSelectedText("");
        onTextSelect(null);
        return;
      }

      const range = selection.getRangeAt(0);
      const text = selection.toString().trim();

      if (!text || text.length < 2) {
        setTooltipPos(null);
        setSelectedText("");
        return;
      }

      // Find the containing element
      const container = range.commonAncestorContainer;
      const element = container.nodeType === Node.ELEMENT_NODE
        ? (container as Element)
        : container.parentElement;

      if (!element) return;

      const picked = elementToPicked(element);
      const rect = range.getBoundingClientRect();

      setTooltipPos({
        x: rect.x + rect.width / 2,
        y: rect.y - 4,
      });
      setSelectedText(text);

      onTextSelect({
        text,
        containingElement: {
          selector: picked.selector,
          elementName: picked.elementName,
          elementPath: picked.elementPath,
          rect: picked.rect,
          computedStyles: picked.computedStyles,
          nearbyText: picked.nearbyText,
          componentName: picked.componentName,
          sourceLocation: picked.sourceLocation,
        },
        startOffset: range.startOffset,
        endOffset: range.endOffset,
      });
    };

    // Listen for selection changes with a small debounce
    let timeout: ReturnType<typeof setTimeout>;
    const debouncedHandler = () => {
      clearTimeout(timeout);
      timeout = setTimeout(handleSelectionChange, 150);
    };

    targetDoc.addEventListener("selectionchange", debouncedHandler);

    // Also listen for mouseup to catch the final selection state
    const mouseupHandler = () => {
      setTimeout(handleSelectionChange, 50);
    };
    targetDoc.addEventListener("mouseup", mouseupHandler);

    return () => {
      clearTimeout(timeout);
      targetDoc.removeEventListener("selectionchange", debouncedHandler);
      targetDoc.removeEventListener("mouseup", mouseupHandler);
    };
  }, [active, getTargetDocument, onTextSelect]);

  if (!active || !tooltipPos || !selectedText) return null;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: tooltipPos.x,
          top: tooltipPos.y,
          transform: "translate(-50%, -100%)",
          background: "#7c3aed",
          color: "#fff",
          padding: "3px 8px",
          borderRadius: 4,
          fontSize: 10,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          maxWidth: 250,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        "{selectedText.slice(0, 50)}{selectedText.length > 50 ? "..." : ""}"
      </div>
    </div>
  );
}
