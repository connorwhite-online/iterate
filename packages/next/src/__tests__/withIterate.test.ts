import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { withIterate } from "../index.js";

/**
 * These tests cover the shape / public contract of `withIterate` — the bits a
 * user's next.config.ts depends on:
 *   - Returning an async function (not a plain object)
 *   - Production passthrough (no rewrites injected when NODE_ENV=production)
 *   - basePath is honored in the client-side env vars
 *   - `rewrites()` returns an array (the greenfield Next.js contract) when the
 *     user hasn't already defined rewrites
 *   - `rewrites()` preserves user-defined rewrites
 *
 * We avoid actually starting a daemon by setting ITERATE_DAEMON_PORT to an
 * absurdly high port so the auto-pick uses it without probing.
 */

const origEnv = { ...process.env };
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "iterate-next-"));
  execSync("git init -q", { cwd: tmp });
  // Point the plugin at our tmp repo so it doesn't discover a parent .iterate
  process.env.ITERATE_DAEMON_PORT = "49999";
  process.env.ITERATE_SKIP_DAEMON_START = "1";
  process.env.PWD = tmp;
  process.chdir(tmp);
});

afterEach(() => {
  process.env = { ...origEnv };
  rmSync(tmp, { recursive: true, force: true });
});

describe("withIterate — return shape", () => {
  it("returns a function (not a plain config object)", () => {
    const result = withIterate({});
    expect(typeof result).toBe("function");
  });

  it("the returned function is awaitable (returns a Promise)", async () => {
    process.env.NODE_ENV = "development";
    const fn = withIterate({});
    const val = fn();
    expect(val).toBeInstanceOf(Promise);
    // Don't await it — we'd start the daemon. Suppress the unhandled rejection
    // by attaching a catch.
    val.catch(() => {});
  });
});

describe("withIterate — production passthrough", () => {
  it("returns the original config unchanged when NODE_ENV=production", async () => {
    process.env.NODE_ENV = "production";
    const nextConfig = {
      reactStrictMode: true,
      images: { domains: ["example.com"] },
    };
    const result = await withIterate(nextConfig)();
    expect(result).toEqual(nextConfig);
    // Specifically, no iterate env was injected:
    expect(result.env?.NEXT_PUBLIC_ITERATE_DAEMON_PORT).toBeUndefined();
  });
});

describe("withIterate — dev mode shape", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "development";
  });

  it("injects NEXT_PUBLIC_ITERATE_* env vars with the resolved port", async () => {
    const result = await withIterate({ basePath: "/admin" }, { daemonPort: 48888 })();
    expect(result.env?.NEXT_PUBLIC_ITERATE_DAEMON_PORT).toBe("48888");
    expect(result.env?.NEXT_PUBLIC_ITERATE_BASE_PATH).toBe("/admin");
    expect(result.env?.NEXT_PUBLIC_ITERATE_ITERATION_NAME).toBeDefined();
  });

  it("normalizes trailing slashes in basePath", async () => {
    const result = await withIterate({ basePath: "/admin/" }, { daemonPort: 48888 })();
    expect(result.env?.NEXT_PUBLIC_ITERATE_BASE_PATH).toBe("/admin");
  });

  it("treats no basePath as an empty string", async () => {
    const result = await withIterate({}, { daemonPort: 48888 })();
    expect(result.env?.NEXT_PUBLIC_ITERATE_BASE_PATH).toBe("");
  });

  it("stamps NEXT_PUBLIC_ITERATE_APP_NAME when appName is configured", async () => {
    const result = await withIterate({}, { daemonPort: 48888, appName: "next-16-example" })();
    expect(result.env?.NEXT_PUBLIC_ITERATE_APP_NAME).toBe("next-16-example");
  });

  it("omits NEXT_PUBLIC_ITERATE_APP_NAME when appName is not set", async () => {
    const result = await withIterate({}, { daemonPort: 48888 })();
    // Intentionally absent rather than empty string — overlay treats absence as
    // "no app declared, let the daemon fall back to the sole configured app".
    expect("NEXT_PUBLIC_ITERATE_APP_NAME" in (result.env ?? {})).toBe(false);
  });

  it("exposes an async rewrites() that returns an array of proxy rules", async () => {
    const result = await withIterate({}, { daemonPort: 48888 })();
    const rewrites = await result.rewrites();
    expect(Array.isArray(rewrites)).toBe(true);
    const sources = (rewrites as Array<{ source: string }>).map((r) => r.source);
    expect(sources).toContain("/__iterate__/:path*");
    expect(sources).toContain("/api/iterations/:path*");
    expect(sources).toContain("/api/command");
  });

  it("points rewrites at 127.0.0.1:<daemonPort>", async () => {
    const result = await withIterate({}, { daemonPort: 48888 })();
    const rewrites = (await result.rewrites()) as Array<{ source: string; destination: string }>;
    for (const r of rewrites) {
      expect(r.destination).toContain("http://127.0.0.1:48888");
    }
  });

  it("merges user-defined rewrites array form", async () => {
    const userRewrites = [{ source: "/foo", destination: "/bar" }];
    const result = await withIterate(
      { rewrites: async () => userRewrites },
      { daemonPort: 48888 }
    )();
    const rewrites = (await result.rewrites()) as Array<{ source: string; destination: string }>;
    expect(rewrites).toContainEqual(userRewrites[0]);
    // iterate rewrites should also be present:
    expect(rewrites.find((r) => r.source === "/__iterate__/:path*")).toBeDefined();
  });

  it("merges user-defined rewrites object form via beforeFiles", async () => {
    const userRewrites = {
      beforeFiles: [{ source: "/old", destination: "/new" }],
      afterFiles: [],
      fallback: [],
    };
    const result = await withIterate(
      { rewrites: async () => userRewrites },
      { daemonPort: 48888 }
    )();
    const rewrites = (await result.rewrites()) as { beforeFiles: Array<{ source: string }> };
    const sources = rewrites.beforeFiles.map((r) => r.source);
    expect(sources).toContain("/__iterate__/:path*");
    expect(sources).toContain("/old");
  });

  it("preserves user env keys alongside injected iterate keys", async () => {
    const result = await withIterate(
      { env: { USER_FOO: "bar" } },
      { daemonPort: 48888 }
    )();
    expect(result.env?.USER_FOO).toBe("bar");
    expect(result.env?.NEXT_PUBLIC_ITERATE_DAEMON_PORT).toBe("48888");
  });

  it("is idempotent — calling the returned function twice yields the same port", async () => {
    const fn = withIterate({}, { daemonPort: 48888 });
    const a = await fn();
    const b = await fn();
    expect(a.env?.NEXT_PUBLIC_ITERATE_DAEMON_PORT).toBe(b.env?.NEXT_PUBLIC_ITERATE_DAEMON_PORT);
  });
});

describe("withIterate — config file integration", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "development";
    delete process.env.ITERATE_DAEMON_PORT;
  });

  it("uses daemonPort from .iterate/config.json when no option/env var overrides", async () => {
    // Write the config file (mkdirSync + writeFileSync)
    const iterateDir = join(tmp, ".iterate");
    execSync(`mkdir -p ${iterateDir}`);
    writeFileSync(
      join(iterateDir, "config.json"),
      JSON.stringify({
        apps: [{ name: "web", devCommand: "next dev" }],
        packageManager: "pnpm",
        basePort: 3100,
        daemonPort: 48123,
        maxIterations: 3,
        idleTimeout: 0,
      })
    );
    const result = await withIterate({})();
    expect(result.env?.NEXT_PUBLIC_ITERATE_DAEMON_PORT).toBe("48123");
  });

  it("option.daemonPort wins over config file", async () => {
    const iterateDir = join(tmp, ".iterate");
    execSync(`mkdir -p ${iterateDir}`);
    writeFileSync(
      join(iterateDir, "config.json"),
      JSON.stringify({
        apps: [{ name: "web", devCommand: "next dev" }],
        packageManager: "pnpm",
        basePort: 3100,
        daemonPort: 48123,
        maxIterations: 3,
        idleTimeout: 0,
      })
    );
    const result = await withIterate({}, { daemonPort: 48999 })();
    expect(result.env?.NEXT_PUBLIC_ITERATE_DAEMON_PORT).toBe("48999");
  });
});
