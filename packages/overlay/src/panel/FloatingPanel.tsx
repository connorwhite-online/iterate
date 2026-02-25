import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ToolMode } from "../IterateOverlay.js";

export interface FloatingPanelProps {
  mode: ToolMode;
  onModeChange: (mode: ToolMode) => void;
  visible: boolean;
  onVisibilityChange: (visible: boolean) => void;
  annotationCount?: number;
  onSubmit?: () => void;
  submitDisabled?: boolean;
}

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const PANEL_MARGIN = 16;
const HOTKEY = "Alt+Shift+I";

/**
 * Floating toolbar panel that can be dragged to any corner of the screen.
 * Features hide/show with hotkey support.
 */
export function FloatingPanel({
  mode,
  onModeChange,
  visible,
  onVisibilityChange,
  annotationCount = 0,
  onSubmit,
  submitDisabled,
}: FloatingPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [corner, setCorner] = useState<Corner>("bottom-right");
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [showReappearMenu, setShowReappearMenu] = useState(false);

  // Hotkey: Alt+Shift+I to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.key === "I") {
        e.preventDefault();
        onVisibilityChange(!visible);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, onVisibilityChange]);

  // Drag start
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      const panel = panelRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      setIsDragging(true);
      setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      setDragPos({ x: rect.left, y: rect.top });
      e.preventDefault();
    },
    []
  );

  // Drag move + drop to nearest corner
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setDragPos({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y,
      });
    };

    const handleMouseUp = (e: MouseEvent) => {
      setIsDragging(false);
      // Snap to nearest corner
      const x = e.clientX;
      const y = e.clientY;
      const midX = window.innerWidth / 2;
      const midY = window.innerHeight / 2;
      const newCorner: Corner =
        x < midX
          ? y < midY
            ? "top-left"
            : "bottom-left"
          : y < midY
            ? "top-right"
            : "bottom-right";
      setCorner(newCorner);
      setDragPos(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  // Compute position
  const positionStyle = dragPos
    ? { left: dragPos.x, top: dragPos.y }
    : getCornerPosition(corner);

  if (!visible) {
    // Show a tiny "reopen" pill
    return (
      <div
        style={{
          position: "fixed",
          ...getCornerPosition(corner),
          zIndex: 10001,
          pointerEvents: "auto",
        }}
      >
        <button
          onClick={() => onVisibilityChange(true)}
          title={`Show iterate panel (${HOTKEY})`}
          style={{
            background: "#1a1a2e",
            border: "1px solid #2a2a4a",
            borderRadius: 16,
            color: "#5b9bff",
            padding: "4px 10px",
            fontSize: 11,
            cursor: "pointer",
            opacity: 0.6,
            transition: "opacity 0.2s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}
        >
          iterate
        </button>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      onMouseDown={handleMouseDown}
      style={{
        position: "fixed",
        ...positionStyle,
        zIndex: 10001,
        pointerEvents: "auto",
        background: "#1a1a2e",
        border: "1px solid #2a2a4a",
        borderRadius: 12,
        padding: "8px 10px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        cursor: isDragging ? "grabbing" : "grab",
        userSelect: "none",
        transition: isDragging ? "none" : "left 0.3s ease, top 0.3s ease, right 0.3s ease, bottom 0.3s ease",
        minWidth: 140,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#5b9bff",
            letterSpacing: "0.04em",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          }}
        >
          iterate
        </span>

        <div style={{ display: "flex", gap: 2 }}>
          {/* Hide button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowReappearMenu(!showReappearMenu);
            }}
            title="Hide panel"
            style={iconButtonStyle}
          >
            {showReappearMenu ? "\u00d7" : "\u2212"}
          </button>
        </div>
      </div>

      {/* Reappear menu */}
      {showReappearMenu && (
        <div
          style={{
            background: "#111128",
            borderRadius: 6,
            padding: 6,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <span style={{ fontSize: 10, color: "#555", padding: "2px 4px" }}>
            Hide panel — reopen with:
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onVisibilityChange(false);
              setShowReappearMenu(false);
            }}
            style={menuItemStyle}
          >
            {HOTKEY} (hotkey)
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onVisibilityChange(false);
              setShowReappearMenu(false);
            }}
            style={menuItemStyle}
          >
            Small pill button
          </button>
        </div>
      )}

      {/* Tool buttons */}
      <div style={{ display: "flex", gap: 3 }}>
        <ToolButton
          label="Select"
          icon="S"
          active={mode === "select"}
          onClick={() => onModeChange("select")}
        />
        <ToolButton
          label="Annotate"
          icon="A"
          active={mode === "annotate"}
          onClick={() => onModeChange("annotate")}
        />
        <ToolButton
          label="Move"
          icon="M"
          active={mode === "move"}
          onClick={() => onModeChange("move")}
        />
      </div>

      {/* Annotation count + Submit */}
      {annotationCount > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "#666",
              textAlign: "center",
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            }}
          >
            {annotationCount} annotation{annotationCount !== 1 ? "s" : ""}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSubmit?.();
            }}
            disabled={submitDisabled}
            style={{
              width: "100%",
              padding: "5px 8px",
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 6,
              border: submitDisabled
                ? "1px solid #2a2a4a"
                : "1px solid #2563eb",
              background: submitDisabled
                ? "transparent"
                : "#2563eb",
              color: submitDisabled ? "#555" : "#fff",
              cursor: submitDisabled ? "default" : "pointer",
              opacity: submitDisabled ? 0.5 : 1,
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              transition: "all 0.15s",
            }}
          >
            {submitDisabled ? "Submitted" : "Submit to Agent"}
          </button>
        </div>
      )}
    </div>
  );
}

function ToolButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={label}
      style={{
        flex: 1,
        padding: "4px 6px",
        fontSize: 11,
        fontWeight: active ? 600 : 400,
        borderRadius: 6,
        border: active ? "1px solid #2563eb" : "1px solid #2a2a4a",
        background: active ? "#2563eb33" : "transparent",
        color: active ? "#5b9bff" : "#777",
        cursor: "pointer",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {label}
    </button>
  );
}

function getCornerPosition(corner: Corner): React.CSSProperties {
  switch (corner) {
    case "top-left":
      return { left: PANEL_MARGIN, top: PANEL_MARGIN };
    case "top-right":
      return { right: PANEL_MARGIN, top: PANEL_MARGIN };
    case "bottom-left":
      return { left: PANEL_MARGIN, bottom: PANEL_MARGIN };
    case "bottom-right":
      return { right: PANEL_MARGIN, bottom: PANEL_MARGIN };
  }
}

const iconButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#555",
  cursor: "pointer",
  fontSize: 14,
  padding: "0 4px",
  lineHeight: 1,
  borderRadius: 4,
};

const menuItemStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#999",
  cursor: "pointer",
  fontSize: 11,
  padding: "4px 8px",
  textAlign: "left",
  borderRadius: 4,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};
