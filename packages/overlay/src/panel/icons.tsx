import React from "react";

const ICON_SIZE = 16;

interface IconProps {
  size?: number;
  color?: string;
}

/** Arrow cursor icon — Select mode */
export function CursorIcon({ size = ICON_SIZE, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M3 2L3 12.5L6.5 9L10.5 13L12 11.5L8 7.5L12 4L3 2Z"
        fill={color}
      />
    </svg>
  );
}

/** Four-directional arrows — Move mode */
export function MoveIcon({ size = ICON_SIZE, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M8 1L5.5 3.5H7.25V7.25H3.5V5.5L1 8L3.5 10.5V8.75H7.25V12.5H5.5L8 15L10.5 12.5H8.75V8.75H12.5V10.5L15 8L12.5 5.5V7.25H8.75V3.5H10.5L8 1Z"
        fill={color}
      />
    </svg>
  );
}

/** Paper plane — Submit / send batch */
export function SendIcon({ size = ICON_SIZE, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M14.5 1.5L1 7.5L6 9L7 14.5L9.5 10.5L14.5 1.5Z"
        fill={color}
        opacity={0.15}
      />
      <path
        d="M14.5 1.5L1 7.5L6 9M14.5 1.5L6 9M14.5 1.5L7 14.5L6 9M14.5 1.5L9.5 10.5L7 14.5"
        stroke={color}
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Minus / minimize icon */
export function MinimizeIcon({ size = ICON_SIZE, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M4 8H12"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Iterate logo mark (small) */
export function LogoIcon({ size = ICON_SIZE, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M4 4L12 4L12 12L4 12Z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="3 2"
      />
      <circle cx="8" cy="8" r="2" fill={color} />
    </svg>
  );
}
