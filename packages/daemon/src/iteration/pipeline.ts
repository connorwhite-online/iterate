import { join, isAbsolute, resolve } from "node:path";
import { existsSync } from "node:fs";
import { execa } from "execa";
import {
  findApp,
  getDefaultApp,
  type AppConfig,
  type IterateConfig,
  type IterationInfo,
} from "iterate-ui-core";
import { loadEnvFiles } from "iterate-ui-core/node";
import { cloneNodeModules } from "../worktree/clone-modules.js";
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
 * Resolve the effective package manager for an app (per-app override wins over
 * the top-level config default).
 */
export function resolvePackageManager(
  app: AppConfig,
  config: IterateConfig
): IterateConfig["packageManager"] {
  return app.packageManager ?? config.packageManager;
}

/**
 * Append npm fix-up flags (`--no-audit --no-fund`) to a default npm install
 * command. After a hardlink clone, npm only reconciles drift, so we skip the
 * audit/funding passes that add seconds without value. Only mutates the
 * package-manager defaults from `getInstallCommand` — a user-supplied
 * `installCommand` is left exactly as written.
 */
export function withNpmFixupFlags(installCmd: string): string {
  if (!/^npm\b/.test(installCmd)) return installCmd;
  let cmd = installCmd;
  if (!/--no-audit\b/.test(cmd)) cmd += " --no-audit";
  if (!/--no-fund\b/.test(cmd)) cmd += " --no-fund";
  return cmd;
}

/**
 * Resolve the optional build command to run after install for a single app.
 *
 * Reads ONLY `app.buildCommand` — it deliberately does NOT fall back to the
 * legacy top-level `config.buildCommand`. That top-level command is a repo-wide
 * build and applies solely to the legacy single-app migration path, where
 * `normalizeConfig` (see iterate-ui-core `config.ts`) copies it onto the
 * synthesized app's `buildCommand`. A genuine multi-app `apps[]` entry must opt
 * in to a build explicitly via its own `app.buildCommand`; otherwise a repo-wide
 * build would run for every iteration of every app even when only one app is
 * being iterated on (CON-169).
 */
export function resolveBuildCommand(app: AppConfig): string | undefined {
  return app.buildCommand;
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

  const pm = resolvePackageManager(app, config);
  const usingDefaultInstall = !app.installCommand;
  let installCmd = app.installCommand ?? getInstallCommand(pm);

  // Hardlink-clone node_modules from the main repo (and the app subdir, for
  // appDir setups) before installing, for npm/yarn/bun. npm then no-ops on the
  // linked packages and installs only drift — typically a >3x speedup over a
  // cold install. pnpm shares its content-addressable store already, so it's
  // skipped. Any failure falls back to the plain install; never fails creation.
  if (pm !== "pnpm") {
    const appSrc = resolveAppCwd(repoRoot, app);
    const appDest = resolveAppCwd(worktreeRoot, app);
    // Clone the repo-root node_modules, plus the app subdir's when appDir
    // points somewhere other than the root (monorepo / per-app installs).
    const sources: Array<[src: string, dest: string]> = [[repoRoot, worktreeRoot]];
    if (appSrc !== repoRoot) sources.push([appSrc, appDest]);

    for (const [src, dest] of sources) {
      const result = cloneNodeModules(src, dest);
      if (!result.cloned && !result.skipped) {
        // A genuine failure (e.g. EXDEV cross-device, permissions) — not a
        // benign skip. Log and let the fix-up install reconcile from scratch.
        console.log(`[iterate] node_modules clone failed (${result.reason}), falling back to full install`);
      }
    }

    // After a clone, npm only reconciles drift — add the fix-up flags so it
    // skips audit/funding. Leave any user-supplied installCommand untouched.
    if (usingDefaultInstall) installCmd = withNpmFixupFlags(installCmd);
  }

  const [icmd, ...iargs] = installCmd.split(" ");
  await execa(icmd!, iargs, { cwd: worktreeRoot });

  // Optional build (per-app only; see resolveBuildCommand for why the legacy
  // top-level config.buildCommand is not applied to multi-app entries).
  //
  // Intentionally inherit the ambient environment here (no `env` override). Turbo
  // resolves its local cache through the git common dir, so a turbo-routed build in a
  // fresh worktree reuses the main repo's `.turbo/cache` for free (measured: 42s cold →
  // ~1.6s ">>> FULL TURBO" in a second worktree, turbo 2.8.10). Do NOT set
  // `TURBO_CACHE_DIR` / `--cache-dir` to a per-worktree path — that would silently
  // disable this sharing. See docs: worktree-workflow "Build caches across iterations".
  const buildCmd = resolveBuildCommand(app);
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
