import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import {
  findFreePort,
  isPortInUse,
  loadConfig,
  readLockfile,
  isDaemonAlive,
} from "iterate-ui-core/node";

/**
 * Get the installed Next.js major version, or null if undetectable.
 * Resolves from the app's cwd since `next` is a peer dependency and
 * may not be resolvable from this package's own module context (e.g. pnpm).
 */
let _nextMajorVersion: number | null | undefined;
function getNextMajorVersion(): number | null {
  if (_nextMajorVersion !== undefined) return _nextMajorVersion;
  try {
    const appRequire = createRequire(join(process.cwd(), "noop.js"));
    const nextPkg = JSON.parse(readFileSync(appRequire.resolve("next/package.json"), "utf-8"));
    _nextMajorVersion = parseInt(nextPkg.version.split(".")[0], 10);
  } catch {
    _nextMajorVersion = null;
  }
  return _nextMajorVersion;
}

/**
 * Detect whether Turbopack is active.
 * Next.js 16+ defaults to Turbopack unless --webpack is passed.
 */
function isTurbopackMode(): boolean {
  if (process.env.TURBOPACK === "1") return true;
  if (process.argv.some((a) => a === "--turbo" || a === "--turbopack")) return true;
  // Next.js 16+ defaults to turbopack — detect by reading next/package.json
  const major = getNextMajorVersion();
  if (major !== null && major >= 16 && !process.argv.includes("--webpack")) return true;
  return false;
}

/**
 * Resolve a package's entry point via require.resolve, falling back to
 * reading the package.json for ESM-only packages without a "require" export.
 */
function resolvePackageEntry(packageName: string, _require: NodeRequire): string {
  try {
    return _require.resolve(packageName);
  } catch {
    const pkgJsonPath = _require.resolve(`${packageName}/package.json`);
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    const main = pkg.exports?.["."]?.import ?? pkg.main ?? "index.js";
    return join(dirname(pkgJsonPath), main);
  }
}

export interface IterateNextOptions {
  /**
   * Port for the iterate daemon. If omitted, resolved in order:
   *   1. NEXT_PUBLIC_ITERATE_DAEMON_PORT env var
   *   2. An already-running daemon's port from .iterate/daemon.lock
   *   3. `daemonPort` from .iterate/config.json
   *   4. Auto-picked starting from the default (47100)
   */
  daemonPort?: number;
  /**
   * Name of the app this plugin instance wraps. Must match a `name` in
   * `.iterate/config.json`'s `apps[]` array. When set, the overlay forwards
   * this name to the daemon's `/api/command` and `/api/iterations` endpoints
   * when the user creates iterations via the overlay toolbar — so iterations
   * spawn the right dev server for the app the user is currently viewing
   * (and not whatever the first configured app happens to be).
   *
   * Required in multi-app repos. Optional (and harmless) in single-app
   * repos where there's no ambiguity.
   */
  appName?: string;
  /** Disable the babel plugin that injects component names/source locations (default: false) */
  disableBabelPlugin?: boolean;
}

type NextConfig = Record<string, any>;

let daemon: ChildProcess | null = null;
let daemonStarting = false;
// Dedup warnings across multiple module loads (Next may load the config
// through both the CJS and ESM entries in the same process).
function warnOnce(key: string, message: string): void {
  const g = globalThis as Record<string, unknown>;
  const slot = (g.__iterateWarnedSet ?? new Set<string>()) as Set<string>;
  g.__iterateWarnedSet = slot;
  if (slot.has(key)) return;
  slot.add(key);
  console.warn(message);
}

/**
 * Module-level memo so multiple calls to the returned config function
 * (Next may call it for different phases — dev, build, etc.) all agree on
 * the same daemon port and don't spawn multiple daemons.
 */
let portResolution: Promise<number> | null = null;

async function resolveDaemonPort(repoRoot: string, startingFrom: number, override?: number): Promise<number> {
  if (override && Number.isFinite(override)) return override;
  if (!portResolution) {
    portResolution = (async () => {
      // Live daemon already running for this repo? Reuse its port.
      // (A stale lockfile is silently ignored — the daemon itself cleans it
      // up when it next starts.)
      const lock = readLockfile(repoRoot);
      if (lock && isDaemonAlive(lock)) return lock.port;
      // If the starting port is already listening, assume it's our daemon from
      // a concurrent plugin invocation and reuse it. Otherwise auto-pick upward.
      if (await isPortInUse(startingFrom)) return startingFrom;
      return await findFreePort(startingFrom);
    })();
  }
  return portResolution;
}

/**
 * Next.js config wrapper for iterate.
 *
 * Usage:
 * ```js
 * // next.config.mjs
 * import { withIterate } from 'iterate-ui-next'
 * export default withIterate({
 *   // ...your Next.js config
 * })
 * ```
 *
 * Automatically:
 * 1. Starts the iterate daemon when `next dev` runs
 * 2. Proxies /__iterate__/* and iterate API routes to the daemon via rewrites
 * 3. Injects component name attributes via babel plugin
 * 4. Cleans up daemon on exit
 */
export function withIterate(
  nextConfig: NextConfig = {},
  options: IterateNextOptions = {}
): (phase?: string) => Promise<NextConfig> {
  const isDev = process.env.NODE_ENV !== "production";
  const repoRoot = getGitRoot() ?? process.cwd();
  const fileConfig = (() => {
    try {
      return loadConfig(repoRoot);
    } catch {
      return null;
    }
  })();

  // Starting port: explicit option > env var > config file > default (47100)
  const envPort = process.env.ITERATE_DAEMON_PORT ? parseInt(process.env.ITERATE_DAEMON_PORT, 10) : undefined;
  const startingPort = options.daemonPort ?? envPort ?? fileConfig?.daemonPort ?? 47100;

  // Resolve the babel plugin path once per Node process (Next may call the
  // returned config function multiple times for different phases — we don't
  // want duplicate warnings).
  //
  // In the ESM build, tsup rewrites `require` to a proxy (`__require`) that
  // doesn't have `.resolve`. Detect that and fall through to `createRequire`.
  const _require = (typeof require !== "undefined" && typeof (require as NodeRequire).resolve === "function")
    ? require
    : createRequire(import.meta.url);
  let babelPluginPath: string | undefined;
  let babelLoaderPath: string | undefined;
  if (isDev && !options.disableBabelPlugin) {
    try {
      babelPluginPath = resolvePackageEntry("iterate-ui-babel-plugin", _require);
    } catch {
      warnOnce("babel-plugin", "[iterate] Could not resolve babel plugin");
    }
    if (babelPluginPath) {
      try {
        babelLoaderPath = _require.resolve("babel-loader");
      } catch {
        warnOnce("babel-loader", "[iterate] Could not resolve babel-loader — component names will not be injected");
      }
    }
  }

  return async function iterateNextConfig(): Promise<NextConfig> {
    if (!isDev) {
      // In production, don't modify anything
      return nextConfig;
    }

    const daemonPort = await resolveDaemonPort(repoRoot, startingPort, options.daemonPort ?? envPort);

    // ITERATE_SKIP_DAEMON_START is used by tests to exercise config shape
    // without spawning a real child process.
    const skipDaemonStart = process.env.ITERATE_SKIP_DAEMON_START === "1";

    // Start the daemon when the config is loaded (dev only)
    if (!daemon && !daemonStarting && !skipDaemonStart) {
      daemonStarting = true;
      startDaemonIfNeeded(daemonPort, repoRoot).then((child) => {
        if (child) {
          daemon = child;

          // Clean up on process exit
          const cleanup = () => {
            if (daemon) {
              stopDaemon(daemon, daemonPort);
              daemon = null;
            }
          };
          process.on("SIGINT", cleanup);
          process.on("SIGTERM", cleanup);
          process.on("exit", cleanup);
        }
      });
    }

    const turbopack = isTurbopackMode();
    // Honor Next.js basePath so /__iterate__ and /api/iterations are reachable
    // under subpath-mounted apps (e.g. basePath: "/admin").
    const basePath = typeof nextConfig.basePath === "string" ? nextConfig.basePath.replace(/\/+$/, "") : "";

    const result: NextConfig = {
      ...nextConfig,

      // Expose iteration name, daemon port, basePath, and (if set) the app
      // identifier to the client-side <Iterate /> component. The overlay
      // forwards NEXT_PUBLIC_ITERATE_APP_NAME to the daemon when creating
      // iterations, so multi-app repos spawn the right dev server for
      // whichever app the user is currently viewing.
      env: {
        ...nextConfig.env,
        NEXT_PUBLIC_ITERATE_ITERATION_NAME: process.env.ITERATE_ITERATION_NAME ?? "__original__",
        NEXT_PUBLIC_ITERATE_DAEMON_PORT: String(daemonPort),
        NEXT_PUBLIC_ITERATE_BASE_PATH: basePath,
        ...(options.appName ? { NEXT_PUBLIC_ITERATE_APP_NAME: options.appName } : {}),
      },

      // Add rewrites to proxy to the daemon
      async rewrites() {
        const existingRewrites = await (nextConfig.rewrites?.() ?? []);

        const proxyPaths = [
          "/__iterate__/:path*",
          "/api/iterations/:path*",
          "/api/annotations/:path*",
          "/api/dom-changes",
          "/api/command",
          "/api/command-context/:path*",
        ];

        const iterateRewrites = proxyPaths.map((path) => ({
          // With a basePath, Next strips the prefix before matching `source`, so
          // the source stays unprefixed but the destination is the raw daemon URL.
          source: path,
          destination: `http://127.0.0.1:${daemonPort}${path.replace(":path*", ":path*")}`,
        }));

        // Handle both array and object rewrite formats
        if (Array.isArray(existingRewrites)) {
          return [...iterateRewrites, ...existingRewrites];
        }

        return {
          ...existingRewrites,
          beforeFiles: [
            ...iterateRewrites,
            ...(existingRewrites.beforeFiles ?? []),
          ],
        };
      },
    };

    // Skip babel plugin injection for iteration dev servers — Turbopack's
    // WebpackLoadersProcessedAsset panics with custom loaders in monorepo
    // subdirectories. Iterations rely on the overlay's runtime fiber-based
    // component detection instead.
    const isIteration = process.env.ITERATE_ITERATION_NAME && process.env.ITERATE_ITERATION_NAME !== "__original__";

    // Only inject via webpack when NOT using Turbopack (avoids the
    // "webpack config present but no turbopack config" warning in Next 16+)
    if (!turbopack) {
      result.webpack = function webpack(config: any, context: any) {
        if (!context.dev) {
          return nextConfig.webpack?.(config, context) ?? config;
        }

        // Inject babel plugin as a pre-loader on both server and client builds
        // so that server components get data-iterate-component attributes
        if (babelLoaderPath && babelPluginPath && !isIteration) {
          config.module.rules.push({
            test: /\.(tsx?|jsx?)$/,
            exclude: /node_modules/,
            enforce: "pre",
            use: [{
              loader: babelLoaderPath,
              options: {
                plugins: [babelPluginPath],
                parserOpts: { plugins: ["jsx", "typescript"] },
                configFile: false,
                babelrc: false,
              },
            }],
          });
        }

        return nextConfig.webpack?.(config, context) ?? config;
      };
    }

    // For Turbopack (Next 16+): inject babel plugin via turbopack.rules
    // so server components get data-iterate-component attributes.
    // The condition API requires Next 16+ (turbopack.rules.*.condition).
    const nextMajor = getNextMajorVersion();

    if (turbopack && babelLoaderPath && babelPluginPath && nextMajor !== null && nextMajor >= 16 && !isIteration) {
      const iterateLoader = {
        loader: babelLoaderPath,
        options: {
          plugins: [babelPluginPath],
          parserOpts: { plugins: ["jsx", "typescript"] },
          configFile: false,
          babelrc: false,
        },
      };

      const iterateRule = {
        condition: { all: [{ not: "foreign" }, "development"] },
        loaders: [iterateLoader],
      };

      result.turbopack = {
        ...nextConfig.turbopack,
        rules: {
          ...nextConfig.turbopack?.rules,
          "*.tsx": iterateRule,
          "*.ts": iterateRule,
          "*.jsx": iterateRule,
          "*.js": iterateRule,
        },
      };

      // Silence the "manual configuration of babel-loader" warning
      result.experimental = {
        ...nextConfig.experimental,
        turbopackUseBuiltinBabel: true,
      };
    }

    // Safety net: if we added a webpack config on Next 16+, ensure a turbopack
    // config also exists to prevent the "webpack without turbopack" error.
    if (result.webpack && !result.turbopack && nextMajor !== null && nextMajor >= 16) {
      result.turbopack = nextConfig.turbopack ?? {};
    }

    return result;
  };
}


function getGitRoot(): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

async function startDaemonIfNeeded(port: number, cwd: string): Promise<ChildProcess | null> {
  if (await isPortInUse(port)) {
    console.log(`[iterate] daemon already running on port ${port}`);
    return null;
  }

  // Resolve iterate-ui-daemon from this package's location, not the app's cwd.
  // See note on line ~151 — tsup's ESM build turns `require` into a proxy
  // without `.resolve`; detect and fall through to createRequire.
  const _req = (typeof require !== "undefined" && typeof (require as NodeRequire).resolve === "function")
    ? require
    : createRequire(import.meta.url);
  const daemonEntryPath = resolvePackageEntry("iterate-ui-daemon", _req);
  // Convert to file:// URL for ESM import in the spawned child
  const daemonPath = `file://${daemonEntryPath}`;

  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { startDaemon } from ${JSON.stringify(daemonPath)}; startDaemon({ port: ${port}, cwd: ${JSON.stringify(cwd)} });`,
    ],
    {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ITERATE_PORT: String(port),
        ITERATE_CWD: cwd,
        NODE_NO_WARNINGS: "1",
      },
    }
  );

  child.stdout?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[iterate] ${msg}`);
  });

  child.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg && !msg.includes("ExperimentalWarning")) {
      console.error(`[iterate] ${msg}`);
    }
  });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[iterate] daemon exited with code ${code}`);
    }
  });

  return child;
}

function stopDaemon(child: ChildProcess | null, port: number): void {
  try {
    fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: "POST" }).catch(
      () => {}
    );
  } catch {
    // Ignore
  }
  child?.kill("SIGTERM");
}

export default withIterate;
