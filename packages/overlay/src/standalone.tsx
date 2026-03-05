import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { IterateOverlay, type ToolMode } from "./IterateOverlay.js";
import { FloatingPanel, ORIGINAL_TAB } from "./panel/FloatingPanel.js";
import { DaemonConnection } from "./transport/connection.js";
import type { IterationInfo } from "iterate-ui-core";

/** postMessage types for parent <-> iframe communication */
interface IterateMessage {
  __iterate: true;
  type:
    | "set-mode"
    | "set-iteration"
    | "clear-batch"
    | "copy-batch"
    | "undo"
    | "set-preview"
    | "batch-counts"
    | "ready"
    | "request-batch-text"
    | "batch-text";
  mode?: ToolMode;
  iteration?: string;
  previewMode?: boolean;
  batchCount?: number;
  moveCount?: number;
  text?: string;
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
  const iterationIframeRefs = useRef<Record<string, HTMLIFrameElement | null>>({});
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
  const [tabCounts, setTabCounts] = useState<Record<string, { batch: number; move: number }>>({});
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

  // Derive per-tab and total counts from tabCounts
  const activeCounts = tabCounts[iteration] ?? { batch: 0, move: 0 };
  const batchCount = activeCounts.batch;
  const moveCount = activeCounts.move;
  const totalBatchCount = Object.values(tabCounts).reduce((sum, c) => sum + c.batch, 0);
  const totalMoveCount = Object.values(tabCounts).reduce((sum, c) => sum + c.move, 0);
  const tabBadgeCounts: Record<string, number> = {};
  for (const [tab, counts] of Object.entries(tabCounts)) {
    const total = counts.batch + counts.move;
    if (total > 0) tabBadgeCounts[tab] = total;
  }

  // All ready iteration iframes (for multi-iframe rendering)
  const readyIterations = !isDaemonShell && !isEmbedded
    ? Object.entries(iterations).filter(([, info]) => info.status === "ready" && info.port)
    : [];
  const hasReadyIterations = readyIterations.length > 0;

  // --- Embedded mode: WebSocket relay for tool mode + postMessage fallback ---
  useEffect(() => {
    if (!isEmbedded) return;

    // Connect to daemon via WebSocket to receive tool mode changes
    const conn = new DaemonConnection(wsUrl);
    connectionRef.current = conn;

    const unsub = conn.onToolModeChange((newMode) => {
      if (newMode === "select" || newMode === "move" || newMode === "draw" || newMode === "browse") {
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
        case "clear-batch":
          window.dispatchEvent(new CustomEvent("iterate:clear-batch"));
          break;
        case "copy-batch":
          window.dispatchEvent(new CustomEvent("iterate:copy-batch"));
          break;
        case "undo":
          window.dispatchEvent(new CustomEvent("iterate:undo"));
          break;
        case "set-preview":
          if (msg.previewMode !== undefined) setPreviewMode(msg.previewMode);
          break;
        case "request-batch-text":
          window.dispatchEvent(new CustomEvent("iterate:request-batch-text"));
          break;
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [isEmbedded]);

  // --- Embedded mode: forward batch text response to parent ---
  useEffect(() => {
    if (!isEmbedded) return;
    const handler = (e: Event) => {
      const text = (e as CustomEvent).detail.text;
      window.parent.postMessage({ __iterate: true, type: "batch-text", text } as IterateMessage, "*");
    };
    window.addEventListener("iterate:batch-text-response", handler);
    return () => window.removeEventListener("iterate:batch-text-response", handler);
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
    (msg: IterateMessage, targetName?: string) => {
      const name = targetName ?? iterationRef.current;
      iterationIframeRefs.current[name]?.contentWindow?.postMessage(msg, "*");
    },
    []
  );

  const postToAllIframes = useCallback(
    (msg: IterateMessage) => {
      for (const iframe of Object.values(iterationIframeRefs.current)) {
        iframe?.contentWindow?.postMessage(msg, "*");
      }
    },
    []
  );

  // Forward mode changes to the active iteration iframe (re-runs on tab switch too)
  useEffect(() => {
    if (!isViewingIteration || isEmbedded) return;
    postToIframe({ __iterate: true, type: "set-mode", mode });
  }, [mode, iteration, isViewingIteration, isEmbedded, postToIframe]);

  // Forward preview mode changes to all iteration iframes
  useEffect(() => {
    if (isEmbedded) return;
    postToAllIframes({ __iterate: true, type: "set-preview", previewMode });
  }, [previewMode, isEmbedded, postToAllIframes]);

  // Listen for messages from iteration iframes (batch counts + ready handshake)
  useEffect(() => {
    if (isEmbedded) return;

    const handler = (e: MessageEvent) => {
      if (!isIterateMessage(e.data)) return;

      if (e.data.type === "batch-counts") {
        // Match e.source to a specific iteration iframe
        for (const [name, iframe] of Object.entries(iterationIframeRefs.current)) {
          if (iframe?.contentWindow === e.source) {
            setTabCounts((prev) => ({
              ...prev,
              [name]: { batch: e.data.batchCount ?? 0, move: e.data.moveCount ?? 0 },
            }));
            break;
          }
        }
      } else if (e.data.type === "ready") {
        // Find which iframe sent this ready message and sync state to it
        for (const [name, iframe] of Object.entries(iterationIframeRefs.current)) {
          if (iframe?.contentWindow === e.source) {
            const win = e.source as Window;
            win.postMessage(
              { __iterate: true, type: "set-iteration", iteration: name } as IterateMessage,
              "*"
            );
            // Send current mode only to the active iframe; browse to others
            win.postMessage(
              { __iterate: true, type: "set-mode", mode: name === iterationRef.current ? modeRef.current : "browse" } as IterateMessage,
              "*"
            );
            win.postMessage(
              { __iterate: true, type: "set-preview", previewMode: previewModeRef.current } as IterateMessage,
              "*"
            );
            break;
          }
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
      } else if (tool === "select" || tool === "move" || tool === "draw" || tool === "browse") {
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

  // Handle clearing all annotations and moves — clear ALL tabs
  const handleClearBatch = useCallback(() => {
    window.dispatchEvent(new CustomEvent("iterate:clear-batch"));
    postToAllIframes({ __iterate: true, type: "clear-batch" });
  }, [postToAllIframes]);

  // Handle copying annotations to clipboard — collect text from ALL tabs
  const handleCopyBatch = useCallback(() => {
    const promises: Promise<string>[] = [];

    // Collect from Original tab
    const origCounts = tabCounts[ORIGINAL_TAB];
    if (origCounts && (origCounts.batch > 0 || origCounts.move > 0)) {
      promises.push(
        new Promise<string>((resolve) => {
          const handler = (e: Event) => {
            resolve((e as CustomEvent).detail.text ?? "");
            window.removeEventListener("iterate:batch-text-response", handler);
          };
          window.addEventListener("iterate:batch-text-response", handler);
          window.dispatchEvent(new CustomEvent("iterate:request-batch-text"));
          setTimeout(() => {
            window.removeEventListener("iterate:batch-text-response", handler);
            resolve("");
          }, 2000);
        })
      );
    }

    // Collect from each iteration iframe
    for (const [name, counts] of Object.entries(tabCounts)) {
      if (name === ORIGINAL_TAB) continue;
      if (counts.batch > 0 || counts.move > 0) {
        promises.push(
          new Promise<string>((resolve) => {
            const handler = (e: MessageEvent) => {
              if (!isIterateMessage(e.data)) return;
              if (e.data.type === "batch-text") {
                const iframe = iterationIframeRefs.current[name];
                if (iframe?.contentWindow === e.source) {
                  resolve(e.data.text ?? "");
                  window.removeEventListener("message", handler);
                }
              }
            };
            window.addEventListener("message", handler);
            postToIframe({ __iterate: true, type: "request-batch-text" }, name);
            setTimeout(() => {
              window.removeEventListener("message", handler);
              resolve("");
            }, 2000);
          })
        );
      }
    }

    if (promises.length === 0) return;

    Promise.all(promises).then((texts) => {
      const combined = texts.filter(Boolean).join("\n\n---\n\n");
      if (combined) navigator.clipboard.writeText(combined);
    });
  }, [tabCounts, postToIframe]);

  // Handle undo last change — only operates on the active tab
  const handleUndoMove = useCallback(() => {
    if (isViewingIteration) {
      postToIframe({ __iterate: true, type: "undo" });
    } else {
      window.dispatchEvent(new CustomEvent("iterate:undo"));
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

  // Clean up stale iframe refs when iterations are removed
  useEffect(() => {
    const currentNames = new Set(Object.keys(iterations));
    for (const name of Object.keys(iterationIframeRefs.current)) {
      if (!currentNames.has(name)) {
        delete iterationIframeRefs.current[name];
      }
    }
    // Also clean up stale tabCounts for removed iterations
    setTabCounts((prev) => {
      const cleaned: Record<string, { batch: number; move: number }> = {};
      for (const [key, val] of Object.entries(prev)) {
        if (key === ORIGINAL_TAB || currentNames.has(key)) {
          cleaned[key] = val;
        }
      }
      return cleaned;
    });
  }, [iterations]);

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

  // Show/hide the portal container based on whether we're viewing an iteration
  useEffect(() => {
    const portal = iframePortalRef.current;
    if (!portal) return;
    if (isViewingIteration && hasReadyIterations) {
      portal.style.display = "block";
      portal.style.pointerEvents = "auto";
    } else {
      portal.style.display = "none";
      portal.style.pointerEvents = "none";
    }
  }, [isViewingIteration, hasReadyIterations]);

  // The parent IterateOverlay always uses iframeRef.
  // When viewing iterations, parent overlay is forced to browse mode — the
  // actual tools are handled by the embedded overlay inside each iteration iframe.
  const activeIframeRef = iframeRef;

  // If embedded in an iframe, only render the IterateOverlay (no FloatingPanel)
  if (isEmbedded) {
    return (
      <IterateOverlay
        mode={mode}
        iteration={iteration}
        wsUrl={wsUrl}
        iframeRef={iframeRef}
        onBatchCountChange={(count) => {
          setTabCounts((prev) => ({
            ...prev,
            [iteration]: { batch: count, move: prev[iteration]?.move ?? 0 },
          }));
        }}
        onMoveCountChange={(count) => {
          setTabCounts((prev) => ({
            ...prev,
            [iteration]: { batch: prev[iteration]?.batch ?? 0, move: count },
          }));
        }}
        previewMode={previewMode}
      />
    );
  }

  return (
    <>
      {/* Iteration preview iframes — ALL ready iterations are rendered simultaneously
          via portal OUTSIDE overlay root to avoid pointer-events:none inheritance.
          Only the active iteration is visible; others stay hidden to preserve state. */}
      {iframePortalRef.current && readyIterations.length > 0 && createPortal(
        <>
          {readyIterations.map(([name, info]) => (
            <iframe
              key={name}
              ref={(el) => { iterationIframeRefs.current[name] = el; }}
              src={`http://${window.location.hostname}:${info.port}/`}
              style={{
                width: "100%",
                height: "100%",
                border: "none",
                display: name === iteration ? "block" : "none",
                position: "absolute",
                inset: 0,
              }}
              title={`Iteration: ${name}`}
            />
          ))}
        </>,
        iframePortalRef.current
      )}

      {/* Full-screen overlay layer — always rendered to preserve state across tab switches.
          When viewing iterations: forced to browse mode so parent tools don't intercept
          events on the parent document. The embedded overlay inside the iframe handles
          actual tool interactions for iterations. */}
      <IterateOverlay
        mode={isViewingIteration ? "browse" : mode}
        iteration={ORIGINAL_TAB}
        wsUrl={wsUrl}
        iframeRef={activeIframeRef}
        onBatchCountChange={(count) => {
          setTabCounts((prev) => ({
            ...prev,
            [ORIGINAL_TAB]: { batch: count, move: prev[ORIGINAL_TAB]?.move ?? 0 },
          }));
        }}
        onMoveCountChange={(count) => {
          setTabCounts((prev) => ({
            ...prev,
            [ORIGINAL_TAB]: { batch: prev[ORIGINAL_TAB]?.batch ?? 0, move: count },
          }));
        }}
        previewMode={previewMode}
        visible={visible && !isViewingIteration}
      />

      {/* Floating toolbar panel */}
      <FloatingPanel
        mode={mode}
        onModeChange={handleModeChange}
        visible={visible}
        onVisibilityChange={setVisible}
        batchCount={totalBatchCount}
        moveCount={totalMoveCount}
        onClearBatch={handleClearBatch}
        onCopyBatch={handleCopyBatch}
        onUndoMove={handleUndoMove}
        iterations={iterations}
        activeIteration={iteration}
        onIterationChange={handleIterationChange}
        onFork={handleFork}
        onPick={handlePick}
        onDiscard={handleDiscard}
        isViewingIteration={isViewingIteration}
        tabBadgeCounts={tabBadgeCounts}
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
