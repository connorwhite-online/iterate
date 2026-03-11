import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";

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
  /** Port for the iterate daemon (default: 4000) */
  daemonPort?: number;
  /** Disable the babel plugin that injects component names/source locations (default: false) */
  disableBabelPlugin?: boolean;
}

type NextConfig = Record<string, any>;

let daemon: ChildProcess | null = null;
let daemonStarting = false;

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
): NextConfig {
  const daemonPort = options.daemonPort ?? 4000;
  const isDev = process.env.NODE_ENV !== "production";

  if (!isDev) {
    // In production, don't modify anything
    return nextConfig;
  }

  // Start the daemon when the config is loaded (dev only)
  if (!daemon && !daemonStarting) {
    daemonStarting = true;
    const repoRoot = getGitRoot() ?? process.cwd();
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

  // Resolve paths at config time
  // Use createRequire for CJS compatibility (Next.js loads config via CJS)
  const _require = typeof require !== "undefined" ? require : createRequire(import.meta.url);
  let babelPluginPath: string | undefined;
  try {
    if (!options.disableBabelPlugin) {
      babelPluginPath = resolvePackageEntry("iterate-ui-babel-plugin", _require);
    }
  } catch {
    console.warn("[iterate] Could not resolve babel plugin");
  }

  const turbopack = isTurbopackMode();

  const result: NextConfig = {
    ...nextConfig,

    // Expose iteration name and daemon port to the client-side <Iterate /> component
    env: {
      ...nextConfig.env,
      NEXT_PUBLIC_ITERATE_ITERATION_NAME: process.env.ITERATE_ITERATION_NAME ?? "__original__",
      NEXT_PUBLIC_ITERATE_DAEMON_PORT: String(daemonPort),
    },

    // Add rewrites to proxy to the daemon
    async rewrites() {
      const existingRewrites = await (nextConfig.rewrites?.() ?? []);

      const iterateRewrites = [
        {
          source: "/__iterate__/:path*",
          destination: `http://127.0.0.1:${daemonPort}/__iterate__/:path*`,
        },
        {
          source: "/api/iterations/:path*",
          destination: `http://127.0.0.1:${daemonPort}/api/iterations/:path*`,
        },
        {
          source: "/api/annotations/:path*",
          destination: `http://127.0.0.1:${daemonPort}/api/annotations/:path*`,
        },
        {
          source: "/api/dom-changes",
          destination: `http://127.0.0.1:${daemonPort}/api/dom-changes`,
        },
        {
          source: "/api/command",
          destination: `http://127.0.0.1:${daemonPort}/api/command`,
        },
        {
          source: "/api/command-context/:path*",
          destination: `http://127.0.0.1:${daemonPort}/api/command-context/:path*`,
        },
      ];

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

  // Resolve babel-loader for the component name injection pre-loader
  let babelLoaderPath: string | undefined;
  if (babelPluginPath) {
    try {
      babelLoaderPath = _require.resolve("babel-loader");
    } catch {
      console.warn("[iterate] Could not resolve babel-loader — component names will not be injected");
    }
  }

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
}


function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      resolve(false);
    });
  });
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

  // Resolve iterate-ui-daemon from this package's location, not the app's cwd
  const _req = typeof require !== "undefined" ? require : createRequire(import.meta.url);
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
