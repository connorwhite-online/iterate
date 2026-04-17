import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { readLockfile, saveConfig } from "iterate-ui-core/node";

/**
 * Integration tests against a real daemon for the POST /api/iterations
 * endpoint. We only exercise the app-resolution + validation layers — the
 * actual worktree creation is expensive (pnpm install, etc.) and covered
 * separately by the pipeline unit tests.
 *
 * Each test here hits the endpoint with an invalid or unready payload so
 * the daemon responds with a fast 4xx/5xx without trying to install deps.
 */

const DAEMON_ENTRY = join(__dirname, "..", "..", "dist", "index.js");

let tmp: string;
let daemonProc: ChildProcess | null = null;
let daemonPort = 0;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "iterate-api-it-"));
  execSync("git init -q", { cwd: tmp });
  execSync("git config user.email test@example.com && git config user.name test", { cwd: tmp });
  writeFileSync(join(tmp, "package.json"), JSON.stringify({ scripts: { dev: "next dev" } }));
  // We need at least one commit so worktree operations work.
  execSync("git add -A && git commit -q -m 'init' --allow-empty", { cwd: tmp });
});

afterEach(async () => {
  if (daemonProc && daemonProc.exitCode === null) {
    daemonProc.kill("SIGKILL");
    await Promise.race([
      new Promise<void>((r) => {
        if (daemonProc!.exitCode !== null) return r();
        daemonProc!.once("exit", () => r());
      }),
      new Promise<void>((r) => setTimeout(r, 1500)),
    ]);
  }
  daemonProc = null;
  rmSync(tmp, { recursive: true, force: true });
});

async function bootDaemonWith(apps: Array<{ name: string; devCommand: string }>): Promise<void> {
  saveConfig(tmp, {
    apps,
    packageManager: "npm",
    basePort: 3100,
    daemonPort: 55000,
    maxIterations: 3,
    idleTimeout: 0,
  });
  daemonProc = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { startDaemon } from ${JSON.stringify(`file://${DAEMON_ENTRY}`)}; startDaemon({ cwd: ${JSON.stringify(tmp)} });`,
    ],
    {
      cwd: tmp,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ITERATE_CWD: tmp, NODE_NO_WARNINGS: "1" },
    }
  );
  daemonProc.unref();

  // Wait for lockfile
  const start = Date.now();
  while (Date.now() - start < 8000) {
    const lock = readLockfile(tmp);
    if (lock && lock.pid === daemonProc.pid) {
      daemonPort = lock.port;
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("daemon didn't produce a lockfile in 8s");
}

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`http://127.0.0.1:${daemonPort}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  return { status: res.status, json };
}

describe("POST /api/iterations — validation", () => {
  it("400s when name is missing", async () => {
    await bootDaemonWith([{ name: "web", devCommand: "next dev" }]);
    const { status, json } = await post("/api/iterations", {});
    expect(status).toBe(400);
    expect(json.message).toMatch(/name is required/i);
  });

  it("400s when name contains invalid characters", async () => {
    await bootDaemonWith([{ name: "web", devCommand: "next dev" }]);
    const { status, json } = await post("/api/iterations", { name: "has spaces!" });
    expect(status).toBe(400);
    expect(json.message).toMatch(/alphanumeric/i);
  });

  it("400s in a multi-app repo when appName is not provided", async () => {
    await bootDaemonWith([
      { name: "web", devCommand: "next dev" },
      { name: "admin", devCommand: "next dev" },
    ]);
    const { status, json } = await post("/api/iterations", { name: "test1" });
    expect(status).toBe(400);
    expect(json.message).toMatch(/appName/);
    expect(json.message).toMatch(/2 apps/);
  });

  it("400s when the supplied appName isn't registered", async () => {
    await bootDaemonWith([
      { name: "web", devCommand: "next dev" },
      { name: "admin", devCommand: "next dev" },
    ]);
    const { status, json } = await post("/api/iterations", { name: "test1", appName: "nope" });
    expect(status).toBe(400);
    expect(json.message).toMatch(/not registered/i);
  });

  // Success path: we set a single app with a dev command that crashes
  // immediately (`false` always exits 1). The daemon attempts install (which
  // works — empty package.json = no deps) then tries to start the dev server
  // and fails. We only care that resolution succeeded and it tried to start
  // the iteration; the test completes quickly because the failure is fast.
  it("single-app repo: accepts a create request without appName (uses the sole app)", async () => {
    await bootDaemonWith([{ name: "web", devCommand: "false" }]);
    const res = await fetch(`http://127.0.0.1:${daemonPort}/api/iterations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "v1" }),
    });
    // Either 200 (waiting for dev) or 500 (fast crash). Both prove the
    // app resolved and the pipeline was kicked off. What we're NOT after
    // here is 400 ("no appName specified").
    expect([200, 500]).toContain(res.status);
  });
});

describe("GET /api/iterations", () => {
  it("returns an empty map when nothing is registered", async () => {
    await bootDaemonWith([{ name: "web", devCommand: "next dev" }]);
    const res = await fetch(`http://127.0.0.1:${daemonPort}/api/iterations`);
    const json = await res.json();
    expect(res.ok).toBe(true);
    expect(json).toEqual({});
  });
});

describe("POST /api/command — multi-app validation", () => {
  it("rejects with appName guidance when multiple apps are configured and none supplied", async () => {
    await bootDaemonWith([
      { name: "web", devCommand: "next dev" },
      { name: "admin", devCommand: "next dev" },
    ]);
    const { status, json } = await post("/api/command", {
      command: "iterate",
      prompt: "do a thing",
      count: 1,
    });
    expect(status).toBe(400);
    expect(json.message).toMatch(/appName/);
  });

  it("rejects unknown appName", async () => {
    await bootDaemonWith([{ name: "web", devCommand: "next dev" }]);
    const { status, json } = await post("/api/command", {
      command: "iterate",
      prompt: "x",
      appName: "nope",
    });
    expect(status).toBe(400);
    expect(json.message).toMatch(/not registered/i);
  });

  it("rejects unknown command", async () => {
    await bootDaemonWith([{ name: "web", devCommand: "next dev" }]);
    const { status, json } = await post("/api/command", {
      command: "bogus",
    });
    expect(status).toBe(400);
    expect(json.message).toMatch(/unknown command/i);
  });
});
