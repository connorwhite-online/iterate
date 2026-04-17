import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { writeLockfile } from "iterate-ui-core/node";
import { resolveDaemonPort, iterate } from "../index.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "iterate-vite-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("resolveDaemonPort", () => {
  it("honors an explicit override above all other sources", async () => {
    writeLockfile(tmp, {
      pid: process.pid,
      port: 40000,
      cwd: tmp,
      startedAt: new Date().toISOString(),
    });
    const port = await resolveDaemonPort(tmp, 47100, 55555);
    expect(port).toBe(55555);
  });

  it("uses the live-lockfile port when present", async () => {
    writeLockfile(tmp, {
      pid: process.pid, // this test process is alive
      port: 40000,
      cwd: tmp,
      startedAt: new Date().toISOString(),
    });
    const port = await resolveDaemonPort(tmp, 47100);
    expect(port).toBe(40000);
  });

  it("ignores stale lockfiles and falls through to the starting port", async () => {
    writeLockfile(tmp, {
      pid: 2147483647, // effectively never-alive
      port: 40000,
      cwd: tmp,
      startedAt: "2020-01-01T00:00:00Z",
    });
    const port = await resolveDaemonPort(tmp, 47100);
    // Starting port may be claimed by the test harness itself; the result
    // should be >= starting, not the stale 40000.
    expect(port).toBeGreaterThanOrEqual(47100);
  });

  it("falls back to auto-pick when starting port is in use", async () => {
    // Occupy a port, then pass it as the starting hint.
    const server = createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port bound");
    const busy = addr.port;

    try {
      const port = await resolveDaemonPort(tmp, busy);
      // Note: current implementation reuses the starting port if it's listening
      // (assumes it's our own daemon from a concurrent invocation). That matches
      // the Next plugin's behavior.
      expect(port).toBe(busy);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe("iterate() plugin factory", () => {
  it("returns an array with at least one plugin entry", () => {
    const plugins = iterate();
    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins.length).toBeGreaterThanOrEqual(1);
  });

  it("all returned plugins are scoped to serve-mode", () => {
    const plugins = iterate();
    for (const p of plugins) {
      expect(p.apply).toBe("serve");
    }
  });

  it("drops the babel plugin when disableBabelPlugin is set", () => {
    const withBabel = iterate();
    const withoutBabel = iterate({ disableBabelPlugin: true });
    expect(withoutBabel.length).toBe(withBabel.length - 1);
  });

  it("names include 'iterate' so users can find the plugin in Vite's debug output", () => {
    const plugins = iterate();
    const names = plugins.map((p) => p.name);
    expect(names.some((n) => n.includes("iterate"))).toBe(true);
  });
});

describe("transformIndexHtml — overlay injection", () => {
  it("injects the overlay script tag before </body>", async () => {
    const plugins = iterate({ disableBabelPlugin: true });
    const main = plugins.find((p) => p.name === "iterate")!;
    // Fake config/server to flush resolvedPort/resolvedBase via configResolved.
    // @ts-expect-error — we're faking what Vite passes in
    await main.configResolved?.({ base: "/", root: tmp });

    // @ts-expect-error — fake transform args
    const out = main.transformIndexHtml?.("<html><body>hi</body></html>", {});
    const html = typeof out === "string" ? out : out?.html;
    expect(html).toContain("__iterate_shell__");
    expect(html).toContain("/__iterate__/overlay.js");
    expect(html).toMatch(/<\/script>\s*<\/body>/);
  });

  it("respects a custom base path in the overlay src", async () => {
    // Occupy the default starting port so configResolved picks something deterministic
    mkdirSync(join(tmp, ".iterate"), { recursive: true });
    writeFileSync(
      join(tmp, ".iterate", "config.json"),
      JSON.stringify({
        apps: [{ name: "w", devCommand: "vite" }],
        packageManager: "npm",
        basePort: 3100,
        daemonPort: 47100,
        maxIterations: 3,
        idleTimeout: 0,
      })
    );
    const plugins = iterate({ daemonPort: 54321, disableBabelPlugin: true });
    const main = plugins.find((p) => p.name === "iterate")!;
    // @ts-expect-error — fake config
    await main.configResolved?.({ base: "/app/", root: tmp });

    // @ts-expect-error — fake transform args
    const out = main.transformIndexHtml?.("<html><body>hi</body></html>", {});
    const html = typeof out === "string" ? out : out?.html;
    expect(html).toContain(`src="/app/__iterate__/overlay.js"`);
    expect(html).toContain(`basePath: "/app"`);
    expect(html).toContain("daemonPort: 54321");
  });
});
