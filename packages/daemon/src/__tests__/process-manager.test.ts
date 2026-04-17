import { describe, it, expect } from "vitest";
import { ProcessManager } from "../process/manager.js";
import { createServer, type Server } from "node:net";

describe("ProcessManager.allocatePort — concurrency", () => {
  it("returns distinct ports for concurrent callers (no race)", async () => {
    const pm = new ProcessManager(41000);
    const results = await Promise.all([
      pm.allocatePort(),
      pm.allocatePort(),
      pm.allocatePort(),
      pm.allocatePort(),
    ]);
    // All four ports must be unique — the race bug would have returned
    // the same port for multiple concurrent callers.
    const unique = new Set(results);
    expect(unique.size).toBe(results.length);
    // And sequential — each claim bumps the next port.
    const sorted = [...results].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]).toBeGreaterThan(sorted[i - 1]!);
    }
  });

  it("skips a port that's already in use", async () => {
    const server = createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const busyPort = addr.port;
    try {
      const pm = new ProcessManager(busyPort);
      const assigned = await pm.allocatePort();
      expect(assigned).not.toBe(busyPort);
      expect(assigned).toBeGreaterThan(busyPort);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("throws when the configured range is exhausted", async () => {
    // Construct a PM with zero usable ports: set basePort to maxPort + 1
    const pm = new ProcessManager(41100);
    (pm as unknown as { nextPort: number }).nextPort = 41200; // > maxPort (41199)
    await expect(pm.allocatePort()).rejects.toThrow(/No available ports/);
  });

  it("assigns sequentially when called one at a time", async () => {
    const pm = new ProcessManager(41500);
    const a = await pm.allocatePort();
    const b = await pm.allocatePort();
    const c = await pm.allocatePort();
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});

describe("ProcessManager.getRecentOutput + stop idempotence", () => {
  it("getRecentOutput returns an empty array for an unknown name", () => {
    const pm = new ProcessManager(42000);
    expect(pm.getRecentOutput("never-existed")).toEqual([]);
  });

  it("stop is a no-op for an unknown name", async () => {
    const pm = new ProcessManager(42000);
    await expect(pm.stop("never-existed")).resolves.toBeUndefined();
  });
});

// Run server import so the import appears used even if isPortAvailable doesn't
// fire during a given test ordering (tsup bundling guard).
let _keep: Server | null = null;
_keep = null;
void _keep;
