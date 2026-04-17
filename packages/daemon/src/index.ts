import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyReplyFrom from "@fastify/reply-from";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  DEFAULT_CONFIG,
  type IterateConfig,
  type IterationInfo,
} from "iterate-ui-core";
import {
  findFreePort,
  writeLockfile,
  removeLockfile,
  readLockfile,
  isDaemonAlive,
  loadConfig,
} from "iterate-ui-core/node";
import { StateStore } from "./state/store.js";
import { WorktreeManager } from "./worktree/manager.js";
import { ProcessManager } from "./process/manager.js";
import { WebSocketHub } from "./websocket/hub.js";
import { copyFilesToWorktree, copyUncommittedFiles } from "./worktree/copy-files.js";
import { registerProxyRoutes } from "./proxy/router.js";
import {
  runIterationPipeline,
  resolveAppForRequest,
  resolveAppForWorktreeBranch,
} from "./iteration/pipeline.js";

export interface DaemonOptions {
  port?: number;
  cwd?: string;
}

export async function startDaemon(opts: DaemonOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.env.ITERATE_CWD ?? process.cwd();

  // Load config (normalizeConfig applied inside loadConfig — legacy flat
  // configs become apps[])
  const config: IterateConfig = loadConfig(cwd) ?? { ...DEFAULT_CONFIG };

  // Resolve daemon port:
  //   explicit opt.port → ITERATE_PORT env → auto-pick starting from config.daemonPort.
  // If a prior lockfile points at an already-alive daemon for this cwd, we don't start
  // a second one — the framework plugins will reach the existing daemon.
  const existingLock = readLockfile(cwd);
  if (existingLock && isDaemonAlive(existingLock) && !opts.port && !process.env.ITERATE_PORT) {
    console.log(`[iterate] daemon already running on port ${existingLock.port} (pid ${existingLock.pid})`);
    return;
  }
  // Stale lock — clean up.
  if (existingLock && !isDaemonAlive(existingLock)) {
    removeLockfile(cwd);
  }

  const requestedPort = opts.port ?? (process.env.ITERATE_PORT ? parseInt(process.env.ITERATE_PORT, 10) : undefined);
  const port = requestedPort ?? (await findFreePort(config.daemonPort));

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
    const { name, baseBranch, appName } = request.body as {
      name: string;
      baseBranch?: string;
      appName?: string;
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

    const app = resolveAppForRequest(config, appName);
    if (!app) {
      return reply.status(400).send({
        message: appName
          ? `App "${appName}" not registered in .iterate/config.json.`
          : `No app specified and config has ${config.apps.length} apps — pass "appName" in the request body.`,
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
        source: "iterate",
        appName: app.name,
      };
      store.setIteration(name, info);
      wsHub.broadcast({ type: "iteration:status", payload: { name, status: "creating" } });

      const { worktreePath, branch } = await worktreeManager.create(name, baseBranch);
      info.worktreePath = worktreePath;
      info.branch = branch;

      // Copy config files (e.g., .env.local) and uncommitted changes into the new worktree
      copyFilesToWorktree(cwd, worktreePath, config.copyFiles ?? [".env*", ".npmrc"]);
      copyUncommittedFiles(cwd, worktreePath);

      await runIterationPipeline({
        repoRoot: cwd,
        worktreeRoot: worktreePath,
        app,
        info,
        config,
        processManager,
        store,
        wsHub,
      });

      wsHub.broadcast({ type: "iteration:created", payload: info });

      return info;
    } catch (err) {
      const errorMessage = (err as Error).message;
      const recentOutput = processManager.getRecentOutput(name);
      const detail = recentOutput.length > 0
        ? `${errorMessage}\n\nDev server output:\n${recentOutput.join("\n")}`
        : errorMessage;
      const info = store.getIteration(name);
      if (info) {
        info.status = "error";
        info.error = detail;
        store.setIteration(name, info);
        wsHub.broadcast({ type: "iteration:status", payload: { name, status: "error", error: detail } });
      }
      return reply.status(500).send({
        message: `Failed to create iteration: ${detail}`,
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

    if (iteration.source !== "external") {
      // Iterate-created worktree: remove worktree and branch
      try {
        await worktreeManager.remove(name);
      } catch {
        // Worktree may already be removed
      }
    } else if (iteration.worktreePath) {
      // External worktrees: remove the worktree and branch so they're fully cleaned up.
      try {
        await worktreeManager.removeByPath(iteration.worktreePath, iteration.branch, true);
      } catch {
        // Worktree may already be removed — add to ignored set as fallback
        // so the discovery loop won't re-register it.
        ignoredPaths.add(iteration.worktreePath);
      }
    }

    // Clean up changes and DOM changes belonging to this iteration
    const { changeIds, domChangeIds } = store.removeIterationData(name);
    for (const id of changeIds) {
      wsHub.broadcast({ type: "change:deleted", payload: { id } });
    }
    for (const id of domChangeIds) {
      wsHub.broadcast({ type: "dom:deleted", payload: { id } });
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

    const allIterations = Object.values(store.getIterations()).map((it) => ({
      name: it.name,
      worktreePath: it.worktreePath,
      branch: it.branch,
      source: it.source,
    }));

    try {
      await worktreeManager.pick(
        iteration.branch,
        iteration.worktreePath,
        allIterations,
        strategy
      );
    } catch (err) {
      return reply.status(500).send({
        message: `Pick failed: ${(err as Error).message}`,
      });
    }

    for (const iter of allIterations) {
      const { changeIds, domChangeIds } = store.removeIterationData(iter.name);
      for (const id of changeIds) {
        wsHub.broadcast({ type: "change:deleted", payload: { id } });
      }
      for (const id of domChangeIds) {
        wsHub.broadcast({ type: "dom:deleted", payload: { id } });
      }
      store.removeIteration(iter.name);
      wsHub.broadcast({ type: "iteration:removed", payload: { name: iter.name } });
    }

    return { ok: true, merged: name };
  });

  app.get("/api/changes", async () => {
    return store.getChanges();
  });

  app.get("/api/changes/pending", async () => {
    const pending = store.getPendingChanges();
    return { count: pending.length, changes: pending };
  });

  /** Mark a change as in-progress (agent has seen it and is working on it) */
  app.patch("/api/changes/:id/start", async (request, reply) => {
    const { id } = request.params as { id: string };
    const updated = store.updateChange(id, { status: "in-progress" });
    if (!updated) return reply.status(404).send({ message: "Change not found" });
    wsHub.broadcast({ type: "change:updated", payload: updated });
    return updated;
  });

  /** Mark a change as implemented (agent addressed the feedback) */
  app.patch("/api/changes/:id/implement", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { summary } = (request.body as { summary?: string }) ?? {};
    const change = store.getChange(id);
    if (!change) return reply.status(404).send({ message: "Change not found" });

    // Build the response before removing
    Object.assign(change, {
      status: "implemented" as const,
      implementedBy: "agent" as const,
      agentSummary: summary,
    });
    const result = { ...change };

    // Remove the implemented change from the store
    store.removeChange(id);
    wsHub.broadcast({ type: "change:deleted", payload: { id } });

    // If no more changes remain, clear all DOM changes too
    if (store.getChanges().length === 0) {
      const domChanges = store.getDomChanges();
      store.clearDomChanges();
      for (const dc of domChanges) {
        wsHub.broadcast({ type: "dom:deleted", payload: { id: dc.id } });
      }
    }

    return result;
  });

  app.get("/api/dom-changes", async () => {
    return store.getDomChanges();
  });

  /** Remove a DOM change (agent has implemented the move/reorder) */
  app.delete("/api/dom-changes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const removed = store.removeDomChange(id);
    if (!removed) return reply.status(404).send({ message: "DOM change not found" });
    wsHub.broadcast({ type: "dom:deleted", payload: { id } });
    return { ok: true };
  });

  app.get("/api/command-context", async () => {
    const latest = store.getLatestCommand();
    if (!latest) return { command: null };
    return { command: latest };
  });

  app.get("/api/command-context/:commandId", async (request, reply) => {
    const { commandId } = request.params as { commandId: string };
    const cmd = store.getCommandContext(commandId);
    if (!cmd) return reply.status(404).send({ message: "Command not found" });
    return cmd;
  });

  /** Submit a command (e.g. /iterate prompt) to create multiple iterations */
  app.post("/api/command", async (request, reply) => {
    const { command, prompt, count = 3, appName } = request.body as {
      command: string;
      prompt?: string;
      count?: number;
      appName?: string;
    };

    if (command !== "iterate") {
      return reply.status(400).send({ message: `Unknown command: ${command}` });
    }

    const app = resolveAppForRequest(config, appName);
    if (!app) {
      return reply.status(400).send({
        message: appName
          ? `App "${appName}" not registered in .iterate/config.json.`
          : `Config has ${config.apps.length} apps — pass "appName" in the request body.`,
      });
    }

    const commandId = crypto.randomUUID();
    const iterationNames: string[] = [];
    const clampedCount = Math.min(Math.max(count, 1), config.maxIterations);

    // Create N iterations with the command context
    for (let i = 1; i <= clampedCount; i++) {
      const suffix = prompt?.trim()
        ? `-${prompt.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20)}`
        : "";
      const name = `v${i}${suffix}`;

      // Skip if already exists
      if (store.getIteration(name)) continue;

      const iterationCount = Object.keys(store.getIterations()).length;
      if (iterationCount >= config.maxIterations) break;

      try {
        const info: IterationInfo = {
          name,
          branch: `iterate/${name}`,
          worktreePath: "",
          port: 0,
          pid: null,
          status: "creating",
          createdAt: new Date().toISOString(),
          commandPrompt: prompt?.trim() ?? "",
          commandId,
          source: "iterate",
          appName: app.name,
        };
        store.setIteration(name, info);
        // Broadcast as iteration:created so overlay tracks all iterations immediately
        // (enables correct auto-select ordering before async pipelines complete)
        wsHub.broadcast({ type: "iteration:created", payload: info });

        // Create worktree (async — don't await all sequentially for speed)
        iterationNames.push(name);

        // Fire off the creation pipeline
        (async () => {
          try {
            const { worktreePath, branch } = await worktreeManager.create(name);
            info.worktreePath = worktreePath;
            info.branch = branch;

            // Copy config files (e.g., .env.local) and uncommitted changes into the new worktree
            copyFilesToWorktree(cwd, worktreePath, config.copyFiles ?? [".env*", ".npmrc"]);
            copyUncommittedFiles(cwd, worktreePath);

            await runIterationPipeline({
              repoRoot: cwd,
              worktreeRoot: worktreePath,
              app,
              info,
              config,
              processManager,
              store,
              wsHub,
            });

            wsHub.broadcast({ type: "iteration:created", payload: info });
          } catch (err) {
            const errorMessage = (err as Error).message;
            const recentOutput = processManager.getRecentOutput(name);
            const detail = recentOutput.length > 0
              ? `${errorMessage}\n\nDev server output:\n${recentOutput.join("\n")}`
              : errorMessage;
            console.error(`[iterate] Failed to create iteration "${name}":`, errorMessage);
            info.status = "error";
            info.error = detail;
            store.setIteration(name, info);
            wsHub.broadcast({ type: "iteration:status", payload: { name, status: "error", error: detail } });
          }
        })();
      } catch (err) {
        console.error(`[iterate] Error setting up iteration:`, (err as Error).message);
      }
    }

    // Broadcast command started
    wsHub.broadcast({
      type: "command:started",
      payload: { commandId, prompt: prompt?.trim() ?? "", iterations: iterationNames },
    });

    // Store command context for MCP retrieval
    store.setCommandContext(commandId, prompt?.trim() ?? "", iterationNames);

    return { ok: true, commandId, iterations: iterationNames };
  });

  app.post("/api/shutdown", async (_request, reply) => {
    await processManager.stopAll();
    removeLockfile(cwd);
    await reply.send({ ok: true });
    setTimeout(() => process.exit(0), 500);
  });

  // Serve the overlay standalone bundle
  let overlayBundle: string | null = null;
  app.get("/__iterate__/overlay.js", async (_request, reply) => {
    if (!overlayBundle) {
      try {
        const require = createRequire(import.meta.url);
        const overlayPath = require.resolve("iterate-ui-overlay/standalone");
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
  await registerProxyRoutes(app, store, port, config);

  // Root route: control UI shell
  app.get("/", async (_request, reply) => {
    return reply.type("text/html").send(getShellHTML());
  });

  // Start server
  try {
    await app.listen({ port, host: "0.0.0.0" });
    console.log(`iterate daemon running on http://localhost:${port}`);
    writeLockfile(cwd, {
      pid: process.pid,
      port,
      cwd,
      startedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Failed to start daemon:", err);
    process.exit(1);
  }

  // --- General worktree detection ---
  // Discover existing worktrees on startup and scan periodically
  const pendingPaths = new Set<string>();
  const ignoredPaths = new Set<string>();

  const scanWorktrees = async () => {
    try {
      await discoverAndRegisterWorktrees(
        worktreeManager, processManager, store, wsHub, config, pendingPaths, ignoredPaths
      );
    } catch (err) {
      console.error("[iterate] Worktree scan failed:", err);
    }
  };

  // Initial scan
  await scanWorktrees();

  // Periodic scan every 5 seconds
  const scanInterval = setInterval(scanWorktrees, 5000);

  // Cleanup on exit — guard against double invocation
  let isShuttingDown = false;

  const cleanup = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    clearInterval(scanInterval);
    console.log("\nShutting down iterate daemon...");

    // Remove the lockfile immediately so CLI/plugins can see the daemon is
    // going away. Do this before we await any potentially-hanging work.
    removeLockfile(cwd);

    // Hard upper bound: even if processManager.stopAll() or Fastify's app.close()
    // hangs on keep-alive sockets, we exit within 2s to avoid leaking the process.
    const forceExit = setTimeout(() => process.exit(0), 2000);
    // Don't block Node from exiting naturally if cleanup finishes first.
    forceExit.unref();

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

// --- Worktree discovery ---

/** Derive a display name from a branch name */
function deriveIterationName(branch: string): string {
  // "iterate/v1-cards" → "v1-cards"
  if (branch.startsWith("iterate/")) return branch.slice("iterate/".length);
  // Take the last segment after any slash
  const parts = branch.split("/");
  let name = parts[parts.length - 1] ?? branch;
  // Sanitize: only allow alphanumeric, hyphens, underscores
  name = name.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return name || branch.replace(/[^a-zA-Z0-9_-]/g, "-");
}

/** Generate a unique iteration name, appending a suffix if needed */
function uniqueName(baseName: string, store: StateStore): string {
  if (!store.getIteration(baseName)) return baseName;
  let i = 2;
  while (store.getIteration(`${baseName}-${i}`)) i++;
  return `${baseName}-${i}`;
}

/**
 * Discover git worktrees not yet tracked by the daemon and register them.
 * Also removes iterations for worktrees that have disappeared.
 */
async function discoverAndRegisterWorktrees(
  worktreeManager: WorktreeManager,
  processManager: ProcessManager,
  store: StateStore,
  wsHub: WebSocketHub,
  config: IterateConfig,
  pendingPaths: Set<string>,
  ignoredPaths: Set<string>
): Promise<void> {
  const allWorktrees = await worktreeManager.discoverAll();
  const currentIterations = store.getIterations();

  // Get the actual git repo root (main worktree) to skip it
  const repoRoot = await worktreeManager.getRepoRoot();

  // Build a set of known worktree paths for quick lookup
  const knownPaths = new Set(
    Object.values(currentIterations).map((it) => it.worktreePath)
  );

  for (const wt of allWorktrees) {
    // Skip the main worktree (repo root)
    if (wt.path === repoRoot) continue;

    // Skip detached HEAD worktrees
    if (wt.detached) continue;

    // Skip if already tracked, currently being registered, or explicitly dismissed
    if (knownPaths.has(wt.path)) continue;
    if (pendingPaths.has(wt.path)) continue;
    if (ignoredPaths.has(wt.path)) continue;

    // Skip if any existing iteration has this branch
    const alreadyTrackedByBranch = Object.values(currentIterations).some(
      (it) => it.branch === wt.branch
    );
    if (alreadyTrackedByBranch) continue;

    // Respect maxIterations limit
    const iterationCount = Object.keys(store.getIterations()).length + pendingPaths.size;
    if (iterationCount >= config.maxIterations) break;

    // This is a new, untracked worktree — register it.
    // Resolve which app this worktree targets:
    //  - Branch convention "iterate/<appName>/<rest>" wins if <appName> matches a registered app.
    //  - Otherwise fall back to the sole configured app (getDefaultApp).
    //  - If neither works in a multi-app repo, skip the worktree (can't infer intent).
    const app = resolveAppForWorktreeBranch(config, wt.branch);
    if (!app) {
      // Can't infer app; leave as untracked rather than starting with wrong config
      continue;
    }

    pendingPaths.add(wt.path);
    const baseName = deriveIterationName(wt.branch);
    const name = uniqueName(baseName, store);

    const info: IterationInfo = {
      name,
      branch: wt.branch,
      worktreePath: wt.path,
      port: 0,
      pid: null,
      status: "creating",
      createdAt: new Date().toISOString(),
      source: "external",
      appName: app.name,
    };

    store.setIteration(name, info);
    wsHub.broadcast({ type: "iteration:created", payload: info });

    // Fire off the startup pipeline asynchronously
    (async () => {
      try {
        await runIterationPipeline({
          repoRoot,
          worktreeRoot: wt.path,
          app,
          info,
          config,
          processManager,
          store,
          wsHub,
        });
        wsHub.broadcast({ type: "iteration:created", payload: info });
      } catch (err) {
        const errorMessage = (err as Error).message;
        const recentOutput = processManager.getRecentOutput(name);
        const detail = recentOutput.length > 0
          ? `${errorMessage}\n\nDev server output:\n${recentOutput.join("\n")}`
          : errorMessage;
        console.error(`[iterate] Failed to start external worktree "${name}":`, errorMessage);
        info.status = "error";
        info.error = detail;
        store.setIteration(name, info);
        wsHub.broadcast({ type: "iteration:status", payload: { name, status: "error", error: detail } });
      } finally {
        pendingPaths.delete(wt.path);
      }
    })();
  }

  // Handle removal: check if any tracked external iterations have disappeared
  const worktreePaths = new Set(allWorktrees.map((wt) => wt.path));
  for (const [name, iteration] of Object.entries(currentIterations)) {
    if (iteration.source !== "external") continue;
    if (!iteration.worktreePath) continue;
    if (worktreePaths.has(iteration.worktreePath)) continue;

    console.log(`[iterate] External worktree "${name}" no longer exists, removing...`);
    await processManager.stop(name);
    store.removeIteration(name);
    wsHub.broadcast({ type: "iteration:removed", payload: { name } });
  }
}

/** Shell HTML for the control UI with command bar and updated toolbar. */
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
    .tab { position: relative; padding: 6px 28px 6px 16px; border-radius: 6px 6px 0 0; background: #1a1a1a; color: #888; cursor: pointer; font-size: 13px; border: 1px solid transparent; transition: all 0.15s; user-select: none; display: flex; align-items: center; gap: 2px; }
    .tab:hover { color: #ccc; background: #222; }
    .tab:hover .tab-close { opacity: 1; }
    .tab.active { color: #fff; background: #0a0a0a; border-color: #2a2a2a; border-bottom-color: #0a0a0a; }
    .tab.active .tab-close { opacity: 0.6; }
    .tab.add { color: #555; font-size: 16px; padding: 6px 16px; }
    .tab .status-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 6px; flex-shrink: 0; }
    .tab .status-dot.ready { background: #22c55e; }
    .tab .status-dot.creating, .tab .status-dot.installing, .tab .status-dot.starting { background: #eab308; animation: pulse 1.5s ease-in-out infinite; }
    .tab .status-dot.error { background: #ef4444; }
    .tab .status-dot.stopped { background: #666; }
    .tab .status-label { font-size: 10px; color: #666; margin-left: 6px; font-style: italic; }
    .tab.active .status-label { color: #888; }
    .tab .tab-close { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; border-radius: 3px; color: #888; opacity: 0; transition: opacity 0.15s, background 0.15s; font-size: 16px; line-height: 1; }
    .tab .tab-close:hover { background: #2a2a2a; color: #fff; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    #command-bar { display: flex; align-items: center; padding: 6px 12px; background: #111; border-bottom: 1px solid #2a2a2a; }
    #command-input { flex: 1; background: #0a0a1a; border: 1px solid #2a2a4a; border-radius: 6px; color: #fafafa; padding: 6px 12px; font-size: 13px; font-family: monospace; outline: none; }
    #command-input:focus { border-color: #2563eb; }
    #command-input::placeholder { color: #444; }
    #toolbar { display: flex; gap: 8px; padding: 6px 12px; background: #111; border-bottom: 1px solid #2a2a2a; align-items: center; }
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
  <div id="command-bar">
    <input id="command-input" type="text" placeholder="/iterate make 3 variations of the hero section..." />
  </div>
  <div id="toolbar">
    <button class="tool-btn active" data-tool="select">Select</button>
    <button class="tool-btn" data-tool="move">Move</button>
    <button id="pick-btn" style="display:none">Pick this iteration</button>
  </div>
  <div id="viewport">
    <div class="empty-state">
      <p>No iterations yet.</p>
      <p>Type <code>/iterate &lt;prompt&gt;</code> above or run <code>iterate branch &lt;name&gt;</code></p>
    </div>
  </div>
  <div id="status-bar">
    <span id="status-text" class="connected">Connected</span>
    <span>iterate v0.2.0</span>
  </div>

  <script>
    let state = { iterations: {}, changes: [], domChanges: [], config: {} };
    let activeIteration = null;
    let activeTool = 'select';
    let ws = null;
    let reconnectDelay = 1000;
    window.__iterate_shell__ = { activeTool, activeIteration };

    function connect() {
      ws = new WebSocket('ws://' + location.host + '/ws');
      ws.onopen = () => { document.getElementById('status-text').textContent = 'Connected'; document.getElementById('status-text').className = 'connected'; reconnectDelay = 1000; };
      ws.onmessage = (event) => handleMessage(JSON.parse(event.data));
      ws.onerror = () => {};
      ws.onclose = () => { document.getElementById('status-text').textContent = 'Disconnected'; document.getElementById('status-text').className = 'disconnected'; setTimeout(() => { reconnectDelay = Math.min(reconnectDelay * 1.5, 10000); connect(); }, reconnectDelay); };
    }

    function handleMessage(msg) {
      switch (msg.type) {
        case 'state:sync': state = msg.payload; render(); break;
        case 'iteration:created': state.iterations[msg.payload.name] = msg.payload; render(); break;
        case 'iteration:status': if (state.iterations[msg.payload.name]) { state.iterations[msg.payload.name].status = msg.payload.status; if (msg.payload.error) state.iterations[msg.payload.name].error = msg.payload.error; } render(); break;
        case 'iteration:removed': delete state.iterations[msg.payload.name]; if (activeIteration === msg.payload.name) activeIteration = null; render(); break;
        case 'change:created': state.changes.push(msg.payload); break;
        case 'change:deleted': state.changes = state.changes.filter(a => a.id !== msg.payload.id); break;
        case 'command:started': if (msg.payload.iterations.length > 0 && !activeIteration) switchIteration(msg.payload.iterations[0]); break;
      }
    }

    function render() { renderTabs(); renderViewport(); renderPickButton(); }

    function renderTabs() {
      const bar = document.getElementById('tab-bar'); bar.innerHTML = '';
      const names = Object.keys(state.iterations);
      // Only show app badges if the repo actually has multiple registered apps.
      const configuredApps = (state.config && Array.isArray(state.config.apps)) ? state.config.apps : [];
      const showAppBadges = configuredApps.length > 1;
      for (const name of names) {
        const info = state.iterations[name]; const tab = document.createElement('div');
        tab.className = 'tab' + (name === activeIteration ? ' active' : '');
        const dot = document.createElement('span'); dot.className = 'status-dot ' + (info.status || 'stopped');
        tab.appendChild(dot); tab.appendChild(document.createTextNode(name));
        if (showAppBadges && info.appName) {
          const appBadge = document.createElement('span');
          appBadge.style.cssText = 'font-size:9px;color:#888;margin-left:4px;padding:1px 5px;border-radius:3px;background:#222;';
          appBadge.textContent = info.appName;
          tab.appendChild(appBadge);
        }
        if (info.source === 'external') { const badge = document.createElement('span'); badge.style.cssText = 'font-size:9px;color:#666;margin-left:4px;'; badge.textContent = '(ext)'; tab.appendChild(badge); }
        // Tiny italic status label next to the name for non-ready iterations —
        // lets users distinguish "installing" from "starting" at a glance
        // without having to click the tab.
        if (info.status && info.status !== 'ready') {
          const statusLabel = document.createElement('span');
          statusLabel.className = 'status-label';
          statusLabel.textContent = info.status;
          tab.appendChild(statusLabel);
        }
        // Tooltip combines the /iterate prompt (if any) and the error message
        // (if any), so hovering a red tab tells you both what was attempted
        // and why it failed.
        const tooltipParts = [info.commandPrompt, info.error].filter(Boolean);
        if (tooltipParts.length > 0) tab.title = tooltipParts.join(' — ');
        // Close (×) button. Calls DELETE /api/iterations/<name>. We stop
        // propagation so clicking × doesn't ALSO switch to that tab.
        const close = document.createElement('span');
        close.className = 'tab-close';
        close.textContent = '×';
        close.title = 'Remove this iteration';
        close.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('Remove iteration "' + name + '"? This deletes the worktree and branch.')) return;
          try {
            const res = await fetch('/api/iterations/' + encodeURIComponent(name), { method: 'DELETE' });
            if (!res.ok) { const err = await res.json().catch(() => ({})); alert('Remove failed: ' + (err.message || res.status)); }
          } catch (err) { alert('Remove failed: ' + err.message); }
        });
        tab.appendChild(close);
        tab.addEventListener('click', () => switchIteration(name)); bar.appendChild(tab);
      }
      const addTab = document.createElement('div'); addTab.className = 'tab add'; addTab.textContent = '+';
      addTab.title = 'Type /iterate <prompt> in the command bar'; bar.appendChild(addTab);
      if (!activeIteration && names.length > 0) { activeIteration = names[0]; window.__iterate_shell__.activeIteration = activeIteration; window.dispatchEvent(new CustomEvent('iterate:iteration-change', { detail: { iteration: activeIteration } })); }
    }

    const iframeCache = {};

    function renderViewport() {
      const viewport = document.getElementById('viewport'); const names = Object.keys(state.iterations);
      if (names.length === 0) { viewport.innerHTML = '<div class="empty-state"><p>No iterations yet.</p><p>Type <code>/iterate &lt;prompt&gt;</code> above to get started.</p></div>'; iframeCache && Object.keys(iframeCache).forEach(k => delete iframeCache[k]); return; }
      if (!activeIteration) return; const info = state.iterations[activeIteration]; if (!info) return;
      // Hide all iframes, show only the active one
      viewport.querySelectorAll('iframe').forEach(f => f.style.display = 'none');
      // Remove stale overlays and empty states
      viewport.querySelectorAll('.empty-state').forEach(el => el.remove());
      if (info.status === 'ready') {
        let iframe = iframeCache[activeIteration];
        if (!iframe) { iframe = document.createElement('iframe'); iframe.src = '/' + encodeURIComponent(activeIteration) + '/'; iframe.dataset.iteration = activeIteration; viewport.appendChild(iframe); iframeCache[activeIteration] = iframe; }
        iframe.style.display = '';
      } else {
        const empty = document.createElement('div'); empty.className = 'empty-state';
        const statusText = document.createElement('p'); statusText.textContent = 'Iteration "' + activeIteration + '" is ' + (info.status || 'unknown') + '...'; empty.appendChild(statusText);
        if (info.status === 'error' && info.error) { const errEl = document.createElement('code'); errEl.style.cssText = 'color:#ef4444;font-size:12px;max-width:600px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;padding:8px 12px;background:#1a1a1a;border-radius:6px;margin-top:8px;display:block;'; errEl.textContent = info.error; empty.appendChild(errEl); }
        viewport.appendChild(empty);
      }
    }

    function renderPickButton() { const btn = document.getElementById('pick-btn'); btn.style.display = (activeIteration && Object.keys(state.iterations).length > 0) ? 'block' : 'none'; }

    function switchIteration(name) { activeIteration = name; window.__iterate_shell__.activeIteration = name; window.dispatchEvent(new CustomEvent('iterate:iteration-change', { detail: { iteration: name } })); render(); }

    // Listen for iteration switch requests from the overlay's FloatingPanel
    window.addEventListener('iterate:request-switch', (e) => { const name = e.detail?.iteration; if (name && state.iterations[name]) switchIteration(name); });


    document.getElementById('pick-btn').addEventListener('click', async () => {
      if (!activeIteration) return;
      if (!confirm('Pick "' + activeIteration + '"? This will merge it and remove all other iterations.')) return;
      try { const res = await fetch('/api/iterations/pick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: activeIteration }) }); if (res.ok) activeIteration = null; else { const err = await res.json(); alert('Pick failed: ' + (err.message || 'Unknown error')); } } catch (e) { alert('Pick failed: ' + e.message); }
    });

    document.getElementById('toolbar').addEventListener('click', (e) => {
      const btn = e.target.closest('.tool-btn'); if (!btn || btn.id === 'pick-btn') return;
      activeTool = btn.dataset.tool; window.__iterate_shell__.activeTool = activeTool;
      window.dispatchEvent(new CustomEvent('iterate:tool-change', { detail: { tool: activeTool } }));
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active')); btn.classList.add('active');
    });

    document.getElementById('command-input').addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const input = e.target; const value = input.value.trim(); if (!value) return;
      const iterateMatch = value.match(/^\\/iterate\\s+(?:--count\\s+(\\d+)\\s+)?(.+)$/);
      let prompt, count = 3;
      if (iterateMatch) { count = iterateMatch[1] ? parseInt(iterateMatch[1]) : 3; prompt = iterateMatch[2]; }
      else { prompt = value.startsWith('/') ? value.slice(1).trim() : value; }
      if (!prompt) return;
      input.value = ''; input.disabled = true;
      try { await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'iterate', prompt, count }) }); } catch (err) { alert('Command failed: ' + err.message); }
      input.disabled = false; input.focus();
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
