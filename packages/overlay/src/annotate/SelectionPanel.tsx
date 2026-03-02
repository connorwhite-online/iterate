import React, { useEffect, useRef, useState } from "react";
import type { AnnotationIntent, AnnotationSeverity, TextSelection } from "@iterate/core";
import type { PickedElement } from "../inspector/ElementPicker.js";

interface SelectionPanelProps {
  selectedElements: PickedElement[];
  textSelection: TextSelection | null;
  onRemoveElement: (index: number) => void;
  onAddToBatch: (
    comment: string,
    intent?: AnnotationIntent,
    severity?: AnnotationSeverity
  ) => void;
  onClearSelection: () => void;
}

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/**
 * Flat, greyscale annotation popup with a layered card effect.
 *
 * The header (component name + CSS drawer) sits on a recessed lower layer.
 * The main card (textarea + buttons) floats on top with rounded top corners
 * and a subtle upward drop-shadow, so the CSS drawer feels like it slides
 * out from behind the main card.
 */
export function SelectionPanel({
  selectedElements,
  textSelection,
  onAddToBatch,
  onClearSelection,
}: SelectionPanelProps) {
  const [comment, setComment] = useState("");
  const [expandedCSS, setExpandedCSS] = useState<Set<number>>(new Set());
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const hasSelection = selectedElements.length > 0 || textSelection !== null;

  useEffect(() => {
    if (hasSelection) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [hasSelection]);

  if (!hasSelection) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;
    onAddToBatch(comment.trim());
    setComment("");
    setExpandedCSS(new Set());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSubmit(e);
    }
    if (e.key === "Escape") {
      onClearSelection();
    }
  };

  const toggleCSS = (index: number) => {
    setExpandedCSS((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  // Build display items from selected elements + text selection fallback
  const displayItems: Array<{
    name: string;
    styles: Record<string, string>;
    key: string;
  }> = [];

  selectedElements.forEach((el, i) => {
    displayItems.push({
      name: el.componentName || el.elementName,
      styles: el.computedStyles || {},
      key: el.selector + i,
    });
  });

  if (textSelection && selectedElements.length === 0) {
    const ce = textSelection.containingElement;
    displayItems.push({
      name: ce.componentName || ce.elementName,
      styles: ce.computedStyles || {},
      key: "text-selection",
    });
  }

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 10002,
        pointerEvents: "auto",
        width: 300,
        maxHeight: "80vh",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid #e0e0e0",
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          fontFamily: FONT_STACK,
        }}
      >
        {/* Header layer — recessed lower layer */}
        <div
          style={{
            background: "#f7f7f7",
            padding: "8px 12px",
          }}
        >
          {displayItems.map((item, i) => {
            const isExpanded = expandedCSS.has(i);
            const styleEntries = Object.entries(item.styles);
            return (
              <div key={item.key}>
                <button
                  type="button"
                  onClick={() => toggleCSS(i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                    padding: "4px 0",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#333",
                    fontFamily: FONT_STACK,
                    textAlign: "left",
                  }}
                >
                  {item.name}
                  <span
                    style={{
                      display: "inline-flex",
                      fontSize: 8,
                      color: "#999",
                      transition: "transform 0.15s ease",
                      transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                      flexShrink: 0,
                      marginLeft: 6,
                    }}
                  >
                    {"\u25BC"}
                  </span>
                </button>

                {/* CSS drawer — slides out from behind the main card */}
                <div
                  style={{
                    maxHeight: isExpanded ? 200 : 0,
                    overflow: "hidden",
                    transition: "max-height 0.2s ease",
                  }}
                >
                  <div
                    style={{
                      padding: "6px 8px",
                      marginTop: 4,
                      marginBottom: 4,
                      background: "#efefef",
                      borderRadius: 4,
                      fontSize: 10,
                      fontFamily: "monospace",
                      color: "#666",
                      lineHeight: 1.7,
                      maxHeight: 180,
                      overflow: "auto",
                    }}
                  >
                    {styleEntries.map(([prop, val]) => (
                      <div key={prop}>
                        <span style={{ color: "#999" }}>{prop}:</span> {val}
                      </div>
                    ))}
                    {styleEntries.length === 0 && (
                      <div style={{ color: "#999", fontStyle: "italic" }}>
                        No computed styles
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Main card layer — floats on top with upward shadow */}
        <div
          style={{
            position: "relative",
            background: "#fff",
            borderRadius: "12px 12px 0 0",
            boxShadow: "0 -3px 8px rgba(0,0,0,0.06)",
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {/* Comment */}
          <textarea
            ref={inputRef}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What should change here?"
            rows={3}
            style={{
              width: "100%",
              background: "#fff",
              border: "1px solid #e0e0e0",
              borderRadius: 6,
              color: "#333",
              padding: 8,
              fontSize: 13,
              fontFamily: FONT_STACK,
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box",
            }}
          />

          {/* Actions — right-aligned, 8px padding */}
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              padding: 8,
            }}
          >
            <button
              type="button"
              onClick={onClearSelection}
              style={{
                padding: "6px 14px",
                background: "transparent",
                border: "1px solid #e0e0e0",
                borderRadius: 6,
                color: "#888",
                cursor: "pointer",
                fontSize: 12,
                fontFamily: FONT_STACK,
              }}
            >
              Discard
            </button>
            <button
              type="submit"
              disabled={!comment.trim()}
              style={{
                padding: "6px 14px",
                background: comment.trim() ? "#333" : "#f0f0f0",
                border: "1px solid " + (comment.trim() ? "#333" : "#e0e0e0"),
                borderRadius: 6,
                color: comment.trim() ? "#fff" : "#999",
                cursor: comment.trim() ? "pointer" : "default",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: FONT_STACK,
              }}
            >
              Add
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
