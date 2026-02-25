import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ToolMode } from "../IterateOverlay.js";
import { CursorIcon, MoveIcon, SendIcon, MinimizeIcon, LogoIcon } from "./icons.js";

export interface FloatingPanelProps {
  mode: ToolMode;
  onModeChange: (mode: ToolMode) => void;
  visible: boolean;
  onVisibilityChange: (visible: boolean) => void;
  /** Number of annotations in the pending batch */
  batchCount?: number;
  /** Called when user clicks Submit */
  onSubmitBatch?: () => void;
}

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const PANEL_MARGIN = 16;
const HOTKEY = "Alt+Shift+I";

/**
 * Floating toolbar panel with icon-based tools.
 * Can be dragged to any corner of the screen.
 * Shows a Submit button when there are pending annotations.
 */
export function FloatingPanel({
  mode,
  onModeChange,
  visible,
  onVisibilityChange,
  batchCount = 0,
  onSubmitBatch,
}: FloatingPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [corner, setCorner] = useState<Corner>("bottom-right");
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

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

  const positionStyle = dragPos
    ? { left: dragPos.x, top: dragPos.y }
    : getCornerPosition(corner);

  if (!visible) {
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
            padding: "6px 10px",
            fontSize: 11,
            cursor: "pointer",
            opacity: 0.6,
            transition: "opacity 0.2s",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}
        >
          <LogoIcon size={14} color="#5b9bff" />
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
        borderRadius: 10,
        padding: "6px 8px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        gap: 4,
        cursor: isDragging ? "grabbing" : "grab",
        userSelect: "none",
        transition: isDragging ? "none" : "left 0.3s ease, top 0.3s ease, right 0.3s ease, bottom 0.3s ease",
      }}
    >
      {/* Brand mark */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingRight: 4,
          borderRight: "1px solid #2a2a4a",
          marginRight: 2,
        }}
      >
        <LogoIcon size={14} color="#5b9bff" />
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "#5b9bff",
            letterSpacing: "0.04em",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          }}
        >
          iterate
        </span>
      </div>

      {/* Tool buttons */}
      <IconButton
        icon={<CursorIcon size={14} />}
        label="Select"
        active={mode === "select"}
        onClick={() => onModeChange("select")}
      />
      <IconButton
        icon={<MoveIcon size={14} />}
        label="Move"
        active={mode === "move"}
        onClick={() => onModeChange("move")}
      />

      {/* Submit button (conditional) */}
      {batchCount > 0 && (
        <>
          <div style={{ width: 1, height: 20, background: "#2a2a4a", margin: "0 2px" }} />
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSubmitBatch?.();
            }}
            title={`Submit ${batchCount} annotation${batchCount !== 1 ? "s" : ""}`}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid #10b981",
              background: "#10b98133",
              color: "#10b981",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            }}
          >
            <SendIcon size={13} color="#10b981" />
            Submit
            <span
              style={{
                background: "#10b981",
                color: "#000",
                fontSize: 9,
                fontWeight: 700,
                borderRadius: 8,
                padding: "0 5px",
                lineHeight: "16px",
                minWidth: 16,
                textAlign: "center",
              }}
            >
              {batchCount}
            </span>
          </button>
        </>
      )}

      {/* Minimize button */}
      <div style={{ width: 1, height: 20, background: "#2a2a4a", margin: "0 2px" }} />
      <button
        onClick={(e) => {
          e.stopPropagation();
          onVisibilityChange(false);
        }}
        title={`Hide panel (${HOTKEY})`}
        style={{
          background: "transparent",
          border: "none",
          color: "#555",
          cursor: "pointer",
          padding: "2px",
          display: "flex",
          alignItems: "center",
          borderRadius: 4,
        }}
      >
        <MinimizeIcon size={14} color="#555" />
      </button>
    </div>
  );
}

function IconButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
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
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 26,
        borderRadius: 6,
        border: active ? "1px solid #2563eb" : "1px solid transparent",
        background: active ? "#2563eb33" : "transparent",
        color: active ? "#5b9bff" : "#666",
        cursor: "pointer",
        transition: "all 0.1s",
      }}
    >
      {icon}
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
