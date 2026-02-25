import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyReplyFrom from "@fastify/reply-from";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
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

  /** List all iterations */
  app.get("/api/iterations", async () => {
    return store.getIterations();
  });

  /** Create a new iteration */
  app.post("/api/iterations", async (request, reply) => {
    const { name, baseBranch } = request.body as {
      name: string;
      baseBranch?: string;
    };

    if (!name) {
      return reply.status(400).send({ message: "Name is required" });
    }

    const existing = store.getIteration(name);
    if (existing) {
      return reply.status(409).send({ message: `Iteration "${name}" already exists` });
    }

    const iterationCount = Object.keys(store.getIterations()).length;
    if (iterationCount >= config.maxIterations) {
      return reply.status(429).send({
        message: `Maximum iterations (${config.maxIterations}) reached. Remove one first.`,
      });
    }

    try {
      // Create worktree
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

      const { worktreePath, branch } = await worktreeManager.create(
        name,
        baseBranch
      );
      info.worktreePath = worktreePath;
      info.branch = branch;

      // Install dependencies
      info.status = "installing";
      store.setIteration(name, info);
      wsHub.broadcast({ type: "iteration:status", payload: { name, status: "installing" } });

      const installCmd =
        config.packageManager === "pnpm"
          ? "pnpm install --prefer-offline"
          : config.packageManager === "yarn"
            ? "yarn install"
            : config.packageManager === "bun"
              ? "bun install"
              : "npm install --prefer-offline";

      const { execa: execaFn } = await import("execa");
      const [cmd, ...args] = installCmd.split(" ");
      await execaFn(cmd!, args, { cwd: worktreePath });

      // Start dev server
      info.status = "starting";
      store.setIteration(name, info);
      wsHub.broadcast({ type: "iteration:status", payload: { name, status: "starting" } });

      const allocatedPort = await processManager.allocatePort();
      info.port = allocatedPort;

      // Construct dev command with port override
      const devCommand = buildDevCommand(config.devCommand, allocatedPort);
      const { pid } = await processManager.start(
        name,
        worktreePath,
        devCommand,
        allocatedPort
      );
      info.pid = pid ?? null;
      info.status = "ready";
      store.setIteration(name, info);

      wsHub.broadcast({ type: "iteration:created", payload: info });
      wsHub.broadcast({ type: "iteration:status", payload: { name, status: "ready" } });

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

  /** Remove an iteration */
  app.delete("/api/iterations/:name", async (request, reply) => {
    const { name } = request.params as { name: string };
    const iteration = store.getIteration(name);

    if (!iteration) {
      return reply.status(404).send({ message: `Iteration "${name}" not found` });
    }

    await processManager.stop(name);
    await worktreeManager.remove(name);
    store.removeIteration(name);
    wsHub.broadcast({ type: "iteration:removed", payload: { name } });

    return { ok: true };
  });

  /** Pick a winner */
  app.post("/api/iterations/pick", async (request, reply) => {
    const { name, strategy } = request.body as {
      name: string;
      strategy?: "merge" | "squash" | "rebase";
    };

    const iteration = store.getIteration(name);
    if (!iteration) {
      return reply.status(404).send({ message: `Iteration "${name}" not found` });
    }

    // Stop all dev servers
    await processManager.stopAll();

    // Merge winner and remove all worktrees
    const allNames = Object.keys(store.getIterations());
    await worktreeManager.pick(name, allNames, strategy);

    // Clear state
    for (const n of allNames) {
      store.removeIteration(n);
      wsHub.broadcast({ type: "iteration:removed", payload: { name: n } });
    }

    return { ok: true, merged: name };
  });

  /** List annotations */
  app.get("/api/annotations", async () => {
    return store.getAnnotations();
  });

  /** Shutdown */
  app.post("/api/shutdown", async (_request, reply) => {
    await processManager.stopAll();
    await reply.send({ ok: true });
    // Graceful shutdown
    setTimeout(() => process.exit(0), 500);
  });

  // Proxy routes for iterations (must be registered last)
  await registerProxyRoutes(app, store);

  // Root route: serve the control UI shell
  app.get("/", async (_request, reply) => {
    return reply.type("text/html").send(getShellHTML(config));
  });

  // Start server
  try {
    await app.listen({ port, host: "0.0.0.0" });
    console.log(`iterate daemon running on http://localhost:${port}`);
  } catch (err) {
    console.error("Failed to start daemon:", err);
    process.exit(1);
  }

  // Cleanup on exit
  const cleanup = async () => {
    console.log("\nShutting down iterate daemon...");
    await processManager.stopAll();
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

/** Build the dev command with port override */
function buildDevCommand(baseCommand: string, port: number): string {
  // Handle common frameworks' port flags
  if (baseCommand.includes("next")) {
    return `${baseCommand} -p ${port}`;
  }
  if (baseCommand.includes("vite")) {
    return `${baseCommand} --port ${port}`;
  }
  // Generic: rely on PORT env var (set in ProcessManager)
  return baseCommand;
}

/** Generate the shell HTML for the control UI */
function getShellHTML(config: IterateConfig): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>iterate</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #fafafa; height: 100vh; display: flex; flex-direction: column; }
    #tab-bar { display: flex; gap: 2px; padding: 8px 12px; background: #141414; border-bottom: 1px solid #2a2a2a; }
    .tab { padding: 6px 16px; border-radius: 6px 6px 0 0; background: #1a1a1a; color: #888; cursor: pointer; font-size: 13px; border: 1px solid transparent; transition: all 0.15s; }
    .tab:hover { color: #ccc; background: #222; }
    .tab.active { color: #fff; background: #0a0a0a; border-color: #2a2a2a; border-bottom-color: #0a0a0a; }
    .tab.add { color: #555; font-size: 16px; }
    #toolbar { display: flex; gap: 8px; padding: 8px 12px; background: #111; border-bottom: 1px solid #2a2a2a; }
    .tool-btn { padding: 4px 12px; border-radius: 4px; background: #1a1a1a; color: #888; cursor: pointer; font-size: 12px; border: 1px solid #2a2a2a; }
    .tool-btn.active { color: #fff; background: #2563eb; border-color: #2563eb; }
    #viewport { flex: 1; position: relative; overflow: hidden; }
    #viewport iframe { width: 100%; height: 100%; border: none; }
    #empty-state { display: flex; align-items: center; justify-content: center; height: 100%; color: #555; font-size: 14px; flex-direction: column; gap: 8px; }
    #empty-state code { background: #1a1a1a; padding: 4px 8px; border-radius: 4px; font-size: 13px; }
    #status-bar { padding: 4px 12px; background: #111; border-top: 1px solid #2a2a2a; font-size: 11px; color: #555; display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <div id="tab-bar">
    <div class="tab add" id="add-tab" title="New iteration">+</div>
  </div>
  <div id="toolbar">
    <button class="tool-btn active" data-tool="select">Select</button>
    <button class="tool-btn" data-tool="annotate">Annotate</button>
    <button class="tool-btn" data-tool="move">Move</button>
  </div>
  <div id="viewport">
    <div id="empty-state">
      <p>No iterations yet.</p>
      <p>Run <code>iterate branch &lt;name&gt;</code> to create one.</p>
    </div>
  </div>
  <div id="status-bar">
    <span id="status-text">Connected</span>
    <span>iterate v0.1.0</span>
  </div>

  <script>
    const ws = new WebSocket(\`ws://\${location.host}/ws\`);
    let state = { iterations: {}, annotations: [] };
    let activeIteration = null;
    let activeTool = 'select';

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'state:sync':
          state = msg.payload;
          renderTabs();
          break;
        case 'iteration:created':
        case 'iteration:status':
          if (msg.payload.name) {
            state.iterations[msg.payload.name] = { ...state.iterations[msg.payload.name], ...msg.payload };
          }
          renderTabs();
          break;
        case 'iteration:removed':
          delete state.iterations[msg.payload.name];
          if (activeIteration === msg.payload.name) activeIteration = null;
          renderTabs();
          break;
      }
    };

    ws.onclose = () => {
      document.getElementById('status-text').textContent = 'Disconnected';
    };

    function renderTabs() {
      const bar = document.getElementById('tab-bar');
      const names = Object.keys(state.iterations);
      bar.innerHTML = '';

      for (const name of names) {
        const tab = document.createElement('div');
        tab.className = 'tab' + (name === activeIteration ? ' active' : '');
        tab.textContent = name;
        const info = state.iterations[name];
        if (info.status !== 'ready') tab.textContent += ' (' + info.status + ')';
        tab.onclick = () => switchIteration(name);
        bar.appendChild(tab);
      }

      const addTab = document.createElement('div');
      addTab.className = 'tab add';
      addTab.textContent = '+';
      addTab.title = 'New iteration (run iterate branch <name>)';
      bar.appendChild(addTab);

      if (!activeIteration && names.length > 0) {
        switchIteration(names[0]);
      }
      if (names.length === 0) {
        showEmptyState();
      }
    }

    function switchIteration(name) {
      activeIteration = name;
      const info = state.iterations[name];
      const viewport = document.getElementById('viewport');

      if (info && info.status === 'ready') {
        viewport.innerHTML = '<iframe src="/' + name + '/" loading="lazy"></iframe>';
      } else {
        viewport.innerHTML = '<div id="empty-state"><p>Iteration "' + name + '" is ' + (info?.status ?? 'unknown') + '...</p></div>';
      }

      renderTabs();
    }

    function showEmptyState() {
      document.getElementById('viewport').innerHTML =
        '<div id="empty-state"><p>No iterations yet.</p><p>Run <code>iterate branch &lt;name&gt;</code> to create one.</p></div>';
    }

    // Toolbar
    document.getElementById('toolbar').addEventListener('click', (e) => {
      const btn = e.target.closest('.tool-btn');
      if (!btn) return;
      activeTool = btn.dataset.tool;
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  </script>
</body>
</html>`;
}

// Run directly if invoked as a script
if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))
) {
  startDaemon();
}
