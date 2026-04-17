import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeLockfile, resolveDaemonPort, loadConfig } from "iterate-ui-core/node";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "iterate-mcp-port-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/**
 * The MCP server uses the same `resolveDaemonPort` helper as the CLI to pick
 * which port to connect to at startup. These tests exercise the resolution
 * chain the MCP server follows: env override → lockfile → config → default.
 */

describe("MCP daemon port resolution", () => {
  it("uses the lockfile port when a live lockfile exists", () => {
    writeLockfile(tmp, {
      pid: process.pid,
      port: 50123,
      cwd: tmp,
      startedAt: new Date().toISOString(),
    });
    expect(resolveDaemonPort(tmp, null)).toBe(50123);
  });

  it("falls back to config.daemonPort when no lockfile", () => {
    mkdirSync(join(tmp, ".iterate"));
    writeFileSync(
      join(tmp, ".iterate", "config.json"),
      JSON.stringify({
        apps: [{ name: "web", devCommand: "next dev" }],
        packageManager: "npm",
        basePort: 3100,
        daemonPort: 50321,
        maxIterations: 3,
        idleTimeout: 0,
      })
    );
    const cfg = loadConfig(tmp);
    expect(resolveDaemonPort(tmp, cfg)).toBe(50321);
  });

  it("respects an explicit override above all else", () => {
    writeLockfile(tmp, {
      pid: process.pid,
      port: 50123,
      cwd: tmp,
      startedAt: new Date().toISOString(),
    });
    expect(resolveDaemonPort(tmp, null, 59999)).toBe(59999);
  });

  it("falls back to the default when nothing is configured", () => {
    const port = resolveDaemonPort(tmp, null);
    expect(port).toBeGreaterThan(0);
  });
});

