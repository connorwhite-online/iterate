import type { Plugin, ViteDevServer } from "vite";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import http from "node:http";

export interface IteratePluginOptions {
  /** Port for the iterate daemon (default: 4000) */
  daemonPort?: number;
}

/**
 * Vite plugin for iterate.
 *
 * Usage:
 * ```ts
 * // vite.config.ts
 * import { iterate } from '@iterate/vite'
 * export default defineConfig({
 *   plugins: [iterate()]
 * })
 * ```
 *
 * Automatically:
 * 1. Starts the iterate daemon when `vite dev` runs
 * 2. Injects the overlay `<script>` into every HTML page
 * 3. Proxies /__iterate__/* and /api/* to the daemon
 * 4. Cleans up daemon when dev server stops
 */
export function iterate(options: IteratePluginOptions = {}): Plugin {
  const daemonPort = options.daemonPort ?? 4000;
  let daemon: ChildProcess | null = null;
  let overlayJS: string | null = null;

  return {
    name: "iterate",
    apply: "serve", // Only active during dev

    configureServer(server: ViteDevServer) {
      // Start the daemon
      daemon = startDaemon(daemonPort, server.config.root);

      // Serve the overlay bundle directly (avoids extra proxy hop)
      server.middlewares.use("/__iterate__/overlay.js", (_req, res) => {
        if (!overlayJS) {
          try {
            const require = createRequire(import.meta.url);
            const overlayPath = require.resolve("@iterate/overlay/standalone");
            overlayJS = readFileSync(overlayPath, "utf-8");
          } catch {
            res.statusCode = 404;
            res.end("Overlay bundle not found");
            return;
          }
        }
        res.setHeader("Content-Type", "application/javascript");
        res.setHeader("Cache-Control", "no-cache");
        res.end(overlayJS);
      });

      // Proxy iterate API and WebSocket to daemon
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";

        if (url.startsWith("/api/") || url.startsWith("/__iterate__/")) {
          proxyRequest(req, res, daemonPort);
          return;
        }

        next();
      });

      // Proxy WebSocket upgrade for /ws
      server.httpServer?.on("upgrade", (req, socket, head) => {
        if (req.url === "/ws") {
          const proxy = http.request(
            {
              hostname: "127.0.0.1",
              port: daemonPort,
              path: "/ws",
              method: "GET",
              headers: {
                ...req.headers,
                host: `127.0.0.1:${daemonPort}`,
              },
            },
            () => {}
          );

          proxy.on("upgrade", (_proxyRes, proxySocket, proxyHead) => {
            socket.write(
              "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                `Sec-WebSocket-Accept: ${_proxyRes.headers["sec-websocket-accept"]}\r\n` +
                "\r\n"
            );
            if (proxyHead.length > 0) socket.write(proxyHead);

            proxySocket.pipe(socket);
            socket.pipe(proxySocket);

            proxySocket.on("error", () => socket.destroy());
            socket.on("error", () => proxySocket.destroy());
          });

          proxy.on("error", () => {
            socket.destroy();
          });

          proxy.end();
        }
      });

      // Clean up daemon when dev server closes
      server.httpServer?.on("close", () => {
        stopDaemon(daemon, daemonPort);
        daemon = null;
      });
    },

    // Inject the overlay script into HTML
    transformIndexHtml(html) {
      // Inject right before </body>, includes tool state bootstrap
      return html.replace(
        "</body>",
        `<script>
  window.__iterate_shell__ = { activeTool: 'select', activeIteration: 'default' };
</script>
<script src="/__iterate__/overlay.js" defer></script>
</body>`
      );
    },
  };
}

function startDaemon(port: number, cwd: string): ChildProcess {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", `import { startDaemon } from "@iterate/daemon"; startDaemon({ port: ${port}, cwd: ${JSON.stringify(cwd)} });`],
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

async function stopDaemon(
  child: ChildProcess | null,
  port: number
): Promise<void> {
  // Try graceful shutdown via API first
  try {
    await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: "POST" });
  } catch {
    // API might not be available, kill directly
    child?.kill("SIGTERM");
  }
}

function proxyRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  port: number
): void {
  const proxyReq = http.request(
    {
      hostname: "127.0.0.1",
      port,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${port}`,
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 500, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", () => {
    res.statusCode = 502;
    res.end("iterate daemon not available");
  });

  req.pipe(proxyReq);
}

export default iterate;
