import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync, execFileSync, spawnSync } from "node:child_process";
import { writeLockfile, removeLockfile } from "iterate-ui-core/node";

const CLI_BIN = join(__dirname, "..", "..", "dist", "index.js");

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "iterate-lock-flow-"));
  execSync("git init -q", { cwd: tmp });
  writeFileSync(join(tmp, "package.json"), JSON.stringify({ scripts: { dev: "next dev" } }));
  // Pre-init so commands have a config.
  execFileSync("node", [CLI_BIN, "init"], { cwd: tmp });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function run(args: string[]): { stdout: string; status: number; stderr: string } {
  // spawnSync captures stderr even on success (unlike execFileSync, which
  // discards it when exit code is 0).
  const res = spawnSync("node", [CLI_BIN, ...args], { cwd: tmp, encoding: "utf-8" });
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    status: res.status ?? 1,
  };
}

// Keep execFileSync referenced so the import isn't unused.
void execFileSync;

describe("list / stop fall back cleanly when no daemon is running", () => {
  it("list errors with a clear message", () => {
    const { stdout, stderr, status } = run(["list"]);
    expect(status).toBe(1);
    const combined = stdout + stderr;
    expect(combined).toMatch(/cannot connect to iterate daemon/i);
  });

  it("stop is a no-op when the daemon isn't running and leaves status 0-ish", () => {
    const { stdout, stderr } = run(["stop"]);
    const combined = stdout + stderr;
    expect(combined).toMatch(/Daemon is not running/i);
  });

  it("stop cleans up a stale lockfile (so subsequent commands don't get confused)", () => {
    writeLockfile(tmp, {
      pid: 2147483647,
      port: 49123,
      cwd: tmp,
      startedAt: new Date().toISOString(),
    });
    expect(existsSync(join(tmp, ".iterate", "daemon.lock"))).toBe(true);
    run(["stop"]);
    expect(existsSync(join(tmp, ".iterate", "daemon.lock"))).toBe(false);
  });
});

describe("doctor surfaces the lockfile state", () => {
  it("reports a stale lockfile as a warn", () => {
    writeLockfile(tmp, {
      pid: 2147483647,
      port: 49123,
      cwd: tmp,
      startedAt: "2020-01-01T00:00:00Z",
    });
    const { stdout } = run(["doctor"]);
    expect(stdout).toMatch(/Stale daemon lockfile/);
  });

  it("reports a live daemon (using this test process' PID) as OK", () => {
    writeLockfile(tmp, {
      pid: process.pid,
      port: 49124,
      cwd: tmp,
      startedAt: new Date().toISOString(),
    });
    const { stdout } = run(["doctor"]);
    expect(stdout).toMatch(/Daemon running on port 49124/);
    removeLockfile(tmp);
  });
});

describe("branch with multiple apps requires --app", () => {
  it("errors out when multiple apps are configured and --app is omitted", () => {
    // Register a second app
    run(["init", "--app-name", "admin", "--dev-command", "vite"]);
    const { stderr, status } = run(["branch", "my-feature"]);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/2 apps configured/);
    expect(stderr).toMatch(/--app/);
  });
});
