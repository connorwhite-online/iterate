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
 * - Tool mode switching (Select / Move)
 * - Batch submit button (when annotations are pending)
 * - Drag to any screen corner
 * - Hide/show toggle with Alt+Shift+I hotkey
 */
function StandaloneOverlay() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [mode, setMode] = useState<ToolMode>("select");
  const [iteration, setIteration] = useState<string>("");
  const [visible, setVisible] = useState(true);
  const [batchCount, setBatchCount] = useState(0);

  // Detect context: daemon shell vs framework plugin
  const isDaemonShell = typeof document !== "undefined" && !!document.getElementById("viewport");

  // In framework plugin mode, connect directly to the daemon port
  const shell = (window as any).__iterate_shell__;
  const wsUrl = !isDaemonShell && shell?.daemonPort
    ? `ws://${window.location.hostname}:${shell.daemonPort}/ws`
    : undefined;

  // Listen for shell events (daemon shell mode)
  useEffect(() => {
    const onToolChange = (e: Event) => {
      const tool = (e as CustomEvent).detail.tool as string;
      // Map legacy "annotate" to "select" for shell compatibility
      if (tool === "annotate") {
        setMode("select");
      } else if (tool === "select" || tool === "move") {
        setMode(tool);
      }
    };
    const onIterationChange = (e: Event) => {
      setIteration((e as CustomEvent).detail.iteration ?? "");
    };

    window.addEventListener("iterate:tool-change", onToolChange);
    window.addEventListener("iterate:iteration-change", onIterationChange);

    // Read initial state
    const shell = (window as any).__iterate_shell__;
    if (shell) {
      const tool = shell.activeTool ?? "select";
      setMode(tool === "annotate" ? "select" : tool);
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

  // Broadcast mode changes back to the shell
  const handleModeChange = useCallback(
    (newMode: ToolMode) => {
      setMode(newMode);
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

  // Handle batch submission from toolbar
  const handleSubmitBatch = useCallback(() => {
    window.dispatchEvent(new CustomEvent("iterate:submit-batch"));
  }, []);

  // Handle clearing all annotations
  const handleClearBatch = useCallback(() => {
    window.dispatchEvent(new CustomEvent("iterate:clear-batch"));
  }, []);

  // Handle copying annotations to clipboard
  const handleCopyBatch = useCallback(() => {
    window.dispatchEvent(new CustomEvent("iterate:copy-batch"));
  }, []);

  if (!iteration) return null;

  return (
    <>
      {/* Full-screen overlay layer (pointer-events managed per tool mode) */}
      <IterateOverlay
        mode={visible ? mode : "select"}
        iteration={iteration}
        wsUrl={wsUrl}
        iframeRef={iframeRef}
        onBatchCountChange={setBatchCount}
      />

      {/* Floating toolbar panel */}
      <FloatingPanel
        mode={mode}
        onModeChange={handleModeChange}
        visible={visible}
        onVisibilityChange={setVisible}
        batchCount={batchCount}
        onSubmitBatch={handleSubmitBatch}
        onClearBatch={handleClearBatch}
        onCopyBatch={handleCopyBatch}
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
