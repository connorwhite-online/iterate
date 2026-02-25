import type { FastifyInstance } from "fastify";
import type { StateStore } from "../state/store.js";

/**
 * Register proxy routes that forward requests to iteration dev servers.
 *
 * Routes: /<iteration-name>/* → http://localhost:<port>/*
 *
 * The proxy also injects the overlay script into HTML responses.
 */
export async function registerProxyRoutes(
  app: FastifyInstance,
  store: StateStore
): Promise<void> {
  // Dynamic proxy: match /<iteration>/<path>
  app.all("/:iteration/*", async (request, reply) => {
    const { iteration } = request.params as { iteration: string };
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
      // Use @fastify/reply-from to proxy the request
      return reply.from(`${target}${url}`, {
        rewriteRequestHeaders: (_req, headers) => {
          // Rewrite host header for the upstream dev server
          return { ...headers, host: `127.0.0.1:${iterationInfo.port}` };
        },
        onResponse: (_request, reply, res) => {
          const contentType = res.headers["content-type"] ?? "";

          // Inject overlay script into HTML responses
          if (contentType.includes("text/html")) {
            // We'll handle injection in a separate middleware
            // For now, just forward the response
          }

          reply.send(res);
        },
      });
    } catch {
      return reply.status(502).send({
        error: `Failed to proxy to iteration "${iteration}"`,
      });
    }
  });
}
