import { join, isAbsolute, resolve } from "node:path";
import { existsSync } from "node:fs";
import { execa } from "execa";
import {
  findApp,
  getDefaultApp,
  type AppConfig,
  type IterateConfig,
  type IterationInfo,
  type PhaseTimings,
} from "iterate-ui-core";
import { loadEnvFiles } from "iterate-ui-core/node";
import type { ProcessManager } from "../process/manager.js";
import type { StateStore } from "../state/store.js";
import type { WebSocketHub } from "../websocket/hub.js";

/**
 * Resolve which app to use for an incoming request, given an optional caller-supplied
 * app name. Returns undefined if the caller didn't specify one and the config has
 * multiple apps (so there's no unambiguous default).
 */
export function resolveAppForRequest(config: IterateConfig, appName: string | undefined): AppConfig | undefined {
  if (appName) return findApp(config, appName);
  return getDefaultApp(config);
}

/**
 * Resolve which app an externally-created worktree targets. Supported conventions:
 *   1. `iterate/<appName>/<rest>` — explicit; chooses the matching app.
 *   2. `iterate/<rest>` or any other branch — falls back to the sole configured app.
 * Returns undefined if the repo has multiple apps and the branch name doesn't
 * disambiguate — the worktree is left untracked rather than misconfigured.
 */
/**
 * Count iterations belonging to a given app.
 *
 * `maxIterations` is a per-app cap, not a global one — three iterations
 * of `next-16-example` should not exhaust the quota for `vite-example`.
 *
 * Iterations without an `appName` are treated as belonging to the sole
 * configured app when the config has only one app (legacy single-app
 * behavior). In multi-app configs, untagged iterations are orphans and
 * count toward no app's quota.
 */
export function countIterationsForApp(
  iterations: Record<string, IterationInfo>,
  config: IterateConfig,
  appName: string,
): number {
  const isSingleApp = config.apps.length <= 1;
  let count = 0;
  for (const info of Object.values(iterations)) {
    if (info.appName === appName) count += 1;
    else if (!info.appName && isSingleApp) count += 1;
  }
  return count;
}

export function resolveAppForWorktreeBranch(config: IterateConfig, branch: string): AppConfig | undefined {
  const iteratePrefix = "iterate/";
  if (branch.startsWith(iteratePrefix)) {
    const rest = branch.slice(iteratePrefix.length);
    const firstSlash = rest.indexOf("/");
    if (firstSlash !== -1) {
      const candidate = rest.slice(0, firstSlash);
      const matched = findApp(config, candidate);
      if (matched) return matched;
    }
  }
  return getDefaultApp(config);
}

/**
 * Resolve the working directory for an app, handling optional appDir.
 * `cwd` is the root of the worktree (or the main repo, for external worktrees).
 */
export function resolveAppCwd(root: string, app: AppConfig): string {
  if (!app.appDir) return root;
  const abs = isAbsolute(app.appDir) ? app.appDir : resolve(root, app.appDir);
  return existsSync(abs) ? abs : root;
}

/**
 * Build the dev command string + env overrides for an app.
 *
 * Behavior:
 * - If `portEnvVar` is set, we pass the port via that env var and leave `devCommand` untouched.
 *   This lets wrapper scripts (dotenv-cli, env-cmd, doppler run, etc.) run unmodified.
 * - Otherwise fall back to the legacy heuristic: append `-p <port>` for `next`, `--port <port>`
 *   for `vite`, and set `PORT` env var for anything else.
 */
export function buildDevCommand(app: AppConfig, port: number): {
  command: string;
  env: Record<string, string>;
} {
  if (app.portEnvVar) {
    return { command: app.devCommand, env: { [app.portEnvVar]: String(port) } };
  }
  if (/\bnext\b/.test(app.devCommand)) {
    return { command: `${app.devCommand} -p ${port}`, env: {} };
  }
  if (/\bvite\b/.test(app.devCommand)) {
    return { command: `${app.devCommand} --port ${port}`, env: {} };
  }
  return { command: app.devCommand, env: { PORT: String(port) } };
}

/**
 * Return the install command to run at the worktree root for the given package manager.
 */
export function getInstallCommand(pm: IterateConfig["packageManager"] | undefined): string {
  switch (pm) {
    case "pnpm":
      return "pnpm install --prefer-offline";
    case "yarn":
      return "yarn install";
    case "bun":
      return "bun install";
    case "npm":
    default:
      return "npm install --prefer-offline";
  }
}

/**
 * Build the merged child env for a dev server:
 *   (process.env) → (envFiles, later-wins) → (envPassthrough subset) → (portEnv)
 *
 * envPassthrough lets you forward host-shell secrets (e.g. DOPPLER_TOKEN) without
 * putting them in dotenv files.
 */
export function buildChildEnv(
  repoRoot: string,
  config: IterateConfig,
  app: AppConfig,
  portEnv: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};

  // Files at the repo level (all apps) would go in config.envPassthrough names, not envFiles —
  // iterate keeps envFiles per-app to avoid cross-app leaks.
  const fromFiles = loadEnvFiles(repoRoot, app.envFiles ?? []);
  Object.assign(out, fromFiles);

  if (config.envPassthrough) {
    for (const key of config.envPassthrough) {
      const val = process.env[key];
      if (typeof val === "string") out[key] = val;
    }
  }

  Object.assign(out, portEnv);
  return out;
}

export interface IterationStartContext {
  /** Root of the main repo (daemon's cwd). Used to resolve config-relative paths. */
  repoRoot: string;
  /** Directory to run install in (the worktree root). */
  worktreeRoot: string;
  /** Resolved app config for this iteration. */
  app: AppConfig;
  /** Iteration metadata object (mutated in-place to reflect status transitions). */
  info: IterationInfo;
  config: IterateConfig;
  processManager: ProcessManager;
  store: StateStore;
  wsHub: WebSocketHub;
}

/**
 * Run the install → build → start sequence for a single iteration. Updates
 * `info.status`, broadcasts status transitions, allocates a port, and waits
 * for the dev server to accept connections.
 *
 * Throws on any step failure. The caller is expected to catch, set the
 * `error` status, and broadcast.
 *
 * Each phase is wrapped in a monotonic timer; durations (ms) are logged as
 * structured lines (`[iterate] <name> install 7421ms`) and attached to the
 * final `iteration:status` broadcast as a `timings` record so clients can
 * surface elapsed-per-phase (pairs with CON-124). Always-on and cheap — the
 * only overhead is a couple of `performance.now()` reads per phase.
 */
export async function runIterationPipeline(ctx: IterationStartContext): Promise<void> {
  const { repoRoot, worktreeRoot, app, info, config, processManager, store, wsHub } = ctx;

  const timings: PhaseTimings = {};
  const pipelineStart = performance.now();
  /** Run `fn`, record its wall-clock duration under `phase`, and log it. */
  const timed = async <T>(phase: string, fn: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      const ms = Math.round(performance.now() - start);
      timings[phase] = ms;
      console.log(`[iterate] ${info.name} ${phase} ${ms}ms`);
    }
  };

  // Install
  info.status = "installing";
  store.setIteration(info.name, info);
  wsHub.broadcast({ type: "iteration:status", payload: { name: info.name, status: "installing" } });

  const installCmd = app.installCommand ?? getInstallCommand(app.packageManager ?? config.packageManager);
  const [icmd, ...iargs] = installCmd.split(" ");
  await timed("install", () => execa(icmd!, iargs, { cwd: worktreeRoot }));

  // Optional build
  const buildCmd = app.buildCommand ?? config.buildCommand;
  if (buildCmd) {
    const [bcmd, ...bargs] = buildCmd.split(" ");
    await timed("build", () => execa(bcmd!, bargs, { cwd: worktreeRoot }));
  }

  // Start dev server
  info.status = "starting";
  store.setIteration(info.name, info);
  wsHub.broadcast({ type: "iteration:status", payload: { name: info.name, status: "starting" } });

  const devCwd = resolveAppCwd(worktreeRoot, app);
  const allocatedPort = await processManager.allocatePort();
  info.port = allocatedPort;

  const { command, env: portEnv } = buildDevCommand(app, allocatedPort);
  const childEnv = buildChildEnv(repoRoot, config, app, portEnv);

  // Spawn the dev server and wait for it to accept connections — measured as a
  // single phase since the spawn is near-instant and the port wait dominates.
  await timed("spawn", async () => {
    const { pid } = await processManager.start(info.name, devCwd, command, allocatedPort, {
      ITERATE_WORKTREE_ROOT: worktreeRoot,
      ITERATE_APP_NAME: app.name,
      ...childEnv,
    });
    info.pid = pid ?? null;
    await processManager.waitForReady(info.name, allocatedPort);
  });

  timings.total = Math.round(performance.now() - pipelineStart);
  console.log(`[iterate] ${info.name} total ${timings.total}ms`);

  info.status = "ready";
  store.setIteration(info.name, info);
  wsHub.broadcast({ type: "iteration:status", payload: { name: info.name, status: "ready", timings } });
}

/** Join a repo root and an optional appDir, always returning an absolute path. */
export function joinAppDir(root: string, appDir?: string): string {
  if (!appDir) return root;
  return isAbsolute(appDir) ? appDir : join(root, appDir);
}
