import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DaemonClient } from "../connection/daemon-client.js";

/**
 * These tests exercise DaemonClient.callApi's HTTP behavior via a mocked
 * global fetch, ensuring bodies are serialized correctly and unusual
 * responses don't crash the caller. The appName forwarding happens in the
 * MCP tool handler (index.ts) but this is the layer that actually sends
 * it to the daemon — if this breaks the whole multi-app flow breaks.
 */

let originalFetch: typeof global.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  originalFetch = global.fetch;
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  global.fetch = fetchMock as unknown as typeof global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("DaemonClient.callApi", () => {
  it("sends a POST with JSON body when body is provided", async () => {
    const client = new DaemonClient(47100);
    await client.callApi("POST", "/api/iterations", { name: "v1", appName: "web" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:47100/api/iterations");
    expect(opts.method).toBe("POST");
    expect((opts.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    // Body faithfully forwards the keys, including appName
    expect(JSON.parse(opts.body as string)).toEqual({ name: "v1", appName: "web" });
  });

  it("forwards undefined appName as a literal undefined-key-removed body", async () => {
    const client = new DaemonClient(47100);
    await client.callApi("POST", "/api/iterations", {
      name: "v1",
      baseBranch: "main",
      appName: undefined,
    });

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    // JSON.stringify drops undefined values — the server sees no appName key.
    const parsed = JSON.parse(opts.body as string);
    expect("appName" in parsed).toBe(false);
    expect(parsed).toEqual({ name: "v1", baseBranch: "main" });
  });

  it("sends method-only for requests without a body", async () => {
    const client = new DaemonClient(47100);
    await client.callApi("DELETE", "/api/iterations/v1");

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:47100/api/iterations/v1");
    expect(opts.method).toBe("DELETE");
    expect(opts.body).toBeUndefined();
    // No content-type header when body is absent
    expect((opts.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("returns the parsed JSON body when the server responds with JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ name: "v1", port: 3101 }), { status: 200 })
    );
    const client = new DaemonClient(47100);
    const result = await client.callApi("POST", "/api/iterations", { name: "v1" });
    expect(result).toEqual({ name: "v1", port: 3101 });
  });

  it("returns an empty object when the server responds with an empty body", async () => {
    // 204 No Content requires null body; use 200 with empty string for the same effect.
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    const client = new DaemonClient(47100);
    const result = await client.callApi("POST", "/api/shutdown");
    expect(result).toEqual({});
  });

  it("constructs URLs against the configured daemon port", async () => {
    const client = new DaemonClient(55555);
    await client.callApi("GET", "/api/iterations");
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:55555/api/iterations");
  });

  it("uses the 47100 default when constructed without a port", async () => {
    const client = new DaemonClient();
    await client.callApi("GET", "/api/iterations");
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:47100/api/iterations");
  });
});
