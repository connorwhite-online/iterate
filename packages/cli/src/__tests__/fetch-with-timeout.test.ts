import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fetchWithTimeout, parseJsonSafe } from "../fetch-with-timeout.js";

let server: Server;
let baseUrl: string;
// Registry of delays per path so we can test different timeout/latency scenarios.
const handlers: Record<string, (res: import("node:http").ServerResponse) => void> = {};

beforeEach(async () => {
  server = createServer((req, res) => {
    const handler = handlers[req.url ?? ""];
    if (handler) handler(res);
    else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  for (const k of Object.keys(handlers)) delete handlers[k];
  await new Promise<void>((r) => server.close(() => r()));
});

describe("fetchWithTimeout", () => {
  it("returns a response when the server responds in time", async () => {
    handlers["/fast"] = (res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ hello: "world" }));
    };
    const res = await fetchWithTimeout(`${baseUrl}/fast`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ hello: "world" });
  });

  it("aborts with AbortError when the response exceeds the timeout", async () => {
    handlers["/slow"] = (res) => {
      // Never responds.
      setTimeout(() => res.end(""), 10000).unref();
    };
    await expect(fetchWithTimeout(`${baseUrl}/slow`, { timeoutMs: 150 })).rejects.toThrow(/abort/i);
  });

  it("accepts a user-supplied AbortSignal as well", async () => {
    handlers["/slow"] = (res) => {
      setTimeout(() => res.end(""), 10000).unref();
    };
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 100).unref();
    await expect(
      fetchWithTimeout(`${baseUrl}/slow`, { timeoutMs: 10000, signal: ctrl.signal })
    ).rejects.toThrow(/abort/i);
  });

  it("does not abort after the response is received", async () => {
    handlers["/fast"] = (res) => res.end("{}");
    const res = await fetchWithTimeout(`${baseUrl}/fast`, { timeoutMs: 50 });
    // Wait past the timeout — response should remain usable
    await new Promise((r) => setTimeout(r, 100));
    expect(res.ok).toBe(true);
  });

  it("forwards method, headers, and body to fetch", async () => {
    let captured: { method?: string; body?: string; contentType?: string } = {};
    handlers["/echo"] = (res) => {
      res.statusCode = 200;
      res.end("{}");
    };
    server.prependListener("request", (req, _res) => {
      if (req.url === "/echo") {
        captured.method = req.method;
        captured.contentType = req.headers["content-type"];
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(Buffer.from(c)));
        req.on("end", () => {
          captured.body = Buffer.concat(chunks).toString();
        });
      }
    });
    const res = await fetchWithTimeout(`${baseUrl}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    await res.text();
    // Give the request event listener a tick to finish
    await new Promise((r) => setTimeout(r, 20));
    expect(captured.method).toBe("POST");
    expect(captured.contentType).toBe("application/json");
    expect(captured.body).toBe(JSON.stringify({ a: 1 }));
  });
});

describe("parseJsonSafe", () => {
  it("parses valid JSON", async () => {
    const res = new Response(JSON.stringify({ hello: "x" }), { headers: { "content-type": "application/json" } });
    expect(await parseJsonSafe(res)).toEqual({ hello: "x" });
  });

  it("returns null for empty bodies", async () => {
    const res = new Response("");
    expect(await parseJsonSafe(res)).toBeNull();
  });

  it("returns null for invalid JSON instead of throwing", async () => {
    const res = new Response("{not valid");
    expect(await parseJsonSafe(res)).toBeNull();
  });

  it("returns null for HTML error pages", async () => {
    const res = new Response("<html>504 Gateway Timeout</html>", { status: 504 });
    expect(await parseJsonSafe(res)).toBeNull();
  });
});
