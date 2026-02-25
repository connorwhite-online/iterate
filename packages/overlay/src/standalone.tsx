import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { IterateOverlay, type ToolMode } from "./IterateOverlay.js";

/**
 * Standalone entry point — self-mounts the overlay into the daemon shell.
 * Listens for shell events (tool changes, iteration switches) and
 * observes the viewport for iframe changes.
 */
function StandaloneOverlay() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [mode, setMode] = useState<ToolMode>("select");
  const [iteration, setIteration] = useState<string>("");

  // Listen for shell events
  useEffect(() => {
    const onToolChange = (e: Event) => {
      setMode((e as CustomEvent).detail.tool as ToolMode);
    };
    const onIterationChange = (e: Event) => {
      setIteration((e as CustomEvent).detail.iteration ?? "");
    };

    window.addEventListener("iterate:tool-change", onToolChange);
    window.addEventListener("iterate:iteration-change", onIterationChange);

    // Read initial state from the shell if it's already set
    const shell = (window as any).__iterate_shell__;
    if (shell) {
      setMode(shell.activeTool ?? "select");
      setIteration(shell.activeIteration ?? "");
    }

    return () => {
      window.removeEventListener("iterate:tool-change", onToolChange);
      window.removeEventListener("iterate:iteration-change", onIterationChange);
    };
  }, []);

  // Observe the viewport for iframe insertions/removals
  useEffect(() => {
    const viewport = document.getElementById("viewport");
    if (!viewport) return;

    const sync = () => {
      const iframe = viewport.querySelector("iframe") as HTMLIFrameElement | null;
      iframeRef.current = iframe;
    };

    sync();

    const observer = new MutationObserver(sync);
    observer.observe(viewport, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  if (!iteration) return null;

  return (
    <IterateOverlay
      mode={mode}
      iteration={iteration}
      iframeRef={iframeRef}
    />
  );
}

// --- Self-mount ---
const mount = document.createElement("div");
mount.id = "__iterate-overlay-root__";
mount.style.cssText = "position:fixed;inset:0;z-index:9999;pointer-events:none;";
document.body.appendChild(mount);

const root = createRoot(mount);
root.render(<StandaloneOverlay />);
