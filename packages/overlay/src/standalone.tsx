import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { IterateOverlay, type ToolMode } from "./IterateOverlay.js";
import { FloatingPanel } from "./panel/FloatingPanel.js";
import { DaemonConnection } from "./transport/connection.js";
import type { AnnotationData } from "@iterate/core";

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
 * - Submit to Agent button
 */
function StandaloneOverlay() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const connectionRef = useRef<DaemonConnection | null>(null);
  const [mode, setMode] = useState<ToolMode>("select");
  const [iteration, setIteration] = useState<string>("");
  const [visible, setVisible] = useState(true);
  const [annotationCount, setAnnotationCount] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [wsUrl, setWsUrl] = useState<string | undefined>(
    () => (window as any).__iterate_shell__?.wsUrl
  );

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
      if (shell.wsUrl) setWsUrl(shell.wsUrl);
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

  // Connect to daemon and track annotation count
  useEffect(() => {
    const conn = new DaemonConnection(wsUrl);
    connectionRef.current = conn;
    conn.connect();

    conn.onMessage((msg) => {
      if (msg.type === "state:sync") {
        const state = msg.payload as { annotations: AnnotationData[] };
        setAnnotationCount(state.annotations.filter((a) => a.status === "pending").length);
      }
      if (msg.type === "annotation:created") {
        setAnnotationCount((prev) => prev + 1);
        setSubmitted(false);
      }
      if (msg.type === "annotation:deleted") {
        setAnnotationCount((prev) => Math.max(0, prev - 1));
      }
      if (msg.type === "annotation:updated") {
        const annotation = msg.payload as AnnotationData;
        if (annotation.status !== "pending") {
          setAnnotationCount((prev) => Math.max(0, prev - 1));
        }
      }
    });

    return () => conn.disconnect();
  }, [wsUrl]);

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

  // Submit annotations to agent
  const handleSubmit = useCallback(() => {
    connectionRef.current?.send({
      type: "annotations:submit",
      payload: { iteration },
    });
    setSubmitted(true);
  }, [iteration]);

  if (!iteration) return null;

  return (
    <>
      {/* Full-screen canvas layer (pointer-events managed per tool mode) */}
      <IterateOverlay
        mode={visible ? mode : "select"}
        iteration={iteration}
        iframeRef={iframeRef}
        connection={connectionRef.current ?? undefined}
      />

      {/* Floating toolbar panel */}
      <FloatingPanel
        mode={mode}
        onModeChange={handleModeChange}
        visible={visible}
        onVisibilityChange={setVisible}
        annotationCount={annotationCount}
        onSubmit={handleSubmit}
        submitDisabled={submitted || annotationCount === 0}
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
