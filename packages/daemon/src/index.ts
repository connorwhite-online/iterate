import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyReplyFrom from "@fastify/reply-from";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execa } from "execa";
import { DEFAULT_CONFIG, type IterateConfig, type IterationInfo } from "@iterate/core";
import { StateStore } from "./state/store.js";
import { WorktreeManager } from "./worktree/manager.js";
import { ProcessManager } from "./process/manager.js";
import { WebSocketHub } from "./websocket/hub.js";
import { registerProxyRoutes } from "./proxy/router.js";

export interface DaemonOptions {
  port?: number;
  cwd?: string;
}

export async function startDaemon(opts: DaemonOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.env.ITERATE_CWD ?? process.cwd();
  const port =
    opts.port ?? parseInt(process.env.ITERATE_PORT ?? "4000", 10);

  // Load config
  const configPath = join(cwd, ".iterate", "config.json");
  const config: IterateConfig = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, "utf-8"))
    : DEFAULT_CONFIG;

  // Initialize services
  const store = new StateStore(config);
  const worktreeManager = new WorktreeManager(cwd);
  const processManager = new ProcessManager(config.basePort);
  const wsHub = new WebSocketHub(store);

  // Create Fastify server
  const app = Fastify({ logger: true });

  await app.register(fastifyWebsocket);
  await app.register(fastifyReplyFrom);

  // WebSocket endpoint
  wsHub.register(app);

  // --- REST API ---

  app.get("/api/iterations", async () => {
    return store.getIterations();
  });

  app.post("/api/iterations", async (request, reply) => {
    const { name, baseBranch } = request.body as {
      name: string;
      baseBranch?: string;
    };

    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      return reply.status(400).send({
        message: "Name is required and must be alphanumeric (hyphens/underscores allowed)",
      });
    }

    if (store.getIteration(name)) {
      return reply.status(409).send({ message: `Iteration "${name}" already exists` });
    }

    const iterationCount = Object.keys(store.getIterations()).length;
    if (iterationCount >= config.maxIterations) {
      return reply.status(429).send({
        message: `Maximum iterations (${config.maxIterations}) reached. Remove one first.`,
      });
    }

    try {
      const info: IterationInfo = {
        name,
        branch: `iterate/${name}`,
        worktreePath: "",
        port: 0,
        pid: null,
        status: "creating",
        createdAt: new Date().toISOString(),
      };
      store.setIteration(name, info);
      wsHub.broadcast({ type: "iteration:status", payload: { name, status: "creating" } });

      const { worktreePath, branch } = await worktreeManager.create(name, baseBranch);
      info.worktreePath = worktreePath;
      info.branch = branch;

      // Install dependencies
      info.status = "installing";
      store.setIteration(name, info);
      wsHub.broadcast({ type: "iteration:status", payload: { name, status: "installing" } });

      const installCmd = getInstallCommand(config.packageManager);
      const [cmd, ...args] = installCmd.split(" ");
      await execa(cmd!, args, { cwd: worktreePath });

      // Start dev server
      info.status = "starting";
      store.setIteration(name, info);
      wsHub.broadcast({ type: "iteration:status", payload: { name, status: "starting" } });

      const allocatedPort = await processManager.allocatePort();
      info.port = allocatedPort;

      const devCommand = buildDevCommand(config.devCommand, allocatedPort);
      const { pid } = await processManager.start(name, worktreePath, devCommand, allocatedPort);
      info.pid = pid ?? null;
      info.status = "ready";
      store.setIteration(name, info);

      wsHub.broadcast({ type: "iteration:created", payload: info });

      return info;
    } catch (err) {
      const info = store.getIteration(name);
      if (info) {
        info.status = "error";
        store.setIteration(name, info);
        wsHub.broadcast({ type: "iteration:status", payload: { name, status: "error" } });
      }
      return reply.status(500).send({
        message: `Failed to create iteration: ${(err as Error).message}`,
      });
    }
  });

  app.delete("/api/iterations/:name", async (request, reply) => {
    const { name } = request.params as { name: string };
    const iteration = store.getIteration(name);

    if (!iteration) {
      return reply.status(404).send({ message: `Iteration "${name}" not found` });
    }

    await processManager.stop(name);
    try {
      await worktreeManager.remove(name);
    } catch {
      // Worktree may already be removed
    }
    store.removeIteration(name);
    wsHub.broadcast({ type: "iteration:removed", payload: { name } });

    return { ok: true };
  });

  app.post("/api/iterations/pick", async (request, reply) => {
    const { name, strategy } = request.body as {
      name: string;
      strategy?: "merge" | "squash" | "rebase";
    };

    const iteration = store.getIteration(name);
    if (!iteration) {
      return reply.status(404).send({ message: `Iteration "${name}" not found` });
    }

    await processManager.stopAll();

    const allNames = Object.keys(store.getIterations());

    try {
      await worktreeManager.pick(name, allNames, strategy);
    } catch (err) {
      return reply.status(500).send({
        message: `Pick failed: ${(err as Error).message}`,
      });
    }

    for (const n of allNames) {
      store.removeIteration(n);
      wsHub.broadcast({ type: "iteration:removed", payload: { name: n } });
    }

    return { ok: true, merged: name };
  });

  app.get("/api/annotations", async () => {
    return store.getAnnotations();
  });

  app.get("/api/annotations/pending", async () => {
    const pending = store.getPendingAnnotations();
    return { count: pending.length, annotations: pending };
  });

  /** Acknowledge an annotation (agent has seen it) */
  app.patch("/api/annotations/:id/acknowledge", async (request, reply) => {
    const { id } = request.params as { id: string };
    const updated = store.updateAnnotation(id, { status: "acknowledged" });
    if (!updated) return reply.status(404).send({ message: "Annotation not found" });
    wsHub.broadcast({ type: "annotation:updated", payload: updated });
    return updated;
  });

  /** Resolve an annotation (agent addressed the feedback) */
  app.patch("/api/annotations/:id/resolve", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { summary } = (request.body as { summary?: string }) ?? {};
    const updated = store.updateAnnotation(id, {
      status: "resolved",
      resolvedBy: "agent",
      agentReply: summary,
    });
    if (!updated) return reply.status(404).send({ message: "Annotation not found" });
    wsHub.broadcast({ type: "annotation:updated", payload: updated });
    return updated;
  });

  /** Dismiss an annotation (agent chose not to address it) */
  app.patch("/api/annotations/:id/dismiss", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { reason } = (request.body as { reason?: string }) ?? {};
    const updated = store.updateAnnotation(id, {
      status: "dismissed",
      resolvedBy: "agent",
      agentReply: reason,
    });
    if (!updated) return reply.status(404).send({ message: "Annotation not found" });
    wsHub.broadcast({ type: "annotation:updated", payload: updated });
    return updated;
  });

  app.get("/api/dom-changes", async () => {
    return store.getDomChanges();
  });

  app.post("/api/shutdown", async (_request, reply) => {
    await processManager.stopAll();
    await reply.send({ ok: true });
    setTimeout(() => process.exit(0), 500);
  });

  // Serve the overlay standalone bundle
  let overlayBundle: string | null = null;
  app.get("/__iterate__/overlay.js", async (_request, reply) => {
    if (!overlayBundle) {
      try {
        const require = createRequire(import.meta.url);
        const overlayPath = require.resolve("@iterate/overlay/standalone");
        overlayBundle = readFileSync(overlayPath, "utf-8");
      } catch {
        return reply.status(404).send("Overlay bundle not found");
      }
    }
    return reply
      .type("application/javascript")
      .header("cache-control", "no-cache")
      .send(overlayBundle);
  });

  // Proxy routes (registered last — wildcard catch-all)
  await registerProxyRoutes(app, store);

  // Root route: control UI shell
  app.get("/", async (_request, reply) => {
    return reply.type("text/html").send(getShellHTML());
  });

  // Start server
  try {
    await app.listen({ port, host: "0.0.0.0" });
    console.log(`iterate daemon running on http://localhost:${port}`);
  } catch (err) {
    console.error("Failed to start daemon:", err);
    process.exit(1);
  }

  // Cleanup on exit — guard against double invocation
  let isShuttingDown = false;

  const cleanup = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log("\nShutting down iterate daemon...");
    try {
      await processManager.stopAll();
      await app.close();
    } catch (err) {
      console.error("Error during cleanup:", err);
    }
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

function getInstallCommand(pm: IterateConfig["packageManager"]): string {
  switch (pm) {
    case "pnpm": return "pnpm install --prefer-offline";
    case "yarn": return "yarn install";
    case "bun": return "bun install";
    default: return "npm install --prefer-offline";
  }
}

function buildDevCommand(baseCommand: string, port: number): string {
  if (baseCommand.includes("next")) return `${baseCommand} -p ${port}`;
  if (baseCommand.includes("vite")) return `${baseCommand} --port ${port}`;
  return baseCommand;
}

/** Shell HTML for the control UI. Fixes: XSS-safe DOM construction, WebSocket reconnect, correct state merge. */
function getShellHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>iterate</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #fafafa; height: 100vh; display: flex; flex-direction: column; }
    #tab-bar { display: flex; gap: 2px; padding: 8px 12px; background: #141414; border-bottom: 1px solid #2a2a2a; align-items: center; }
    .tab { padding: 6px 16px; border-radius: 6px 6px 0 0; background: #1a1a1a; color: #888; cursor: pointer; font-size: 13px; border: 1px solid transparent; transition: all 0.15s; user-select: none; }
    .tab:hover { color: #ccc; background: #222; }
    .tab.active { color: #fff; background: #0a0a0a; border-color: #2a2a2a; border-bottom-color: #0a0a0a; }
    .tab.add { color: #555; font-size: 16px; }
    .tab .status-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 6px; }
    .tab .status-dot.ready { background: #22c55e; }
    .tab .status-dot.creating, .tab .status-dot.installing, .tab .status-dot.starting { background: #eab308; }
    .tab .status-dot.error { background: #ef4444; }
    .tab .status-dot.stopped { background: #666; }
    #toolbar { display: flex; gap: 8px; padding: 8px 12px; background: #111; border-bottom: 1px solid #2a2a2a; }
    .tool-btn { padding: 4px 12px; border-radius: 4px; background: #1a1a1a; color: #888; cursor: pointer; font-size: 12px; border: 1px solid #2a2a2a; }
    .tool-btn:hover { color: #ccc; }
    .tool-btn.active { color: #fff; background: #2563eb; border-color: #2563eb; }
    #viewport { flex: 1; position: relative; overflow: hidden; }
    #viewport iframe { width: 100%; height: 100%; border: none; }
    .empty-state { display: flex; align-items: center; justify-content: center; height: 100%; color: #555; font-size: 14px; flex-direction: column; gap: 8px; }
    .empty-state code { background: #1a1a1a; padding: 4px 8px; border-radius: 4px; font-size: 13px; }
    #status-bar { padding: 4px 12px; background: #111; border-top: 1px solid #2a2a2a; font-size: 11px; color: #555; display: flex; justify-content: space-between; }
    #status-bar .connected { color: #22c55e; }
    #status-bar .disconnected { color: #ef4444; }
    #pick-btn { margin-left: auto; padding: 4px 12px; border-radius: 4px; background: #059669; color: #fff; cursor: pointer; font-size: 12px; border: 1px solid #059669; }
    #pick-btn:hover { background: #047857; }
  </style>
</head>
<body>
  <div id="tab-bar"></div>
  <div id="toolbar">
    <button class="tool-btn active" data-tool="select">Select</button>
    <button class="tool-btn" data-tool="annotate">Annotate</button>
    <button class="tool-btn" data-tool="move">Move</button>
    <button id="pick-btn" style="display:none">Pick this iteration</button>
  </div>
  <div id="viewport">
    <div class="empty-state">
      <p>No iterations yet.</p>
      <p>Run <code>iterate branch &lt;name&gt;</code> to create one.</p>
    </div>
  </div>
  <div id="status-bar">
    <span id="status-text" class="connected">Connected</span>
    <span>iterate v0.1.0</span>
  </div>

  <script>
    let state = { iterations: {}, annotations: [], domChanges: [], config: {} };
    let activeIteration = null;
    let activeTool = 'select';
    let ws = null;
    let reconnectDelay = 1000;

    // Expose state to the overlay
    window.__iterate_shell__ = { activeTool, activeIteration };

    function connect() {
      ws = new WebSocket('ws://' + location.host + '/ws');

      ws.onopen = () => {
        const el = document.getElementById('status-text');
        el.textContent = 'Connected';
        el.className = 'connected';
        reconnectDelay = 1000;
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      };

      ws.onerror = () => {
        // onclose will fire after this
      };

      ws.onclose = () => {
        const el = document.getElementById('status-text');
        el.textContent = 'Disconnected — reconnecting...';
        el.className = 'disconnected';
        setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
          connect();
        }, reconnectDelay);
      };
    }

    function handleMessage(msg) {
      switch (msg.type) {
        case 'state:sync':
          state = msg.payload;
          render();
          break;
        case 'iteration:created':
          state.iterations[msg.payload.name] = msg.payload;
          render();
          break;
        case 'iteration:status':
          // Only update the status field, don't overwrite the whole object
          if (state.iterations[msg.payload.name]) {
            state.iterations[msg.payload.name].status = msg.payload.status;
          }
          render();
          break;
        case 'iteration:removed':
          delete state.iterations[msg.payload.name];
          if (activeIteration === msg.payload.name) activeIteration = null;
          render();
          break;
        case 'annotation:created':
          state.annotations.push(msg.payload);
          break;
        case 'annotation:deleted':
          state.annotations = state.annotations.filter(a => a.id !== msg.payload.id);
          break;
      }
    }

    function render() {
      renderTabs();
      renderViewport();
      renderPickButton();
    }

    function renderTabs() {
      const bar = document.getElementById('tab-bar');
      bar.innerHTML = '';
      const names = Object.keys(state.iterations);

      for (const name of names) {
        const info = state.iterations[name];
        const tab = document.createElement('div');
        tab.className = 'tab' + (name === activeIteration ? ' active' : '');

        const dot = document.createElement('span');
        dot.className = 'status-dot ' + (info.status || 'stopped');
        tab.appendChild(dot);
        tab.appendChild(document.createTextNode(name));

        tab.addEventListener('click', () => switchIteration(name));
        bar.appendChild(tab);
      }

      const addTab = document.createElement('div');
      addTab.className = 'tab add';
      addTab.textContent = '+';
      addTab.title = 'Run: iterate branch <name>';
      bar.appendChild(addTab);

      // Auto-select first iteration
      if (!activeIteration && names.length > 0) {
        activeIteration = names[0];
        window.__iterate_shell__.activeIteration = activeIteration;
        window.dispatchEvent(new CustomEvent('iterate:iteration-change', { detail: { iteration: activeIteration } }));
      }
    }

    function renderViewport() {
      const viewport = document.getElementById('viewport');
      const names = Object.keys(state.iterations);

      if (names.length === 0) {
        viewport.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = '<p>No iterations yet.</p><p>Run <code>iterate branch &lt;name&gt;</code> to create one.</p>';
        viewport.appendChild(empty);
        return;
      }

      if (!activeIteration) return;

      const info = state.iterations[activeIteration];
      if (!info) return;

      // Check if iframe already shows the correct iteration
      const existingIframe = viewport.querySelector('iframe');
      const expectedSrc = '/' + encodeURIComponent(activeIteration) + '/';

      if (existingIframe && existingIframe.dataset.iteration === activeIteration) {
        return; // Already showing correct iteration
      }

      viewport.innerHTML = '';

      if (info.status === 'ready') {
        const iframe = document.createElement('iframe');
        iframe.src = expectedSrc;
        iframe.dataset.iteration = activeIteration;
        iframe.loading = 'lazy';
        viewport.appendChild(iframe);
      } else {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        const p = document.createElement('p');
        p.textContent = 'Iteration "' + activeIteration + '" is ' + (info.status || 'unknown') + '...';
        empty.appendChild(p);
        viewport.appendChild(empty);
      }
    }

    function renderPickButton() {
      const btn = document.getElementById('pick-btn');
      const names = Object.keys(state.iterations);
      btn.style.display = (activeIteration && names.length > 0) ? 'block' : 'none';
    }

    function switchIteration(name) {
      activeIteration = name;
      window.__iterate_shell__.activeIteration = name;
      window.dispatchEvent(new CustomEvent('iterate:iteration-change', { detail: { iteration: name } }));
      render();
    }

    // Pick button
    document.getElementById('pick-btn').addEventListener('click', async () => {
      if (!activeIteration) return;
      if (!confirm('Pick "' + activeIteration + '"? This will merge it and remove all other iterations.')) return;

      try {
        const res = await fetch('/api/iterations/pick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: activeIteration }),
        });
        if (res.ok) {
          activeIteration = null;
        } else {
          const err = await res.json();
          alert('Pick failed: ' + (err.message || 'Unknown error'));
        }
      } catch (e) {
        alert('Pick failed: ' + e.message);
      }
    });

    // Toolbar
    document.getElementById('toolbar').addEventListener('click', (e) => {
      const btn = e.target.closest('.tool-btn');
      if (!btn || btn.id === 'pick-btn') return;
      activeTool = btn.dataset.tool;
      window.__iterate_shell__.activeTool = activeTool;
      window.dispatchEvent(new CustomEvent('iterate:tool-change', { detail: { tool: activeTool } }));
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });

    connect();
  </script>
  <script src="/__iterate__/overlay.js" defer></script>
</body>
</html>`;
}

// Run directly if invoked as a script
const scriptUrl = import.meta.url;
if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  scriptUrl.endsWith(process.argv[1].replace(/\\/g, "/"))
) {
  startDaemon();
}
