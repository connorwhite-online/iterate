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

/**
 * Panel showing selected elements with component names, source paths,
 * and a comment form for creating annotations.
 * Replaces the old AnnotationDialog.
 */
export function SelectionPanel({
  selectedElements,
  textSelection,
  onRemoveElement,
  onAddToBatch,
  onClearSelection,
}: SelectionPanelProps) {
  const [comment, setComment] = useState("");
  const [intent, setIntent] = useState<AnnotationIntent>("change");
  const [severity, setSeverity] = useState<AnnotationSeverity>("suggestion");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const hasSelection = selectedElements.length > 0 || textSelection !== null;

  useEffect(() => {
    if (hasSelection) {
      // Small delay to let the panel render before focusing
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [hasSelection]);

  if (!hasSelection) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;
    onAddToBatch(comment.trim(), intent, severity);
    setComment("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSubmit(e);
    }
    if (e.key === "Escape") {
      onClearSelection();
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 10002,
        pointerEvents: "auto",
        width: 320,
        maxHeight: "80vh",
        overflow: "auto",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: "#1a1a2e",
          border: "1px solid #2a2a4a",
          borderRadius: 10,
          padding: 14,
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#e0e0e0",
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            }}
          >
            {selectedElements.length} element{selectedElements.length !== 1 ? "s" : ""} selected
            {textSelection ? " + text" : ""}
          </span>
          <button
            type="button"
            onClick={onClearSelection}
            style={{
              background: "transparent",
              border: "none",
              color: "#666",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              padding: "0 4px",
            }}
          >
            {"\u00d7"}
          </button>
        </div>

        {/* Selected elements list */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            maxHeight: 200,
            overflow: "auto",
          }}
        >
          {selectedElements.map((el, i) => (
            <div
              key={el.selector + i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 8px",
                background: "#111128",
                borderRadius: 6,
                fontSize: 11,
                fontFamily: "monospace",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    color: "#10b981",
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {el.componentName ? `<${el.componentName}>` : el.elementName}
                </div>
                {el.sourceLocation && (
                  <div
                    style={{
                      color: "#666",
                      fontSize: 10,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {el.sourceLocation}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onRemoveElement(i)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#555",
                  cursor: "pointer",
                  fontSize: 14,
                  lineHeight: 1,
                  padding: "0 2px",
                  flexShrink: 0,
                }}
              >
                {"\u00d7"}
              </button>
            </div>
          ))}

          {/* Text selection indicator */}
          {textSelection && (
            <div
              style={{
                padding: "4px 8px",
                background: "#111128",
                borderRadius: 6,
                fontSize: 11,
              }}
            >
              <div
                style={{
                  color: "#7c3aed",
                  fontWeight: 600,
                  fontFamily: "monospace",
                }}
              >
                Text selection
              </div>
              <div
                style={{
                  color: "#999",
                  fontSize: 10,
                  fontStyle: "italic",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                "{textSelection.text.slice(0, 60)}{textSelection.text.length > 60 ? "..." : ""}"
              </div>
            </div>
          )}
        </div>

        {/* Intent & severity chips */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {(["fix", "change", "question", "approve"] as const).map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIntent(i)}
              style={{
                padding: "2px 8px",
                fontSize: 11,
                borderRadius: 10,
                border: intent === i ? "1px solid #2563eb" : "1px solid #2a2a4a",
                background: intent === i ? "#2563eb22" : "transparent",
                color: intent === i ? "#5b9bff" : "#777",
                cursor: "pointer",
              }}
            >
              {i}
            </button>
          ))}
          <span style={{ width: 1, background: "#2a2a4a", margin: "0 2px" }} />
          {(["suggestion", "important", "blocking"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSeverity(s)}
              style={{
                padding: "2px 8px",
                fontSize: 11,
                borderRadius: 10,
                border: severity === s ? "1px solid #f59e0b" : "1px solid #2a2a4a",
                background: severity === s ? "#f59e0b22" : "transparent",
                color: severity === s ? "#f59e0b" : "#777",
                cursor: "pointer",
              }}
            >
              {s}
            </button>
          ))}
        </div>

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
            background: "#0a0a1a",
            border: "1px solid #2a2a4a",
            borderRadius: 6,
            color: "#fafafa",
            padding: 8,
            fontSize: 13,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            resize: "vertical",
            outline: "none",
          }}
        />

        {/* Actions */}
        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onClearSelection}
            style={{
              padding: "6px 14px",
              background: "transparent",
              border: "1px solid #2a2a4a",
              borderRadius: 6,
              color: "#888",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!comment.trim()}
            style={{
              padding: "6px 14px",
              background: comment.trim() ? "#10b981" : "#1a2a1a",
              border: "1px solid #10b981",
              borderRadius: 6,
              color: comment.trim() ? "#fff" : "#555",
              cursor: comment.trim() ? "pointer" : "default",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Add to batch
          </button>
        </div>

        <div style={{ fontSize: 10, color: "#555" }}>
          Cmd+Enter to add · Esc to cancel · Ctrl+Click to multi-select
        </div>
      </form>
    </div>
  );
}
