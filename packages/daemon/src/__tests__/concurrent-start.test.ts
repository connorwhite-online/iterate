import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { readLockfile, saveConfig } from "iterate-ui-core/node";

/**
 * When two plugins (or two terminals) fire up the daemon in the same repo at
 * nearly the same time, we should end up with:
 *   - Exactly ONE daemon listening
 *   - A single, well-formed lockfile pointing at it
 *   - The losing process should exit cleanly without a crash
 *
 * The current implementation does a read-lockfile check at startup; if a live
 * lockfile exists the second daemon short-circuits. This test verifies that.
 * (A deeper lockfile-based atomic-acquisition test would need filesystem locks,
 * which we haven't added yet — this tests the observable contract.)
 */

const DAEMON_ENTRY = join(__dirname, "..", "..", "dist", "index.js");

let tmp: string;
const procs: ChildProcess[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "iterate-concurrent-"));
  execSync("git init -q", { cwd: tmp });
  writeFileSync(join(tmp, "package.json"), JSON.stringify({ scripts: { dev: "next dev" } }));
  saveConfig(tmp, {
    apps: [{ name: "web", devCommand: "next dev" }],
    packageManager: "npm",
    basePort: 3100,
    daemonPort: 54100,
    maxIterations: 3,
    idleTimeout: 0,
  });
});

afterEach(async () => {
  for (const p of procs) {
    if (p.exitCode === null) {
      p.kill("SIGKILL");
      await Promise.race([
        new Promise<void>((r) => {
          if (p.exitCode !== null) return r();
          p.once("exit", () => r());
        }),
        new Promise<void>((r) => setTimeout(r, 1500)),
      ]);
    }
  }
  procs.length = 0;
  rmSync(tmp, { recursive: true, force: true });
});

function boot(): ChildProcess {
  const p = spawn(
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
  p.unref();
  procs.push(p);
  return p;
}

async function waitForLockfile(timeoutMs = 5000, expectedPid?: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const lock = readLockfile(tmp);
    if (lock && (expectedPid === undefined || lock.pid === expectedPid)) return lock;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Lockfile did not appear within ${timeoutMs}ms`);
}

async function waitForExit(p: ChildProcess, timeoutMs = 5000): Promise<number | null> {
  if (p.exitCode !== null) return p.exitCode;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    p.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe("concurrent daemon starts", () => {
  it("second daemon short-circuits when a live daemon holds the lockfile", async () => {
    // First daemon — gets to the listen + lockfile write first.
    const first = boot();
    const firstLock = await waitForLockfile(8000, first.pid);

    // Second daemon in the same repo — should exit 0 without listening.
    const second = boot();
    const secondExit = await waitForExit(second, 5000);
    expect(secondExit).toBe(0);

    // Lockfile still points at the first daemon.
    const still = readLockfile(tmp);
    expect(still?.pid).toBe(first.pid);
    expect(still?.port).toBe(firstLock.port);
  });

  it("three daemons: only one wins, the other two exit cleanly", async () => {
    const a = boot();
    await waitForLockfile(8000, a.pid);
    const b = boot();
    const c = boot();
    const [exitB, exitC] = await Promise.all([waitForExit(b, 5000), waitForExit(c, 5000)]);
    expect(exitB).toBe(0);
    expect(exitC).toBe(0);
    const still = readLockfile(tmp);
    expect(still?.pid).toBe(a.pid);
  });

  it("after the winner exits, a new daemon can take over", async () => {
    // Boot first daemon
    const first = boot();
    const firstLock = await waitForLockfile(8000, first.pid);

    // Shut it down via API
    await fetch(`http://127.0.0.1:${firstLock.port}/api/shutdown`, { method: "POST" });
    await waitForExit(first, 5000);

    // Lockfile is gone (cleaned up by shutdown)
    expect(existsSync(join(tmp, ".iterate", "daemon.lock"))).toBe(false);

    // A second daemon can now start and claim the lockfile
    const second = boot();
    const secondLock = await waitForLockfile(8000, second.pid);
    expect(secondLock.pid).toBe(second.pid);
    expect(secondLock.pid).not.toBe(first.pid);
  });
});
