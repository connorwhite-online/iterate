import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";

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
 * 3. Injects the overlay script via webpack entry
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
    startDaemonIfNeeded(daemonPort, process.cwd()).then((child) => {
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

  // Resolve the overlay bundle path at config time
  let overlayBundlePath: string | undefined;
  let babelPluginPath: string | undefined;
  try {
    overlayBundlePath = fileURLToPath(import.meta.resolve("iterate-ui-overlay/standalone"));
    if (!options.disableBabelPlugin) {
      babelPluginPath = fileURLToPath(import.meta.resolve("iterate-ui-babel-plugin"));
    }
  } catch {
    console.warn("[iterate] Could not resolve overlay bundle or babel plugin");
  }

  return {
    ...nextConfig,

    // Inject iterate babel plugin for component name/source resolution
    ...(babelPluginPath ? {
      experimental: {
        ...nextConfig.experimental,
        // Next.js supports custom SWC plugins, but for broadest compatibility
        // we use the babel config approach
      },
      // Add our babel plugin to any existing babel config
      babel: {
        ...nextConfig.babel,
        plugins: [
          ...(nextConfig.babel?.plugins ?? []),
          [babelPluginPath, { root: process.cwd() }],
        ],
      },
    } : {}),

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

    // Inject overlay via webpack
    webpack(config: any, context: any) {
      if (context.isServer || !context.dev) {
        return nextConfig.webpack?.(config, context) ?? config;
      }

      // Add a virtual entry that injects the overlay script at runtime
      const originalEntry = config.entry;
      config.entry = async () => {
        const entries = await (typeof originalEntry === "function"
          ? originalEntry()
          : originalEntry);

        // Add our injector to the main client entry
        const injectorPath = createIterateInjector(overlayBundlePath, daemonPort);
        if (injectorPath && entries["main-app"]) {
          if (Array.isArray(entries["main-app"])) {
            entries["main-app"].push(injectorPath);
          }
        } else if (injectorPath && entries["main"]) {
          if (Array.isArray(entries["main"])) {
            entries["main"].push(injectorPath);
          }
        }

        return entries;
      };

      return nextConfig.webpack?.(config, context) ?? config;
    },
  };
}

/**
 * Create a temporary JS module that injects the overlay script tag.
 * Returns the path to write the injector, or writes it inline via data URI.
 */
function createIterateInjector(
  _overlayPath: string | undefined,
  daemonPort: number
): string | null {
  // Use a data URI as a virtual module — webpack supports this.
  // ITERATE_ITERATION_NAME is set by the daemon's process manager when starting
  // iteration dev servers — this lets the overlay know which iteration it's in.
  const iterationName = process.env.ITERATE_ITERATION_NAME ?? "__original__";
  const code = `
    if (typeof window !== 'undefined') {
      window.__iterate_shell__ = { activeTool: 'browse', activeIteration: ${JSON.stringify(iterationName)}, daemonPort: ${daemonPort} };
      var s = document.createElement('script');
      s.src = '/__iterate__/overlay.js';
      s.defer = true;
      document.head.appendChild(s);
    }
  `;
  // Encode as a data URI that webpack can consume
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
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

async function startDaemonIfNeeded(port: number, cwd: string): Promise<ChildProcess | null> {
  if (await isPortInUse(port)) {
    console.log(`[iterate] daemon already running on port ${port}`);
    return null;
  }

  // Resolve iterate-ui-daemon from this package's location, not the app's cwd
  const daemonPath = import.meta.resolve("iterate-ui-daemon");

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
