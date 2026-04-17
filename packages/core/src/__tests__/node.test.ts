import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:net";
import {
  loadConfig,
  loadConfigOrDefault,
  saveConfig,
  configPath,
  readLockfile,
  writeLockfile,
  removeLockfile,
  lockfilePath,
  isDaemonAlive,
  resolveDaemonPort,
  isPortInUse,
  canBindPort,
  findFreePort,
  parseDotenv,
  loadEnvFiles,
} from "../node.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "iterate-core-test-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("config file IO", () => {
  it("loadConfig returns null when file is missing", () => {
    expect(loadConfig(tmp)).toBeNull();
  });

  it("loadConfigOrDefault returns defaults when file is missing", () => {
    const out = loadConfigOrDefault(tmp);
    expect(out.apps).toEqual([]);
    expect(out.daemonPort).toBeGreaterThan(0);
  });

  it("saveConfig + loadConfig round-trips", () => {
    const original = {
      apps: [{ name: "web", devCommand: "next dev" }],
      packageManager: "pnpm" as const,
      basePort: 3100,
      daemonPort: 47100,
      maxIterations: 3,
      idleTimeout: 0,
    };
    saveConfig(tmp, original);
    expect(existsSync(configPath(tmp))).toBe(true);
    const loaded = loadConfig(tmp);
    expect(loaded?.apps[0].name).toBe("web");
    expect(loaded?.daemonPort).toBe(47100);
  });

  it("loadConfig normalizes legacy flat configs", () => {
    mkdirSync(join(tmp, ".iterate"), { recursive: true });
    writeFileSync(
      configPath(tmp),
      JSON.stringify({
        devCommand: "pnpm dev",
        appDir: "apps/web",
        packageManager: "pnpm",
        basePort: 3100,
        daemonPort: 4000,
        maxIterations: 3,
        idleTimeout: 0,
      })
    );
    const loaded = loadConfig(tmp);
    expect(loaded?.apps).toHaveLength(1);
    expect(loaded?.apps[0].devCommand).toBe("pnpm dev");
    expect(loaded?.apps[0].appDir).toBe("apps/web");
  });

  it("loadConfig throws on malformed JSON (fail loud, don't silently lose user config)", () => {
    mkdirSync(join(tmp, ".iterate"), { recursive: true });
    writeFileSync(configPath(tmp), "{ this is not valid json ");
    expect(() => loadConfig(tmp)).toThrow();
  });

  it("loadConfig handles an empty JSON object (fills in defaults via normalizeConfig)", () => {
    mkdirSync(join(tmp, ".iterate"), { recursive: true });
    writeFileSync(configPath(tmp), "{}");
    const loaded = loadConfig(tmp);
    expect(loaded?.apps).toEqual([]);
    expect(loaded?.daemonPort).toBeGreaterThan(0);
  });

  it("loadConfig handles partial configs with missing optional fields", () => {
    mkdirSync(join(tmp, ".iterate"), { recursive: true });
    writeFileSync(
      configPath(tmp),
      JSON.stringify({
        apps: [{ name: "web", devCommand: "next dev" }],
      })
    );
    const loaded = loadConfig(tmp);
    expect(loaded?.apps[0].name).toBe("web");
    // Missing fields inherit from DEFAULT_CONFIG
    expect(loaded?.basePort).toBeGreaterThan(0);
    expect(loaded?.daemonPort).toBeGreaterThan(0);
    expect(loaded?.maxIterations).toBeGreaterThan(0);
  });
});

describe("lockfile", () => {
  it("returns null when missing", () => {
    expect(readLockfile(tmp)).toBeNull();
  });

  it("writes and reads back a valid lockfile", () => {
    writeLockfile(tmp, {
      pid: process.pid,
      port: 47100,
      cwd: tmp,
      startedAt: new Date().toISOString(),
    });
    const back = readLockfile(tmp);
    expect(back?.pid).toBe(process.pid);
    expect(back?.port).toBe(47100);
  });

  it("returns null for malformed lockfile contents", () => {
    mkdirSync(join(tmp, ".iterate"), { recursive: true });
    writeFileSync(lockfilePath(tmp), "{not valid json");
    expect(readLockfile(tmp)).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    mkdirSync(join(tmp, ".iterate"), { recursive: true });
    writeFileSync(lockfilePath(tmp), JSON.stringify({ pid: 123 }));
    expect(readLockfile(tmp)).toBeNull();
  });

  it("removeLockfile deletes the file idempotently", () => {
    writeLockfile(tmp, { pid: 1, port: 1, cwd: tmp, startedAt: "" });
    expect(existsSync(lockfilePath(tmp))).toBe(true);
    removeLockfile(tmp);
    expect(existsSync(lockfilePath(tmp))).toBe(false);
    // second call should not throw
    expect(() => removeLockfile(tmp)).not.toThrow();
  });

  it("isDaemonAlive returns true for the current process", () => {
    expect(
      isDaemonAlive({ pid: process.pid, port: 1, cwd: tmp, startedAt: "" })
    ).toBe(true);
  });

  it("isDaemonAlive returns false for a clearly-dead PID", () => {
    // PID 2^31 - 1 (max 32-bit signed) is effectively never assigned.
    expect(
      isDaemonAlive({ pid: 2147483647, port: 1, cwd: tmp, startedAt: "" })
    ).toBe(false);
  });
});

describe("resolveDaemonPort", () => {
  it("respects an explicit override", () => {
    expect(resolveDaemonPort(tmp, null, 12345)).toBe(12345);
  });

  it("prefers the lockfile when present", () => {
    writeLockfile(tmp, {
      pid: process.pid,
      port: 55555,
      cwd: tmp,
      startedAt: "",
    });
    expect(resolveDaemonPort(tmp, null)).toBe(55555);
  });

  it("falls back to config.daemonPort when no lockfile", () => {
    expect(
      resolveDaemonPort(tmp, {
        apps: [],
        packageManager: "npm",
        basePort: 3100,
        daemonPort: 47200,
        maxIterations: 3,
        idleTimeout: 0,
      })
    ).toBe(47200);
  });

  it("falls back to the default when neither lockfile nor config is present", () => {
    const p = resolveDaemonPort(tmp, null);
    expect(p).toBeGreaterThan(0);
  });
});

describe("port probing", () => {
  let server: Server;
  let busyPort = 0;

  beforeEach(async () => {
    server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (addr && typeof addr !== "string") busyPort = addr.port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("isPortInUse returns true for a listening port", async () => {
    expect(await isPortInUse(busyPort)).toBe(true);
  });

  it("canBindPort returns false for an occupied port", async () => {
    expect(await canBindPort(busyPort)).toBe(false);
  });

  it("findFreePort finds a port above the busy one", async () => {
    const free = await findFreePort(busyPort);
    expect(free).toBeGreaterThanOrEqual(busyPort);
    expect(free).not.toBe(busyPort);
  });

  it("findFreePort throws when the range is exhausted", async () => {
    // Zero attempts guarantees exhaustion without occupying any real ports.
    await expect(findFreePort(busyPort, 0)).rejects.toThrow(/No free port in range/);
  });

  it("findFreePort stops climbing past 65535", async () => {
    // Even with many attempts, don't probe beyond valid port range.
    await expect(findFreePort(65535, 10)).resolves.toBeLessThanOrEqual(65535);
  });
});

describe("parseDotenv", () => {
  it("parses basic KEY=VALUE pairs", () => {
    expect(parseDotenv("FOO=bar\nBAZ=qux\n")).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("ignores comments and blank lines", () => {
    expect(parseDotenv("# comment\n\nFOO=bar\n")).toEqual({ FOO: "bar" });
  });

  it("handles double-quoted values with escaped newlines", () => {
    expect(parseDotenv('FOO="line1\\nline2"\n')).toEqual({ FOO: "line1\nline2" });
  });

  it("handles single-quoted values verbatim", () => {
    expect(parseDotenv("FOO='hello world'\n")).toEqual({ FOO: "hello world" });
  });

  it("strips trailing comments from unquoted values", () => {
    expect(parseDotenv("FOO=bar # trailing\n")).toEqual({ FOO: "bar" });
  });

  it("ignores malformed lines without crashing", () => {
    expect(parseDotenv("nothing\n=novalue\nGOOD=yes\n")).toEqual({ GOOD: "yes" });
  });

  it("rejects keys that aren't valid identifiers", () => {
    expect(parseDotenv("1BAD=x\n.bad=x\ngood_1=y\n")).toEqual({ good_1: "y" });
  });
});

describe("loadEnvFiles", () => {
  it("merges files in order, later wins", () => {
    writeFileSync(join(tmp, "a.env"), "FOO=from-a\nSHARED=a\n");
    writeFileSync(join(tmp, "b.env"), "BAR=from-b\nSHARED=b\n");
    const out = loadEnvFiles(tmp, ["a.env", "b.env"]);
    expect(out).toEqual({ FOO: "from-a", BAR: "from-b", SHARED: "b" });
  });

  it("silently skips missing files", () => {
    writeFileSync(join(tmp, "present.env"), "FOO=bar\n");
    const out = loadEnvFiles(tmp, ["missing.env", "present.env", "also-missing.env"]);
    expect(out).toEqual({ FOO: "bar" });
  });

  it("returns an empty object for an empty list", () => {
    expect(loadEnvFiles(tmp, [])).toEqual({});
  });

  it("respects absolute paths", () => {
    const absPath = join(tmp, "abs.env");
    writeFileSync(absPath, "A=1\n");
    // Pass a repoRoot that's nowhere near the absolute path
    const unrelated = mkdtempSync(join(tmpdir(), "iterate-core-other-"));
    try {
      const out = loadEnvFiles(unrelated, [absPath]);
      expect(out).toEqual({ A: "1" });
    } finally {
      rmSync(unrelated, { recursive: true, force: true });
    }
  });
});

describe("saveConfig formatting", () => {
  it("writes pretty-printed JSON with a trailing newline", () => {
    saveConfig(tmp, {
      apps: [{ name: "x", devCommand: "y" }],
      packageManager: "npm",
      basePort: 3100,
      daemonPort: 47100,
      maxIterations: 3,
      idleTimeout: 0,
    });
    const raw = readFileSync(configPath(tmp), "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain("\n  ");
  });
});
