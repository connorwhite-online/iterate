import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { IterateOverlay, type ToolMode } from "./IterateOverlay.js";
import { FloatingPanel } from "./panel/FloatingPanel.js";

/**
 * Standalone entry point — self-mounts the overlay into any page.
 *
 * Works in two contexts:
 * 1. Daemon shell (has #viewport with iframes) — observes iframe changes
 * 2. Framework plugin (Vite/Next) — operates directly on the page body
 *
 * Includes a draggable floating toolbar panel with:
 * - Tool mode switching (Select / Annotate / Move)
 * - Drag to any screen corner
 * - Hide/show toggle with Alt+Shift+I hotkey
 */
function StandaloneOverlay() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [mode, setMode] = useState<ToolMode>("select");
  const [iteration, setIteration] = useState<string>("");
  const [visible, setVisible] = useState(true);
  const [annotationCount, setAnnotationCount] = useState(0);

  // Detect context: daemon shell vs framework plugin
  const isDaemonShell = typeof document !== "undefined" && !!document.getElementById("viewport");

  // Listen for shell events (daemon shell mode)
  useEffect(() => {
    const onToolChange = (e: Event) => {
      setMode((e as CustomEvent).detail.tool as ToolMode);
    };
    const onIterationChange = (e: Event) => {
      setIteration((e as CustomEvent).detail.iteration ?? "");
    };

    window.addEventListener("iterate:tool-change", onToolChange);
    window.addEventListener("iterate:iteration-change", onIterationChange);

    // Read initial state
    const shell = (window as any).__iterate_shell__;
    if (shell) {
      setMode(shell.activeTool ?? "select");
      setIteration(shell.activeIteration ?? "default");
    }

    // If no shell state, default to "default" iteration (framework plugin mode)
    if (!shell) {
      setIteration("default");
    }

    return () => {
      window.removeEventListener("iterate:tool-change", onToolChange);
      window.removeEventListener("iterate:iteration-change", onIterationChange);
    };
  }, []);

  // Observe viewport for iframe changes (daemon shell mode)
  useEffect(() => {
    if (!isDaemonShell) return;

    const viewport = document.getElementById("viewport")!;
    const sync = () => {
      const iframe = viewport.querySelector("iframe") as HTMLIFrameElement | null;
      iframeRef.current = iframe;
    };

    sync();

    const observer = new MutationObserver(sync);
    observer.observe(viewport, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [isDaemonShell]);

  // Broadcast mode changes back to the shell (so daemon toolbar stays in sync)
  const handleModeChange = useCallback(
    (newMode: ToolMode) => {
      setMode(newMode);
      // Sync with shell if present
      const shell = (window as any).__iterate_shell__;
      if (shell) {
        shell.activeTool = newMode;
      }
      window.dispatchEvent(
        new CustomEvent("iterate:tool-change", { detail: { tool: newMode } })
      );
    },
    []
  );

  if (!iteration) return null;

  return (
    <>
      {/* Full-screen canvas layer (pointer-events managed per tool mode) */}
      <IterateOverlay
        mode={visible ? mode : "select"}
        iteration={iteration}
        iframeRef={iframeRef}
      />

      {/* Floating toolbar panel */}
      <FloatingPanel
        mode={mode}
        onModeChange={handleModeChange}
        visible={visible}
        onVisibilityChange={setVisible}
        annotationCount={annotationCount}
      />
    </>
  );
}

// --- Self-mount ---
const mount = document.createElement("div");
mount.id = "__iterate-overlay-root__";
mount.style.cssText = "position:fixed;inset:0;z-index:9999;pointer-events:none;";
document.body.appendChild(mount);

const root = createRoot(mount);
root.render(<StandaloneOverlay />);
