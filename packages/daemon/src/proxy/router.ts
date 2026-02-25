import type { FastifyInstance } from "fastify";
import type { StateStore } from "../state/store.js";

/**
 * Register proxy routes that forward requests to iteration dev servers.
 *
 * Routes: /<iteration-name>/* → http://localhost:<port>/*
 *
 * The proxy rewrites asset URLs and injects the overlay script into HTML.
 */
export async function registerProxyRoutes(
  app: FastifyInstance,
  store: StateStore
): Promise<void> {
  // Guard: skip /api and /ws routes
  app.all("/:iteration/*", async (request, reply) => {
    const { iteration } = request.params as { iteration: string };

    // Don't proxy reserved paths
    if (iteration === "api" || iteration === "ws") return;

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
        rewriteRequestHeaders: (_req, headers) => ({
          ...headers,
          host: `127.0.0.1:${iterationInfo.port}`,
        }),
      });
    } catch {
      return reply.status(502).send({
        error: `Failed to proxy to iteration "${iteration}"`,
      });
    }
  });
}
