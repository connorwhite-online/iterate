import { createGunzip, createBrotliDecompress, createInflate } from "node:zlib";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { findApp, type IterateConfig, type IterationInfo } from "iterate-ui-core";
import type { StateStore } from "../state/store.js";

/**
 * Register proxy routes that forward requests to iteration dev servers.
 *
 * Routes: /<iteration-name>/* → http://localhost:<port>/*
 *
 * For framework assets (e.g. /_next/static/...) that don't include the
 * iteration prefix, the Referer header is used to resolve which iteration
 * the request belongs to.
 *
 * HTML responses are intercepted to inject the overlay script, ensuring
 * annotation and move tools work inside iteration iframes regardless of
 * whether the iteration's own framework plugin is configured.
 */
export async function registerProxyRoutes(
  app: FastifyInstance,
  store: StateStore,
  daemonPort: number,
  config: IterateConfig
): Promise<void> {
  app.all("/:iteration/*", async (request, reply) => {
    const { iteration } = request.params as { iteration: string };

    // Don't proxy reserved paths
    if (iteration === "api" || iteration === "ws" || iteration === "__iterate__") return;

    let iterationInfo = store.getIteration(iteration);
    let targetUrl: string;

    if (iterationInfo && iterationInfo.status === "ready") {
      // Direct iteration route: strip /<iteration> prefix
      targetUrl = (request.raw.url ?? "").replace(`/${iteration}`, "") || "/";
    } else {
      // Not a known iteration — try Referer-based fallback for framework assets
      // (e.g. /_next/static/chunks/main.js with Referer: .../v1-cards/)
      const resolved = resolveIterationFromReferer(request, store);
      if (!resolved) {
        return reply.status(404).send({
          error: `Iteration "${iteration}" not found or not ready`,
        });
      }
      iterationInfo = resolved;
      // Use the full original URL (the asset path like /_next/static/...)
      targetUrl = request.raw.url ?? "/";
    }

    const target = `http://127.0.0.1:${iterationInfo.port}`;
    const basePath = resolveBasePath(config, iterationInfo);

    try {
      return reply.from(`${target}${targetUrl}`, {
        rewriteRequestHeaders: (_req, headers) => {
          const { "accept-encoding": _ae, ...rest } = headers;
          return {
            ...rest,
            host: `127.0.0.1:${iterationInfo!.port}`,
          };
        },
        onResponse: createOnResponse(daemonPort, iterationInfo.name, basePath),
      });
    } catch {
      return reply.status(502).send({
        error: `Failed to proxy to iteration "${iterationInfo.name}"`,
      });
    }
  });
}

/**
 * Look up the Next.js basePath / Vite base for the iteration's target app.
 * Returns an empty string when the app mounts at the root.
 * Exported for tests.
 */
export function resolveBasePath(config: IterateConfig, info: IterationInfo): string {
  if (!info.appName) {
    // Legacy / single-app fallback
    const onlyApp = config.apps.length === 1 ? config.apps[0] : undefined;
    return onlyApp?.basePath ?? "";
  }
  const app = findApp(config, info.appName);
  return app?.basePath ?? "";
}

/**
 * Extract the iteration name from the Referer header.
 * When an iframe at /v1-cards/ requests /_next/static/main.js, the browser
 * sends Referer: http://localhost:<daemon-port>/v1-cards/. We extract
 * "v1-cards" and look it up in the store.
 * Exported for tests.
 */
export function resolveIterationFromReferer(
  request: FastifyRequest,
  store: StateStore
): IterationInfo | null {
  const referer = request.headers.referer ?? request.headers.referrer;
  if (!referer || typeof referer !== "string") return null;

  try {
    const url = new URL(referer);
    const firstSegment = url.pathname.split("/").filter(Boolean)[0];
    if (!firstSegment) return null;

    const info = store.getIteration(firstSegment);
    if (info && info.status === "ready") return info;
  } catch {
    // Malformed Referer — ignore
  }
  return null;
}

/**
 * Create the onResponse handler for proxied requests.
 * HTML responses are intercepted to inject the overlay script.
 * Non-HTML responses are passed through unchanged.
 */
function createOnResponse(daemonPort: number, iterationName: string, basePath: string) {
  return (_request: any, reply: any, res: any) => {
    const contentType = String(
      res.headers?.["content-type"] ?? res.getHeader?.("content-type") ?? ""
    );

    if (contentType.includes("text/html")) {
      const encoding = String(
        res.headers?.["content-encoding"] ?? ""
      ).toLowerCase();

      const decompress = (
        stream: NodeJS.ReadableStream
      ): NodeJS.ReadableStream => {
        if (encoding === "gzip" || encoding === "x-gzip")
          return stream.pipe(createGunzip());
        if (encoding === "br") return stream.pipe(createBrotliDecompress());
        if (encoding === "deflate") return stream.pipe(createInflate());
        return stream;
      };

      const source = decompress(res.stream);
      const chunks: Buffer[] = [];
      source.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      source.on("end", () => {
        let html = Buffer.concat(chunks).toString("utf-8");
        html = injectOverlayScript(html, daemonPort, iterationName, basePath);

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
        reply
          .status(502)
          .send({ error: `Proxy error for iteration "${iterationName}"` });
      });
    } else {
      reply.status(res.statusCode).headers(res.headers).send(res.stream);
    }
  };
}

/**
 * Inject the overlay setup script into an HTML page.
 * Inserts before </head> if found, otherwise before </body>.
 * Skips injection if the page already has the overlay set up.
 *
 * basePath is the app's Next.js `basePath` (or Vite `base`) — included so the
 * overlay bundle loads from the right path when the app mounts under a subpath
 * like "/admin".
 */
export function injectOverlayScript(html: string, daemonPort: number, iterationName: string, basePath: string): string {
  // Skip if already injected (by the iteration's own framework plugin)
  if (html.includes("__iterate_shell__") || html.includes("__iterate-overlay-root__")) {
    return html;
  }

  const safeIterationName = JSON.stringify(iterationName);
  const normalizedBase = basePath ? basePath.replace(/\/+$/, "") : "";
  const overlaySrc = `${normalizedBase}/__iterate__/overlay.js`;
  const script = `<script>
if(typeof window!=='undefined'&&!window.__iterate_shell__){
window.__iterate_shell__={activeTool:'browse',activeIteration:${safeIterationName},daemonPort:${daemonPort},basePath:${JSON.stringify(normalizedBase)}};
var s=document.createElement('script');s.src=${JSON.stringify(overlaySrc)};s.defer=true;document.head.appendChild(s);
function __iterateReady(){try{window.parent.postMessage({type:'iterate:frame-ready',iteration:${safeIterationName}},'*')}catch(e){}}
window.addEventListener('load',function(){(typeof requestIdleCallback==='function'?requestIdleCallback:function(cb){setTimeout(cb,100)})(__iterateReady)});
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
