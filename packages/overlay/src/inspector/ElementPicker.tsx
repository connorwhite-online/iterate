import React, { useCallback, useEffect, useState } from "react";
import type { Rect, SelectedElement } from "iterate-ui-core";
import {
  generateSelector,
  getRelevantStyles,
  identifyElement,
  getElementPath,
  getNearbyText,
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
  onSelect: (elements: PickedElement[]) => void;
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
}: ElementPickerProps) {
  const [highlight, setHighlight] = useState<Rect | null>(null);
  const [hoveredLabel, setHoveredLabel] = useState<string>("");

  const getTargetDocument = useCallback(() => {
    try {
      return iframeRef.current?.contentDocument ?? document;
    } catch {
      return document;
    }
  }, [iframeRef]);

  useEffect(() => {
    if (!active) {
      setHighlight(null);
      return;
    }

    const targetDoc = getTargetDocument();

    const isOverlayElement = (el: Element) =>
      !!el.closest("#__iterate-overlay-root__");

    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target || target === targetDoc.documentElement || isOverlayElement(target)) {
        setHighlight(null);
        return;
      }

      const rect = target.getBoundingClientRect();
      setHighlight({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });

      const { component, source, isComponentRoot } = getComponentInfo(target);
      if (component && isComponentRoot) {
        setHoveredLabel(source ? `<${component}> ${source}` : `<${component}>`);
      } else {
        setHoveredLabel(generateSelector(target));
      }
    };

    const handleClick = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target || isOverlayElement(target)) return;

      e.preventDefault();
      e.stopPropagation();

      const picked = elementToPicked(target);
      const isMultiSelect = e.ctrlKey || e.metaKey;

      if (isMultiSelect) {
        const existingIndex = selectedElements.findIndex(
          (el) => el.selector === picked.selector
        );
        if (existingIndex >= 0) {
          const updated = [...selectedElements];
          updated.splice(existingIndex, 1);
          onSelect(updated);
        } else {
          onSelect([...selectedElements, picked]);
        }
      } else {
        onSelect([picked]);
      }
    };

    targetDoc.addEventListener("mousemove", handleMouseMove);
    targetDoc.addEventListener("click", handleClick, { capture: true });

    return () => {
      targetDoc.removeEventListener("mousemove", handleMouseMove);
      targetDoc.removeEventListener("click", handleClick, { capture: true });
    };
  }, [active, getTargetDocument, onSelect, selectedElements]);

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
              border: "2px solid #2563eb",
              backgroundColor: "rgba(37, 99, 235, 0.08)",
              pointerEvents: "none",
              transition: "all 0.1s ease",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: highlight.x,
              top: Math.max(0, highlight.y - 26),
              background: "#2563eb",
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
        </>
      )}

      {/* Selected elements (persistent green highlights) */}
      {selectedElements.map((el, i) => (
        <div key={el.selector + i}>
          <div
            style={{
              position: "absolute",
              left: el.rect.x,
              top: el.rect.y,
              width: el.rect.width,
              height: el.rect.height,
              border: "2px solid #10b981",
              backgroundColor: "rgba(16, 185, 129, 0.1)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: el.rect.x,
              top: Math.max(0, el.rect.y - 26),
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
      ))}
    </div>
  );
}

/** Convert a DOM element to a PickedElement with full metadata */
export function elementToPicked(element: Element): PickedElement {
  const rect = element.getBoundingClientRect();
  const { component, source } = getComponentInfo(element);

  return {
    domElement: element,
    selector: generateSelector(element),
    elementName: identifyElement(element),
    elementPath: getElementPath(element),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    computedStyles: getRelevantStyles(element),
    nearbyText: getNearbyText(element),
    componentName: component,
    sourceLocation: source,
  };
}
