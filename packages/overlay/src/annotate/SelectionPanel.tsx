import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AnnotationIntent, AnnotationSeverity, TextSelection } from "iterate-ui-core";
import type { PickedElement } from "../inspector/ElementPicker.js";
import { TrashIcon } from "../panel/icons.js";

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
  clickPosition?: { x: number; y: number } | null;
  /** When true, the header shows "Path" with no dropdown (marker/draw tool) */
  isDrawing?: boolean;
  /** Pre-fill comment when editing an existing annotation */
  initialComment?: string;
  /** Shown as a left-aligned trash button in the toolbar (for editing existing annotations) */
  onDelete?: () => void;
}

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

const CHEVRON_SVG = (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none">
    <path d="M20 9L12.7071 16.2929C12.3166 16.6834 11.6834 16.6834 11.2929 16.2929L4 9" stroke="#999" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

type AnimState = "hidden" | "entering" | "visible" | "exiting";

/**
 * Flat, greyscale annotation popup with a layered card effect.
 *
 * The header (component name + CSS drawer) sits on a recessed lower layer.
 * The main card (textarea + buttons) floats on top with rounded top corners,
 * so the CSS drawer feels like it slides out from behind the main card.
 *
 * Animates in with a springy scale-up and fades out on dismiss.
 */
export function SelectionPanel({
  selectedElements,
  textSelection,
  onAddToBatch,
  onClearSelection,
  clickPosition,
  isDrawing,
  initialComment,
  onDelete,
}: SelectionPanelProps) {
  const [comment, setComment] = useState("");
  const [expandedCSS, setExpandedCSS] = useState<Set<number>>(new Set());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [panelHeight, setPanelHeight] = useState(0);
  const [animState, setAnimState] = useState<AnimState>("hidden");
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasSelection = selectedElements.length > 0 || textSelection !== null || isDrawing === true;

  // Reset comment to clean slate (or initial value) whenever selection opens
  const prevHasSelectionRef = useRef(false);
  useEffect(() => {
    if (hasSelection && !prevHasSelectionRef.current) {
      setComment(initialComment ?? "");
      setExpandedCSS(new Set());
    }
    prevHasSelectionRef.current = hasSelection;
  }, [hasSelection, initialComment]);

  // Drive mount/unmount animation based on hasSelection
  useEffect(() => {
    if (hasSelection) {
      // Clear any pending exit timer
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      setAnimState("entering");
      // Double-rAF to ensure the entering state is painted before transitioning
      let frame2 = 0;
      const frame1 = requestAnimationFrame(() => {
        frame2 = requestAnimationFrame(() => {
          setAnimState("visible");
        });
      });
      return () => {
        cancelAnimationFrame(frame1);
        cancelAnimationFrame(frame2);
      };
    } else {
      setAnimState((prev) => {
        if (prev === "hidden") return "hidden";
        return "exiting";
      });
      exitTimerRef.current = setTimeout(() => {
        setAnimState("hidden");
        exitTimerRef.current = null;
      }, 200);
    }
  }, [hasSelection]);

  // Cleanup exit timer on unmount
  useEffect(() => {
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (hasSelection) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [hasSelection]);

  // Measure actual panel height so we can clamp position within the viewport
  useLayoutEffect(() => {
    if (animState === "hidden") return;
    if (!panelRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setPanelHeight(entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height);
      }
    });
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, [animState]);

  if (animState === "hidden") return null;

  const isShown = animState === "visible";

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

  if (isDrawing) {
    // Marker tool: just show "Path" with no dropdown
    displayItems.push({
      name: "Path",
      styles: {},
      key: "drawing-path",
    });
  } else {
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
  }

  // Position near click, clamped to viewport bounds using measured panel height
  const panelWidth = 300;
  const margin = 16;
  const maxPanelHeight = window.innerHeight * 0.8; // matches maxHeight: "80vh"
  const effectiveHeight = panelHeight > 0 ? Math.min(panelHeight, maxPanelHeight) : maxPanelHeight;
  const pos = clickPosition ?? { x: window.innerWidth - margin - panelWidth, y: window.innerHeight / 2 };
  // Place to the right of the click by default; flip left if it would overflow
  let left = pos.x + margin;
  if (left + panelWidth + margin > window.innerWidth) {
    left = pos.x - panelWidth - margin;
  }
  left = Math.max(margin, Math.min(left, window.innerWidth - panelWidth - margin));
  // Vertically center on the click point, then clamp so the full panel stays in viewport
  let top = pos.y - effectiveHeight / 2;
  top = Math.max(margin, Math.min(top, window.innerHeight - effectiveHeight - margin));

  return (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 10002,
        pointerEvents: isShown ? "auto" : "none",
        width: panelWidth,
        maxHeight: "80vh",
        opacity: isShown ? 1 : 0,
        transform: isShown ? "scale(1)" : "scale(0.92)",
        transition: `opacity 0.2s ease, transform 0.25s ${SPRING}`,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          borderRadius: 12,
          overflow: "hidden",
          border: "none",
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          fontFamily: FONT_STACK,
          background: "#f7f7f7",
          padding: 4,
        }}
      >
        {/* Header layer — recessed lower layer */}
        <div
          style={{
            background: "#f7f7f7",
            padding: "4px 8px",
            maxHeight: 400,
            overflowY: "auto",
          }}
        >
          {displayItems.map((item, i) => {
            const isExpanded = expandedCSS.has(i);
            const styleEntries = Object.entries(item.styles);
            const hasStyles = styleEntries.length > 0;
            const isPathOnly = isDrawing;
            return (
              <div key={item.key}>
                <button
                  type="button"
                  onClick={() => !isPathOnly && hasStyles && toggleCSS(i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                    padding: "4px 0",
                    background: "transparent",
                    border: "none",
                    cursor: isPathOnly || !hasStyles ? "default" : "pointer",
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#333",
                    fontFamily: FONT_STACK,
                    textAlign: "left",
                  }}
                >
                  {item.name}
                  {!isPathOnly && hasStyles && (
                    <span
                      style={{
                        display: "inline-flex",
                        color: "#999",
                        transition: "transform 0.15s ease",
                        transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                        flexShrink: 0,
                        marginLeft: 6,
                      }}
                    >
                      {CHEVRON_SVG}
                    </span>
                  )}
                </button>

                {/* CSS drawer — slides out from behind the main card */}
                {!isPathOnly && hasStyles && (
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
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Main card layer — floats on top */}
        <div
          style={{
            position: "relative",
            background: "#fff",
            border: "1px solid #e0e0e0",
            borderRadius: 10,
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {/* Comment */}
          <textarea
            ref={inputRef}
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = e.target.scrollHeight + "px";
            }}
            onKeyDown={handleKeyDown}
            placeholder="Change this..."
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
              resize: "none",
              outline: "none",
              boxSizing: "border-box",
              overflow: "hidden",
            }}
          />

          {/* Actions — trash left, Discard + Add right */}
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            {/* Left side: trash button (only when editing) */}
            {onDelete ? (
              <TrashButton onClick={onDelete} />
            ) : (
              <div />
            )}

            {/* Right side: Discard + Add */}
            <div style={{ display: "flex", gap: 8 }}>
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
                {onDelete ? "Update" : "Add"}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

/** Square trash button with rounded hover background */
function TrashButton({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        borderRadius: 8,
        border: "none",
        background: hovered ? "#f0f0f0" : "transparent",
        color: "#888",
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
        transition: "background 0.1s ease",
      }}
    >
      <TrashIcon size={16} />
    </button>
  );
}
