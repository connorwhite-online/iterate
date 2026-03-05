import React, { useCallback, useEffect, useState } from "react";
import type { Rect, SelectedElement } from "iterate-ui-core";
import {
  generateSelector,
  getRelevantStyles,
  describeElement,
  buildAncestorPath,
  captureContextText,
  getComponentInfo,
} from "./selector.js";

export interface PickedElement extends SelectedElement {
  /** The raw DOM element (not serialized) */
  domElement: Element;
}

interface ElementPickerProps {
  active: boolean;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  selectedElements: PickedElement[];
  onSelect: (elements: PickedElement[], clickPosition?: { x: number; y: number }) => void;
  /** When true, suppress hover highlight (e.g. during marquee drag) */
  suppressHover?: boolean;
  /** Shared ref — when true, a marquee drag just finished and the click should be swallowed */
  justFinishedDragRef?: React.RefObject<boolean>;
}

/**
 * Overlay that highlights elements on hover and captures clicks.
 * Supports multi-select with Ctrl/Cmd+Click.
 * Shows React component names and source file paths when available.
 */
export function ElementPicker({
  active,
  iframeRef,
  selectedElements,
  onSelect,
  suppressHover,
  justFinishedDragRef,
}: ElementPickerProps) {
  const [highlight, setHighlight] = useState<Rect | null>(null);
  const [hoveredLabel, setHoveredLabel] = useState<string>("");
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  const getTargetDocument = useCallback(() => {
    try {
      return iframeRef.current?.contentDocument ?? document;
    } catch {
      return document;
    }
  }, [iframeRef]);

  // Clear highlight when hover is suppressed (e.g. during marquee drag)
  useEffect(() => {
    if (suppressHover) {
      setHighlight(null);
      setCursorPos(null);
    }
  }, [suppressHover]);

  useEffect(() => {
    if (!active) {
      setHighlight(null);
      setCursorPos(null);
      return;
    }

    const targetDoc = getTargetDocument();

    const isOverlayElement = (el: Element) =>
      !!el.closest("#__iterate-overlay-root__") || !!el.closest("#__iterate-markers-layer__") || !!el.closest("#__iterate-fixed-markers-layer__");

    const handleMouseMove = (e: MouseEvent) => {
      if (suppressHover) return;

      const target = e.target as Element;
      if (!target || target === targetDoc.documentElement || isOverlayElement(target)) {
        setHighlight(null);
        setCursorPos(null);
        return;
      }

      const rect = target.getBoundingClientRect();
      setHighlight({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });

      setCursorPos({ x: e.clientX, y: e.clientY });

      const { component, isComponentRoot } = getComponentInfo(target);
      if (component && isComponentRoot) {
        setHoveredLabel(`<${component}>`);
      } else {
        setHoveredLabel(describeElement(target));
      }
    };

    const handleClick = (e: MouseEvent) => {
      // A marquee drag just finished — swallow the click so we don't
      // overwrite the multi-select with a single parent element.
      if (justFinishedDragRef?.current) {
        justFinishedDragRef.current = false;
        return;
      }

      const target = e.target as Element;
      if (!target || isOverlayElement(target)) return;

      e.preventDefault();
      e.stopPropagation();

      const picked = elementToPicked(target);
      const clickPos = { x: e.clientX, y: e.clientY };
      const isMultiSelect = e.ctrlKey || e.metaKey;

      if (isMultiSelect) {
        const existingIndex = selectedElements.findIndex(
          (el) => el.selector === picked.selector
        );
        if (existingIndex >= 0) {
          const updated = [...selectedElements];
          updated.splice(existingIndex, 1);
          onSelect(updated, clickPos);
        } else {
          onSelect([...selectedElements, picked], clickPos);
        }
      } else {
        onSelect([picked], clickPos);
      }
    };

    targetDoc.addEventListener("mousemove", handleMouseMove);
    targetDoc.addEventListener("click", handleClick, { capture: true });

    return () => {
      targetDoc.removeEventListener("mousemove", handleMouseMove);
      targetDoc.removeEventListener("click", handleClick, { capture: true });
    };
  }, [active, getTargetDocument, onSelect, selectedElements, suppressHover]);

  if (!active) return null;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {/* Hover highlight */}
      {highlight && (
        <>
          <div
            style={{
              position: "absolute",
              left: highlight.x,
              top: highlight.y,
              width: highlight.width,
              height: highlight.height,
              border: "1.5px solid #6b9eff",
              backgroundColor: "rgba(107, 158, 255, 0.06)",
              borderRadius: 4,
              pointerEvents: "none",
              boxSizing: "border-box",
              transition: "all 0.1s ease",
            }}
          />
          {cursorPos && (
            <div
              style={{
                position: "absolute",
                left: cursorPos.x + 12,
                top: cursorPos.y + 16,
                background: "#6b9eff",
                color: "#fff",
                padding: "2px 8px",
                borderRadius: 4,
                fontSize: 11,
                fontFamily: "monospace",
                whiteSpace: "nowrap",
                pointerEvents: "none",
                maxWidth: 400,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {hoveredLabel}
            </div>
          )}
        </>
      )}

      {/* Selected elements (persistent green highlights) */}
      {selectedElements.map((el, i) => (
        <SelectedHighlight key={el.selector + i} el={el} />
      ))}
    </div>
  );
}

/** Live-updating highlight that re-reads the element's rect on scroll/resize */
function SelectedHighlight({ el }: { el: PickedElement }) {
  const [rect, setRect] = useState(el.rect);

  useEffect(() => {
    const update = () => {
      if (el.domElement && el.domElement.getBoundingClientRect) {
        const r = el.domElement.getBoundingClientRect();
        setRect({ x: r.x, y: r.y, width: r.width, height: r.height });
      }
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [el.domElement]);

  return (
    <div>
      <div
        style={{
          position: "fixed",
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          border: "1.5px solid #10b981",
          backgroundColor: "rgba(16, 185, 129, 0.1)",
          borderRadius: 4,
          pointerEvents: "none",
          boxSizing: "border-box",
        }}
      />
      <div
        style={{
          position: "fixed",
          left: rect.x,
          top: Math.max(0, rect.y - 26),
          background: "#10b981",
          color: "#fff",
          padding: "2px 8px",
          borderRadius: 4,
          fontSize: 10,
          fontFamily: "monospace",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          display: "flex",
          gap: 6,
          alignItems: "center",
          maxWidth: 400,
          overflow: "hidden",
        }}
      >
        <span style={{ fontWeight: 700 }}>
          {el.elementName}
        </span>
        {el.sourceLocation && (
          <span style={{ opacity: 0.7, fontSize: 9 }}>
            {el.sourceLocation}
          </span>
        )}
      </div>
    </div>
  );
}

/** Convert a DOM element to a PickedElement with full metadata */
export function elementToPicked(element: Element): PickedElement {
  const rect = element.getBoundingClientRect();
  const { component, source, isComponentRoot } = getComponentInfo(element);

  return {
    domElement: element,
    selector: generateSelector(element),
    elementName: describeElement(element),
    elementPath: buildAncestorPath(element),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    computedStyles: getRelevantStyles(element),
    nearbyText: captureContextText(element),
    componentName: isComponentRoot ? component : null,
    sourceLocation: isComponentRoot ? source : null,
  };
}
