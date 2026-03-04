"use client";

import { useState } from "react";
import styles from "./CopyButton.module.css";

const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button className={styles.button} onClick={handleCopy} aria-label="Copy code">
      <div style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: copied ? 0 : 1,
        transform: copied ? "scale(0.6)" : "scale(1)",
        filter: copied ? "blur(4px)" : "blur(0px)",
        transition: `opacity 0.25s ${SPRING}, transform 0.3s ${SPRING}, filter 0.25s ease`,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 9V3.5C9 3.22386 9.22386 3 9.5 3H20.5C20.7761 3 21 3.22386 21 3.5V14.5C21 14.7761 20.7761 15 20.5 15H15M14.5 9H3.5C3.22386 9 3 9.22386 3 9.5V20.5C3 20.7761 3.22386 21 3.5 21H14.5C14.7761 21 15 20.7761 15 20.5V9.5C15 9.22386 14.7761 9 14.5 9Z" />
        </svg>
      </div>
      <div style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: copied ? 1 : 0,
        transform: copied ? "scale(1)" : "scale(0.6)",
        filter: copied ? "blur(0px)" : "blur(4px)",
        transition: `opacity 0.25s ${SPRING}, transform 0.3s ${SPRING}, filter 0.25s ease`,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
    </button>
  );
}
