import React, { useEffect, useRef, useState } from "react";
import type { AnnotationIntent, AnnotationSeverity } from "@iterate/core";

interface AnnotationDialogProps {
  position: { x: number; y: number };
  onSubmit: (comment: string, intent?: AnnotationIntent, severity?: AnnotationSeverity) => void;
  onCancel: () => void;
}

/**
 * Dialog that appears after drawing an annotation.
 * Positioned near the drawing, allows the user to enter a text comment.
 */
export function AnnotationDialog({
  position,
  onSubmit,
  onCancel,
}: AnnotationDialogProps) {
  const [comment, setComment] = useState("");
  const [intent, setIntent] = useState<AnnotationIntent>("change");
  const [severity, setSeverity] = useState<AnnotationSeverity>("suggestion");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (comment.trim()) {
      onSubmit(comment.trim(), intent, severity);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSubmit(e);
    }
    if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        left: position.x,
        top: position.y + 8,
        zIndex: 10000,
        pointerEvents: "auto",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: "#1a1a2e",
          border: "1px solid #2a2a4a",
          borderRadius: 8,
          padding: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          width: 280,
        }}
      >
        {/* Intent & severity chips */}
        <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
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
            borderRadius: 4,
            color: "#fafafa",
            padding: 8,
            fontSize: 13,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            resize: "vertical",
            outline: "none",
          }}
        />
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 8,
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "4px 12px",
              background: "transparent",
              border: "1px solid #2a2a4a",
              borderRadius: 4,
              color: "#888",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            style={{
              padding: "4px 12px",
              background: "#2563eb",
              border: "1px solid #2563eb",
              borderRadius: 4,
              color: "#fff",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Add annotation
          </button>
        </div>
        <div style={{ fontSize: 10, color: "#555", marginTop: 4 }}>
          Cmd+Enter to submit · Esc to cancel
        </div>
      </form>
    </div>
  );
}
