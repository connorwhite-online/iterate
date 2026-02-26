import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ToolMode } from "../IterateOverlay.js";
import { CursorIcon, MoveIcon, SendIcon, CloseIcon, LogoIcon, TrashIcon, CopyIcon } from "./icons.js";

export interface FloatingPanelProps {
  mode: ToolMode;
  onModeChange: (mode: ToolMode) => void;
  visible: boolean;
  onVisibilityChange: (visible: boolean) => void;
  /** Number of annotations in the pending batch */
  batchCount?: number;
  /** Called when user clicks Submit */
  onSubmitBatch?: () => void;
  /** Called when user clicks Trash (clear all annotations) */
  onClearBatch?: () => void;
  /** Called when user clicks Copy (copy annotations to clipboard) */
  onCopyBatch?: () => void;
}

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const PANEL_MARGIN = 16;
const HOTKEY = "Alt+Shift+I";
const ICON_SIZE = 24;

// Spring-like cubic bezier
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/**
 * Floating toolbar panel with icon-based tools.
 * Single container that animates between collapsed (logo only) and expanded states.
 * Can be dragged to any corner of the screen.
 */
export function FloatingPanel({
  mode,
  onModeChange,
  visible,
  onVisibilityChange,
  batchCount = 0,
  onSubmitBatch,
  onClearBatch,
  onCopyBatch,
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

  // Drag start — only from the panel background, not buttons
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

  const positionTransition = isDragging
    ? "none"
    : "left 0.3s ease, top 0.3s ease, right 0.3s ease, bottom 0.3s ease";

  return (
    <div
      ref={panelRef}
      onMouseDown={handleMouseDown}
      style={{
        position: "fixed",
        ...positionStyle,
        zIndex: 10001,
        pointerEvents: "auto",
        background: "#fff",
        border: "1px solid #e0e0e0",
        borderRadius: 12,
        padding: 4,
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        display: "flex",
        alignItems: "center",
        cursor: isDragging ? "grabbing" : "grab",
        userSelect: "none",
        overflow: "hidden",
        transition: `${positionTransition}`,
      }}
    >
      {/* Expandable tool buttons — animate in/out */}
      <ToolGroup visible={visible}>
        <IconButton
          icon={<CursorIcon size={ICON_SIZE} />}
          label="Select"
          active={mode === "select"}
          onClick={() => onModeChange("select")}
        />
        <IconButton
          icon={<MoveIcon size={ICON_SIZE} />}
          label="Move"
          active={mode === "move"}
          onClick={() => onModeChange("move")}
        />
      </ToolGroup>

      {/* Batch actions — animate in/out */}
      <ToolGroup visible={visible && batchCount > 0}>
        <Divider />
        <IconButton
          icon={<SendIcon size={ICON_SIZE} />}
          label={`Submit ${batchCount} annotation${batchCount !== 1 ? "s" : ""}`}
          onClick={() => onSubmitBatch?.()}
        />
        <IconButton
          icon={<CopyIcon size={ICON_SIZE} />}
          label="Copy annotations to clipboard"
          onClick={() => onCopyBatch?.()}
        />
        <IconButton
          icon={<TrashIcon size={ICON_SIZE} />}
          label="Clear all annotations"
          onClick={() => onClearBatch?.()}
        />
      </ToolGroup>

      {/* Logo / Close toggle — always visible, rightmost */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onVisibilityChange(!visible);
        }}
        title={visible ? `Hide panel (${HOTKEY})` : `Show iterate panel (${HOTKEY})`}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 4,
          borderRadius: 8,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          width: ICON_SIZE + 8,
          height: ICON_SIZE + 8,
          flexShrink: 0,
        }}
      >
        {/* Logo icon — fades out when open */}
        <div
          style={{
            position: "absolute",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: visible ? 0 : 1,
            transform: visible ? "scale(0.6)" : "scale(1)",
            filter: visible ? "blur(4px)" : "blur(0px)",
            transition: `opacity 0.25s ${SPRING}, transform 0.3s ${SPRING}, filter 0.25s ease`,
            color: "#666",
          }}
        >
          <LogoIcon size={ICON_SIZE} />
        </div>
        {/* Close icon — fades in when open */}
        <div
          style={{
            position: "absolute",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: visible ? 1 : 0,
            transform: visible ? "scale(1)" : "scale(0.6)",
            filter: visible ? "blur(0px)" : "blur(4px)",
            transition: `opacity 0.25s ${SPRING}, transform 0.3s ${SPRING}, filter 0.25s ease`,
            color: "#999",
          }}
        >
          <CloseIcon size={ICON_SIZE} />
        </div>
      </button>
    </div>
  );
}

/**
 * Animated wrapper that scales/fades its children in and out.
 * Uses max-width to animate the container width with a spring curve.
 */
function ToolGroup({
  visible,
  children,
}: {
  visible: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        overflow: "hidden",
        maxWidth: visible ? 500 : 0,
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1)" : "scale(0.85)",
        transformOrigin: "left center",
        transition: `max-width 0.35s ${SPRING}, opacity 0.2s ease, transform 0.3s ${SPRING}`,
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      {children}
    </div>
  );
}

function Divider() {
  return (
    <div
      style={{
        width: 1,
        height: 20,
        background: "#e0e0e0",
        margin: "0 2px",
        flexShrink: 0,
      }}
    />
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
  active?: boolean;
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
        padding: 4,
        borderRadius: 8,
        border: "none",
        background: active ? "#e8e8e8" : "transparent",
        color: active ? "#141414" : "#666",
        cursor: "pointer",
        transition: "background 0.1s, color 0.1s",
        flexShrink: 0,
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
