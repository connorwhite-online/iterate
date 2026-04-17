import { join, isAbsolute, resolve } from "node:path";
import { existsSync } from "node:fs";
import { execa } from "execa";
import type { AppConfig, IterateConfig, IterationInfo } from "iterate-ui-core";
import { loadEnvFiles } from "iterate-ui-core/node";
import type { ProcessManager } from "../process/manager.js";
import type { StateStore } from "../state/store.js";
import type { WebSocketHub } from "../websocket/hub.js";

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
 */
export async function runIterationPipeline(ctx: IterationStartContext): Promise<void> {
  const { repoRoot, worktreeRoot, app, info, config, processManager, store, wsHub } = ctx;

  // Install
  info.status = "installing";
  store.setIteration(info.name, info);
  wsHub.broadcast({ type: "iteration:status", payload: { name: info.name, status: "installing" } });

  const installCmd = app.installCommand ?? getInstallCommand(app.packageManager ?? config.packageManager);
  const [icmd, ...iargs] = installCmd.split(" ");
  await execa(icmd!, iargs, { cwd: worktreeRoot });

  // Optional build
  const buildCmd = app.buildCommand ?? config.buildCommand;
  if (buildCmd) {
    const [bcmd, ...bargs] = buildCmd.split(" ");
    await execa(bcmd!, bargs, { cwd: worktreeRoot });
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

  const { pid } = await processManager.start(info.name, devCwd, command, allocatedPort, {
    ITERATE_WORKTREE_ROOT: worktreeRoot,
    ITERATE_APP_NAME: app.name,
    ...childEnv,
  });
  info.pid = pid ?? null;

  await processManager.waitForReady(info.name, allocatedPort);

  info.status = "ready";
  store.setIteration(info.name, info);
}

/** Join a repo root and an optional appDir, always returning an absolute path. */
export function joinAppDir(root: string, appDir?: string): string {
  if (!appDir) return root;
  return isAbsolute(appDir) ? appDir : join(root, appDir);
}
