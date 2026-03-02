import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { IterateOverlay, type ToolMode } from "./IterateOverlay.js";
import { FloatingPanel, ORIGINAL_TAB } from "./panel/FloatingPanel.js";
import { DaemonConnection } from "./transport/connection.js";
import type { IterationInfo } from "@iterate/core";

/** postMessage types for parent <-> iframe communication */
interface IterateMessage {
  __iterate: true;
  type:
    | "set-mode"
    | "set-iteration"
    | "submit-batch"
    | "clear-batch"
    | "copy-batch"
    | "undo-move"
    | "set-preview"
    | "batch-counts"
    | "ready";
  mode?: ToolMode;
  iteration?: string;
  previewMode?: boolean;
  batchCount?: number;
  moveCount?: number;
}

function isIterateMessage(data: unknown): data is IterateMessage {
  return typeof data === "object" && data !== null && (data as any).__iterate === true;
}

/**
 * Standalone entry point — self-mounts the overlay into any page.
 *
 * Works in three contexts:
 * 1. Daemon shell (has #viewport with iframes) — observes iframe changes
 * 2. Framework plugin (Vite/Next) — operates directly on the page body,
 *    with iteration preview iframes embedded via postMessage bridge
 * 3. Embedded in iteration iframe — tools controlled by parent via postMessage,
 *    FloatingPanel is hidden (parent's panel is the controller)
 */
function StandaloneOverlay() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const iterationIframeRef = useRef<HTMLIFrameElement | null>(null);
  const connectionRef = useRef<DaemonConnection | null>(null);
  const previousModeRef = useRef<ToolMode>("browse");
  const modeRef = useRef<ToolMode>("browse");
  const iterationRef = useRef<string>(ORIGINAL_TAB);
  const previewModeRef = useRef(true);
  const [mode, setMode] = useState<ToolMode>("browse");
  const [iteration, setIteration] = useState<string>(() => {
    const initial = (window as any).__iterate_shell__?.activeIteration;
    return initial && initial !== "default" && initial !== ORIGINAL_TAB
      ? initial
      : ORIGINAL_TAB;
  });
  const [visible, setVisible] = useState(true);
  const [batchCount, setBatchCount] = useState(0);
  const [moveCount, setMoveCount] = useState(0);
  const [previewMode, setPreviewMode] = useState(true);
  const [iterations, setIterations] = useState<Record<string, IterationInfo>>({});

  // Detect context
  const isDaemonShell = typeof document !== "undefined" && !!document.getElementById("viewport");
  const isEmbedded = typeof window !== "undefined" && window.self !== window.top;

  // In framework plugin mode, connect directly to the daemon port
  const shell = (window as any).__iterate_shell__;
  const daemonPort = shell?.daemonPort ?? 4000;
  const wsUrl = !isDaemonShell && shell?.daemonPort
    ? `ws://${window.location.hostname}:${shell.daemonPort}/ws`
    : undefined;

  // Keep refs in sync with state (for use in event handlers with stable deps)
  modeRef.current = mode;
  iterationRef.current = iteration;
  previewModeRef.current = previewMode;

  // Derived state
  const isViewingIteration = iteration !== ORIGINAL_TAB;

  // --- Embedded mode: WebSocket relay for tool mode + postMessage fallback ---
  useEffect(() => {
    if (!isEmbedded) return;

    // Connect to daemon via WebSocket to receive tool mode changes
    const conn = new DaemonConnection(wsUrl);
    connectionRef.current = conn;

    const unsub = conn.onToolModeChange((newMode) => {
      if (newMode === "select" || newMode === "move" || newMode === "browse") {
        setMode(newMode as ToolMode);
      }
    });

    conn.connect();

    return () => {
      unsub();
      conn.disconnect();
    };
  }, [wsUrl, isEmbedded]);

  // --- Embedded mode: signal to parent that overlay is ready ---
  useEffect(() => {
    if (!isEmbedded) return;
    window.parent.postMessage({ __iterate: true, type: "ready" } as IterateMessage, "*");
  }, [isEmbedded]);

  // --- Embedded mode: listen for commands from parent window (postMessage fallback) ---
  useEffect(() => {
    if (!isEmbedded) return;

    const handler = (e: MessageEvent) => {
      if (!isIterateMessage(e.data)) return;
      const msg = e.data;

      switch (msg.type) {
        case "set-mode":
          if (msg.mode) setMode(msg.mode);
          break;
        case "set-iteration":
          if (msg.iteration) setIteration(msg.iteration);
          break;
        case "submit-batch":
          window.dispatchEvent(new CustomEvent("iterate:submit-batch"));
          break;
        case "clear-batch":
          window.dispatchEvent(new CustomEvent("iterate:clear-batch"));
          break;
        case "copy-batch":
          window.dispatchEvent(new CustomEvent("iterate:copy-batch"));
          break;
        case "undo-move":
          window.dispatchEvent(new CustomEvent("iterate:undo-move"));
          break;
        case "set-preview":
          if (msg.previewMode !== undefined) setPreviewMode(msg.previewMode);
          break;
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [isEmbedded]);

  // --- Embedded mode: send batch/move counts back to parent ---
  useEffect(() => {
    if (!isEmbedded) return;
    const msg: IterateMessage = {
      __iterate: true,
      type: "batch-counts",
      batchCount,
      moveCount,
    };
    window.parent.postMessage(msg, "*");
  }, [isEmbedded, batchCount, moveCount]);

  // --- Parent mode: forward tool/action commands to iteration iframe ---
  const postToIframe = useCallback(
    (msg: IterateMessage) => {
      iterationIframeRef.current?.contentWindow?.postMessage(msg, "*");
    },
    []
  );

  // Forward mode changes to iteration iframe
  useEffect(() => {
    if (!isViewingIteration || isEmbedded) return;
    postToIframe({ __iterate: true, type: "set-mode", mode });
  }, [mode, isViewingIteration, isEmbedded, postToIframe]);

  // Forward preview mode changes to iteration iframe
  useEffect(() => {
    if (!isViewingIteration || isEmbedded) return;
    postToIframe({ __iterate: true, type: "set-preview", previewMode });
  }, [previewMode, isViewingIteration, isEmbedded, postToIframe]);

  // Listen for messages from iteration iframe (batch counts + ready handshake)
  useEffect(() => {
    if (isEmbedded) return;

    const handler = (e: MessageEvent) => {
      if (!isIterateMessage(e.data)) return;
      if (e.data.type === "batch-counts") {
        if (e.data.batchCount !== undefined) setBatchCount(e.data.batchCount);
        if (e.data.moveCount !== undefined) setMoveCount(e.data.moveCount);
      } else if (e.data.type === "ready") {
        // Iframe overlay just mounted — sync current state including iteration name
        const iframe = iterationIframeRef.current;
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage(
            { __iterate: true, type: "set-iteration", iteration: iterationRef.current } as IterateMessage,
            "*"
          );
          iframe.contentWindow.postMessage(
            { __iterate: true, type: "set-mode", mode: modeRef.current } as IterateMessage,
            "*"
          );
          iframe.contentWindow.postMessage(
            { __iterate: true, type: "set-preview", previewMode: previewModeRef.current } as IterateMessage,
            "*"
          );
        }
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [isEmbedded]);

  // Set up a separate DaemonConnection for iteration state tracking
  useEffect(() => {
    if (isEmbedded) return; // Embedded overlays don't need their own iteration tracking

    const conn = new DaemonConnection(wsUrl);
    connectionRef.current = conn;

    const unsub = conn.onIterationsChange((iters) => {
      setIterations(iters);
    });

    conn.connect();

    return () => {
      unsub();
      conn.disconnect();
    };
  }, [wsUrl, isEmbedded]);

  // Listen for shell events (daemon shell mode)
  useEffect(() => {
    if (isEmbedded) return;

    const onToolChange = (e: Event) => {
      const tool = (e as CustomEvent).detail.tool as string;
      if (tool === "annotate") {
        setMode("select");
      } else if (tool === "select" || tool === "move" || tool === "browse") {
        setMode(tool);
      }
    };
    const onIterationChange = (e: Event) => {
      setIteration((e as CustomEvent).detail.iteration ?? ORIGINAL_TAB);
    };

    window.addEventListener("iterate:tool-change", onToolChange);
    window.addEventListener("iterate:iteration-change", onIterationChange);

    // Read initial state
    const shell = (window as any).__iterate_shell__;
    if (shell) {
      const tool = shell.activeTool ?? "browse";
      setMode(tool === "annotate" ? "select" : (tool as ToolMode));
      const initialIteration = shell.activeIteration;
      setIteration(
        initialIteration && initialIteration !== "default"
          ? initialIteration
          : ORIGINAL_TAB
      );
    }

    return () => {
      window.removeEventListener("iterate:tool-change", onToolChange);
      window.removeEventListener("iterate:iteration-change", onIterationChange);
    };
  }, [isEmbedded]);

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

  // Broadcast mode changes back to the shell + relay via WebSocket
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
      // Relay to embedded overlays via WebSocket
      connectionRef.current?.sendToolMode(newMode);
    },
    []
  );

  // Handle iteration switching from the FloatingPanel
  const handleIterationChange = useCallback(
    (name: string) => {
      const wasViewingIteration = iteration !== ORIGINAL_TAB;
      const willViewIteration = name !== ORIGINAL_TAB;

      // Auto-switch to browse when entering iteration view
      if (willViewIteration && !wasViewingIteration) {
        previousModeRef.current = mode;
        setMode("browse");
        // Relay the mode change via WebSocket so embedded overlays receive it
        connectionRef.current?.sendToolMode("browse");
      } else if (!willViewIteration && wasViewingIteration) {
        const restoredMode = previousModeRef.current;
        setMode(restoredMode);
        connectionRef.current?.sendToolMode(restoredMode);
      }

      setIteration(name);

      const shell = (window as any).__iterate_shell__;
      if (shell) {
        shell.activeIteration = name;
      }

      window.dispatchEvent(
        new CustomEvent("iterate:iteration-change", { detail: { iteration: name } })
      );
      window.dispatchEvent(
        new CustomEvent("iterate:request-switch", { detail: { iteration: name } })
      );
    },
    [iteration, mode]
  );

  // Auto-select first iteration (v1) when iterations first appear (one-time only)
  const hasAutoSelectedRef = useRef(false);
  useEffect(() => {
    if (isEmbedded || hasAutoSelectedRef.current) return;
    const names = Object.keys(iterations);
    if (names.length > 0 && iteration === ORIGINAL_TAB) {
      const sorted = names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      handleIterationChange(sorted[0]!);
      hasAutoSelectedRef.current = true;
    }
  }, [iterations, iteration, isEmbedded, handleIterationChange]);

  // Handle batch submission — forward to iframe if viewing iteration
  const handleSubmitBatch = useCallback(() => {
    if (isViewingIteration) {
      postToIframe({ __iterate: true, type: "submit-batch" });
    } else {
      window.dispatchEvent(new CustomEvent("iterate:submit-batch"));
    }
  }, [isViewingIteration, postToIframe]);

  // Handle clearing all annotations and moves
  const handleClearBatch = useCallback(() => {
    if (isViewingIteration) {
      postToIframe({ __iterate: true, type: "clear-batch" });
    } else {
      window.dispatchEvent(new CustomEvent("iterate:clear-batch"));
    }
  }, [isViewingIteration, postToIframe]);

  // Handle copying annotations to clipboard
  const handleCopyBatch = useCallback(() => {
    if (isViewingIteration) {
      postToIframe({ __iterate: true, type: "copy-batch" });
    } else {
      window.dispatchEvent(new CustomEvent("iterate:copy-batch"));
    }
  }, [isViewingIteration, postToIframe]);

  // Handle undo last move
  const handleUndoMove = useCallback(() => {
    if (isViewingIteration) {
      postToIframe({ __iterate: true, type: "undo-move" });
    } else {
      window.dispatchEvent(new CustomEvent("iterate:undo-move"));
    }
  }, [isViewingIteration, postToIframe]);

  // Handle creating iterations (fork)
  const handleFork = useCallback(
    async () => {
      try {
        const res = await fetch("/api/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: "iterate", count: 3 }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: "Unknown error" }));
          console.error("[iterate] Fork failed:", err.message);
        }
      } catch (err) {
        console.error("[iterate] Fork failed:", err);
      }
    },
    []
  );

  // Handle picking a winning iteration
  const handlePick = useCallback(
    async (name: string) => {
      try {
        const res = await fetch("/api/iterations/pick", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (res.ok) {
          setIteration(ORIGINAL_TAB);
          setMode(previousModeRef.current);
        } else {
          const err = await res.json().catch(() => ({ message: "Unknown error" }));
          console.error("[iterate] Pick failed:", err.message);
        }
      } catch (err) {
        console.error("[iterate] Pick failed:", err);
      }
    },
    []
  );

  // Handle discarding all iterations (keep original)
  const handleDiscard = useCallback(
    async () => {
      const names = Object.keys(iterations);
      if (names.length === 0) return;
      try {
        await Promise.allSettled(
          names.map((name) =>
            fetch(`/api/iterations/${name}`, { method: "DELETE" })
          )
        );
        setIteration(ORIGINAL_TAB);
        setMode(previousModeRef.current);
      } catch (err) {
        console.error("[iterate] Discard failed:", err);
      }
    },
    [iterations]
  );

  // Build the iteration iframe URL (framework plugin mode, parent only).
  // Load directly from the iteration's dev server port — avoids path-prefix
  // issues where absolute asset paths (/_next/...) would 404 through the proxy.
  const iterationPort = iterations[iteration]?.port;
  const iterationUrl =
    !isDaemonShell && !isEmbedded && isViewingIteration && iterationPort
      ? `http://${window.location.hostname}:${iterationPort}/`
      : null;

  // Lazily create a portal target for the iteration iframe (sibling of overlay root,
  // NOT inside it — avoids pointer-events:none inheritance blocking iframe clicks)
  const iframePortalRef = useRef<HTMLDivElement | null>(null);
  if (!iframePortalRef.current && typeof document !== "undefined") {
    let el = document.getElementById("__iterate-iframe-portal__") as HTMLDivElement | null;
    if (!el) {
      el = document.createElement("div");
      el.id = "__iterate-iframe-portal__";
      el.style.cssText = "position:fixed;inset:0;z-index:9998;pointer-events:none;display:none;background:#000;";
      document.body.appendChild(el);
    }
    iframePortalRef.current = el;
  }

  // Show/hide the portal container based on whether we need the iframe
  useEffect(() => {
    const portal = iframePortalRef.current;
    if (!portal) return;
    if (iterationUrl) {
      portal.style.display = "block";
      portal.style.pointerEvents = "auto";
    } else {
      portal.style.display = "none";
      portal.style.pointerEvents = "none";
    }
  }, [iterationUrl]);

  // Determine which iframe ref to pass to IterateOverlay:
  // - Daemon shell: use iframeRef (set by viewport observer)
  // - Framework plugin viewing iteration: use iterationIframeRef (cross-origin, tools are no-op)
  // - Framework plugin viewing original: use iframeRef (null, targets parent document)
  const activeIframeRef = isDaemonShell
    ? iframeRef
    : isViewingIteration
      ? iterationIframeRef
      : iframeRef;

  // If embedded in an iframe, only render the IterateOverlay (no FloatingPanel)
  if (isEmbedded) {
    return (
      <IterateOverlay
        mode={mode}
        iteration={iteration}
        wsUrl={wsUrl}
        iframeRef={iframeRef}
        onBatchCountChange={setBatchCount}
        onMoveCountChange={setMoveCount}
        previewMode={previewMode}
      />
    );
  }

  return (
    <>
      {/* Iteration preview iframe — rendered via portal OUTSIDE overlay root
          to avoid pointer-events:none inheritance blocking iframe interactions */}
      {iterationUrl && iframePortalRef.current && createPortal(
        <iframe
          ref={iterationIframeRef}
          src={iterationUrl}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            display: "block",
          }}
          title={`Iteration: ${iteration}`}
        />,
        iframePortalRef.current
      )}

      {/* Full-screen overlay layer — always rendered to preserve state across tab switches.
          When viewing iterations: forced to browse mode so parent tools don't intercept
          events on the parent document. The embedded overlay inside the iframe handles
          actual tool interactions for iterations. */}
      <IterateOverlay
        mode={isViewingIteration ? "browse" : mode}
        iteration={iteration}
        wsUrl={wsUrl}
        iframeRef={activeIframeRef}
        onBatchCountChange={isViewingIteration ? undefined : setBatchCount}
        onMoveCountChange={isViewingIteration ? undefined : setMoveCount}
        previewMode={previewMode}
      />

      {/* Floating toolbar panel */}
      <FloatingPanel
        mode={mode}
        onModeChange={handleModeChange}
        visible={visible}
        onVisibilityChange={setVisible}
        batchCount={batchCount}
        moveCount={moveCount}
        onSubmitBatch={handleSubmitBatch}
        onClearBatch={handleClearBatch}
        onCopyBatch={handleCopyBatch}
        onUndoMove={handleUndoMove}
        previewMode={previewMode}
        onPreviewModeChange={setPreviewMode}
        iterations={iterations}
        activeIteration={iteration}
        onIterationChange={handleIterationChange}
        onFork={handleFork}
        onPick={handlePick}
        onDiscard={handleDiscard}
        isViewingIteration={isViewingIteration}
      />
    </>
  );
}

// --- Self-mount (idempotent — safe if injected twice) ---
if (!document.getElementById("__iterate-overlay-root__")) {
  const mount = document.createElement("div");
  mount.id = "__iterate-overlay-root__";
  mount.style.cssText = "position:fixed;inset:0;z-index:9999;pointer-events:none;";
  document.body.appendChild(mount);

  const root = createRoot(mount);
  root.render(<StandaloneOverlay />);
}
