import { createGunzip, createBrotliDecompress, createInflate } from "node:zlib";
import type { FastifyInstance } from "fastify";
import type { StateStore } from "../state/store.js";

/**
 * Register proxy routes that forward requests to iteration dev servers.
 *
 * Routes: /<iteration-name>/* → http://localhost:<port>/*
 *
 * HTML responses are intercepted to inject the overlay script, ensuring
 * annotation and move tools work inside iteration iframes regardless of
 * whether the iteration's own framework plugin is configured.
 */
export async function registerProxyRoutes(
  app: FastifyInstance,
  store: StateStore,
  daemonPort: number
): Promise<void> {
  // Guard: skip /api and /ws routes
  app.all("/:iteration/*", async (request, reply) => {
    const { iteration } = request.params as { iteration: string };

    // Don't proxy reserved paths
    if (iteration === "api" || iteration === "ws" || iteration === "__iterate__") return;

    const iterationInfo = store.getIteration(iteration);

    if (!iterationInfo || iterationInfo.status !== "ready") {
      return reply.status(404).send({
        error: `Iteration "${iteration}" not found or not ready`,
      });
    }

    const target = `http://127.0.0.1:${iterationInfo.port}`;
    // Strip the /<iteration> prefix from the URL
    const url = (request.raw.url ?? "").replace(`/${iteration}`, "") || "/";

    try {
      return reply.from(`${target}${url}`, {
        rewriteRequestHeaders: (_req, headers) => {
          // Remove accept-encoding so the upstream sends uncompressed HTML.
          // We need to read and modify the HTML to inject the overlay script,
          // and re-compressing afterward is unnecessary for localhost.
          const { "accept-encoding": _ae, ...rest } = headers;
          return {
            ...rest,
            host: `127.0.0.1:${iterationInfo.port}`,
          };
        },
        onResponse: (
          _request: any,
          reply: any,
          res: any
        ) => {
          const contentType = String(res.headers?.["content-type"] ?? res.getHeader?.("content-type") ?? "");

          if (contentType.includes("text/html")) {
            // Determine if response is compressed despite our accept-encoding removal
            // (some servers compress regardless)
            const encoding = String(res.headers?.["content-encoding"] ?? "").toLowerCase();

            // Build the appropriate decompression pipeline
            const decompress = (stream: NodeJS.ReadableStream): NodeJS.ReadableStream => {
              if (encoding === "gzip" || encoding === "x-gzip") return stream.pipe(createGunzip());
              if (encoding === "br") return stream.pipe(createBrotliDecompress());
              if (encoding === "deflate") return stream.pipe(createInflate());
              return stream;
            };

            const source = decompress(res.stream);
            const chunks: Buffer[] = [];
            source.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
            source.on("end", () => {
              let html = Buffer.concat(chunks).toString("utf-8");
              html = injectOverlayScript(html, daemonPort, iteration);

              // Strip content-length and content-encoding — we're sending
              // uncompressed, modified HTML with a fresh content-length
              const headers = { ...res.headers };
              delete headers["content-length"];
              delete headers["content-encoding"];
              delete headers["transfer-encoding"];

              reply
                .status(res.statusCode)
                .headers(headers)
                .header("content-length", Buffer.byteLength(html))
                .send(html);
            });
            source.on("error", () => {
              reply.status(502).send({ error: `Proxy error for iteration "${iteration}"` });
            });
          } else {
            // Pass through non-HTML responses unchanged
            reply.status(res.statusCode).headers(res.headers).send(res.stream);
          }
        },
      });
    } catch {
      return reply.status(502).send({
        error: `Failed to proxy to iteration "${iteration}"`,
      });
    }
  });
}

/**
 * Inject the overlay setup script into an HTML page.
 * Inserts before </head> if found, otherwise before </body>.
 * Skips injection if the page already has the overlay set up.
 */
function injectOverlayScript(html: string, daemonPort: number, iterationName: string): string {
  // Skip if already injected (by the iteration's own framework plugin)
  if (html.includes("__iterate_shell__") || html.includes("__iterate-overlay-root__")) {
    return html;
  }

  const safeIterationName = JSON.stringify(iterationName);
  const script = `<script>
if(typeof window!=='undefined'&&!window.__iterate_shell__){
window.__iterate_shell__={activeTool:'browse',activeIteration:${safeIterationName},daemonPort:${daemonPort}};
var s=document.createElement('script');s.src='/__iterate__/overlay.js';s.defer=true;document.head.appendChild(s);
}
</script>`;

  // Inject before </head> for earliest execution
  if (html.includes("</head>")) {
    return html.replace("</head>", script + "</head>");
  }
  // Fallback: inject before </body>
  if (html.includes("</body>")) {
    return html.replace("</body>", script + "</body>");
  }
  // Last resort: append to end
  return html + script;
}
