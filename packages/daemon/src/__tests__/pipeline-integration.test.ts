import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AppConfig, IterateConfig, IterationInfo } from "iterate-ui-core";
import { runIterationPipeline } from "../iteration/pipeline.js";

// We mock execa so we don't actually run pnpm install against a tmpdir —
// we just verify the pipeline orchestrates the right sequence of calls.
vi.mock("execa", () => ({
  execa: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
}));

const baseConfig: IterateConfig = {
  apps: [],
  packageManager: "pnpm",
  basePort: 3100,
  daemonPort: 47100,
  maxIterations: 3,
  idleTimeout: 0,
};

type StartArgs = [
  name: string,
  cwd: string,
  command: string,
  port: number,
  env: Record<string, string>,
];

function mockProcessManager() {
  // Explicit parameter types so tests can read `.mock.calls[0][i]` without
  // hitting "tuple has no element at index i".
  return {
    allocatePort: vi.fn(async (): Promise<number> => 3101),
    start: vi.fn(async (..._args: StartArgs): Promise<{ pid: number }> => ({ pid: 99999 })),
    waitForReady: vi.fn(async (_name: string, _port: number): Promise<void> => {}),
    getRecentOutput: vi.fn((_name: string): string[] => []),
    stop: vi.fn(async (_name: string): Promise<void> => {}),
    stopAll: vi.fn(async (): Promise<void> => {}),
  };
}

function mockStore() {
  const iterations = new Map<string, IterationInfo>();
  return {
    setIteration: vi.fn((name: string, info: IterationInfo) => {
      iterations.set(name, { ...info });
    }),
    getIteration: vi.fn((name: string) => iterations.get(name)),
    iterations,
  };
}

function mockHub() {
  const events: Array<{ type: string; payload: unknown }> = [];
  return {
    broadcast: vi.fn((evt: { type: string; payload: unknown }) => {
      events.push(evt);
    }),
    events,
  };
}

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "iterate-pipeline-"));
  mkdirSync(join(tmp, "apps", "web"), { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("runIterationPipeline — orchestration", () => {
  it("runs install → start → waitForReady in order, sets status transitions, and allocates a port", async () => {
    const app: AppConfig = {
      name: "web",
      devCommand: "next dev",
      appDir: "apps/web",
    };
    const info: IterationInfo = {
      name: "it1",
      branch: "iterate/web/it1",
      worktreePath: tmp,
      port: 0,
      pid: null,
      status: "creating",
      createdAt: new Date().toISOString(),
      appName: "web",
    };

    const pm = mockProcessManager();
    const store = mockStore();
    const hub = mockHub();

    const execaMod = await import("execa");
    const execaFn = execaMod.execa as unknown as ReturnType<typeof vi.fn>;

    await runIterationPipeline({
      repoRoot: tmp,
      worktreeRoot: tmp,
      app,
      info,
      config: { ...baseConfig, apps: [app] },
      processManager: pm as any,
      store: store as any,
      wsHub: hub as any,
    });

    // Status transitions should have been broadcast in order
    const statusEvents = hub.events
      .filter((e) => e.type === "iteration:status")
      .map((e) => (e.payload as { status: string }).status);
    expect(statusEvents).toEqual(["installing", "starting"]);

    // Final info should be ready with the allocated port + pid
    expect(info.status).toBe("ready");
    expect(info.port).toBe(3101);
    expect(info.pid).toBe(99999);

    // Install command was invoked with the expected pnpm args
    expect(execaFn).toHaveBeenCalledWith("pnpm", ["install", "--prefer-offline"], {
      cwd: tmp,
    });

    // Dev server was started with the resolved command (next → -p flag appended),
    // at the app subdir, with the correct port and env.
    expect(pm.start).toHaveBeenCalledTimes(1);
    const [startName, startCwd, startCmd, startPort, startEnv] = pm.start.mock.calls[0];
    expect(startName).toBe("it1");
    expect(startCwd).toBe(join(tmp, "apps", "web"));
    expect(startCmd).toBe("next dev -p 3101");
    expect(startPort).toBe(3101);
    expect(startEnv).toMatchObject({
      ITERATE_WORKTREE_ROOT: tmp,
      ITERATE_APP_NAME: "web",
    });

    // waitForReady was called with the same port
    expect(pm.waitForReady).toHaveBeenCalledWith("it1", 3101);
  });

  it("uses portEnvVar + leaves wrapped dev command untouched", async () => {
    const app: AppConfig = {
      name: "brand-admin",
      devCommand: "PORT=$BRAND_ADMIN_PORT env-cmd.ts --dev -- pnpm next dev",
      portEnvVar: "BRAND_ADMIN_PORT",
      appDir: "apps/web",
    };
    const info: IterationInfo = {
      name: "it2",
      branch: "iterate/brand-admin/it2",
      worktreePath: tmp,
      port: 0,
      pid: null,
      status: "creating",
      createdAt: new Date().toISOString(),
      appName: "brand-admin",
    };

    const pm = mockProcessManager();
    const store = mockStore();
    const hub = mockHub();

    await runIterationPipeline({
      repoRoot: tmp,
      worktreeRoot: tmp,
      app,
      info,
      config: { ...baseConfig, apps: [app] },
      processManager: pm as any,
      store: store as any,
      wsHub: hub as any,
    });

    const [, , startCmd, , startEnv] = pm.start.mock.calls[0];
    // Command string is NOT mutated
    expect(startCmd).toBe("PORT=$BRAND_ADMIN_PORT env-cmd.ts --dev -- pnpm next dev");
    // Port is passed via the env var
    expect(startEnv.BRAND_ADMIN_PORT).toBe("3101");
  });

  it("honors envFiles and merges them into the child env", async () => {
    writeFileSync(join(tmp, ".env.development.pre"), "DB_URL=postgres://local\nBRAND_ADMIN_PORT=4055\n");
    writeFileSync(join(tmp, ".env.development"), "NODE_ENV=development\n");

    const app: AppConfig = {
      name: "brand-admin",
      devCommand: "env-cmd.ts --dev -- pnpm next dev",
      portEnvVar: "BRAND_ADMIN_PORT",
      envFiles: [".env.development.pre", ".env.development"],
      appDir: "apps/web",
    };
    const info: IterationInfo = {
      name: "it3",
      branch: "iterate/brand-admin/it3",
      worktreePath: tmp,
      port: 0,
      pid: null,
      status: "creating",
      createdAt: new Date().toISOString(),
      appName: "brand-admin",
    };

    const pm = mockProcessManager();
    const store = mockStore();
    const hub = mockHub();

    await runIterationPipeline({
      repoRoot: tmp,
      worktreeRoot: tmp,
      app,
      info,
      config: { ...baseConfig, apps: [app] },
      processManager: pm as any,
      store: store as any,
      wsHub: hub as any,
    });

    const [, , , , startEnv] = pm.start.mock.calls[0];
    expect(startEnv.DB_URL).toBe("postgres://local");
    expect(startEnv.NODE_ENV).toBe("development");
    // Port env overrides the file-supplied 4055 with the allocated port.
    expect(startEnv.BRAND_ADMIN_PORT).toBe("3101");
  });

  it("runs the optional buildCommand between install and start", async () => {
    const execaMod = await import("execa");
    const execaFn = execaMod.execa as unknown as ReturnType<typeof vi.fn>;

    const app: AppConfig = {
      name: "web",
      devCommand: "next dev",
      buildCommand: "pnpm build:shared",
      appDir: "apps/web",
    };
    const info: IterationInfo = {
      name: "it4",
      branch: "iterate/web/it4",
      worktreePath: tmp,
      port: 0,
      pid: null,
      status: "creating",
      createdAt: new Date().toISOString(),
      appName: "web",
    };

    const pm = mockProcessManager();
    const store = mockStore();
    const hub = mockHub();

    await runIterationPipeline({
      repoRoot: tmp,
      worktreeRoot: tmp,
      app,
      info,
      config: { ...baseConfig, apps: [app] },
      processManager: pm as any,
      store: store as any,
      wsHub: hub as any,
    });

    // Order: install, then build, then start.
    const calls = execaFn.mock.calls.map((c) => `${c[0]} ${(c[1] as string[]).join(" ")}`);
    const installIdx = calls.findIndex((c) => c.startsWith("pnpm install"));
    const buildIdx = calls.findIndex((c) => c.startsWith("pnpm build:shared"));
    expect(installIdx).toBeGreaterThanOrEqual(0);
    expect(buildIdx).toBeGreaterThanOrEqual(0);
    expect(buildIdx).toBeGreaterThan(installIdx);
    // pm.start happens after both.
    expect(pm.start).toHaveBeenCalled();
  });

  it("respects per-app packageManager override", async () => {
    const execaMod = await import("execa");
    const execaFn = execaMod.execa as unknown as ReturnType<typeof vi.fn>;

    const app: AppConfig = {
      name: "web",
      devCommand: "next dev",
      packageManager: "bun",
      appDir: "apps/web",
    };
    const info: IterationInfo = {
      name: "it5",
      branch: "iterate/web/it5",
      worktreePath: tmp,
      port: 0,
      pid: null,
      status: "creating",
      createdAt: new Date().toISOString(),
      appName: "web",
    };

    const pm = mockProcessManager();
    const store = mockStore();
    const hub = mockHub();

    await runIterationPipeline({
      repoRoot: tmp,
      worktreeRoot: tmp,
      app,
      info,
      config: { ...baseConfig, apps: [app] },
      processManager: pm as any,
      store: store as any,
      wsHub: hub as any,
    });

    const installCall = execaFn.mock.calls.find((c) => c[0] === "bun");
    expect(installCall).toBeDefined();
    expect(installCall![1]).toEqual(["install"]);
  });

  it("respects per-app installCommand override (bypasses package-manager default)", async () => {
    const execaMod = await import("execa");
    const execaFn = execaMod.execa as unknown as ReturnType<typeof vi.fn>;

    const app: AppConfig = {
      name: "web",
      devCommand: "next dev",
      installCommand: "pnpm install --filter ./apps/web...",
      appDir: "apps/web",
    };
    const info: IterationInfo = {
      name: "it6",
      branch: "iterate/web/it6",
      worktreePath: tmp,
      port: 0,
      pid: null,
      status: "creating",
      createdAt: new Date().toISOString(),
      appName: "web",
    };

    const pm = mockProcessManager();
    const store = mockStore();
    const hub = mockHub();

    await runIterationPipeline({
      repoRoot: tmp,
      worktreeRoot: tmp,
      app,
      info,
      config: { ...baseConfig, apps: [app] },
      processManager: pm as any,
      store: store as any,
      wsHub: hub as any,
    });

    const installCall = execaFn.mock.calls.find((c) => Array.isArray(c[1]) && (c[1] as string[]).includes("--filter"));
    expect(installCall).toBeDefined();
    expect(installCall![0]).toBe("pnpm");
  });

  it("sets ITERATE_APP_NAME even when the app has no appDir", async () => {
    const app: AppConfig = { name: "monolith", devCommand: "vite" };
    const info: IterationInfo = {
      name: "it7",
      branch: "iterate/monolith/it7",
      worktreePath: tmp,
      port: 0,
      pid: null,
      status: "creating",
      createdAt: new Date().toISOString(),
      appName: "monolith",
    };

    const pm = mockProcessManager();
    const store = mockStore();
    const hub = mockHub();

    await runIterationPipeline({
      repoRoot: tmp,
      worktreeRoot: tmp,
      app,
      info,
      config: { ...baseConfig, apps: [app] },
      processManager: pm as any,
      store: store as any,
      wsHub: hub as any,
    });

    const [, startCwd, , , startEnv] = pm.start.mock.calls[0];
    expect(startCwd).toBe(tmp); // no appDir → worktree root
    expect(startEnv.ITERATE_APP_NAME).toBe("monolith");
  });

  it("writes the iteration info to the store after each transition", async () => {
    const app: AppConfig = { name: "web", devCommand: "next dev" };
    const info: IterationInfo = {
      name: "it8",
      branch: "iterate/web/it8",
      worktreePath: tmp,
      port: 0,
      pid: null,
      status: "creating",
      createdAt: new Date().toISOString(),
      appName: "web",
    };

    const pm = mockProcessManager();
    const store = mockStore();
    const hub = mockHub();

    await runIterationPipeline({
      repoRoot: tmp,
      worktreeRoot: tmp,
      app,
      info,
      config: { ...baseConfig, apps: [app] },
      processManager: pm as any,
      store: store as any,
      wsHub: hub as any,
    });

    // Setter was called at least 3 times: installing → starting → ready.
    // (Broadcasts happen alongside.)
    expect(store.setIteration.mock.calls.length).toBeGreaterThanOrEqual(3);
    const lastCall = store.setIteration.mock.calls.at(-1);
    expect(lastCall?.[1].status).toBe("ready");
  });

  it("surfaces a failing install by letting the error propagate", async () => {
    const execaMod = await import("execa");
    const execaFn = execaMod.execa as unknown as ReturnType<typeof vi.fn>;
    execaFn.mockRejectedValueOnce(new Error("install exploded"));

    const app: AppConfig = { name: "web", devCommand: "next dev" };
    const info: IterationInfo = {
      name: "boom",
      branch: "iterate/web/boom",
      worktreePath: tmp,
      port: 0,
      pid: null,
      status: "creating",
      createdAt: new Date().toISOString(),
      appName: "web",
    };

    const pm = mockProcessManager();
    const store = mockStore();
    const hub = mockHub();

    await expect(
      runIterationPipeline({
        repoRoot: tmp,
        worktreeRoot: tmp,
        app,
        info,
        config: { ...baseConfig, apps: [app] },
        processManager: pm as any,
        store: store as any,
        wsHub: hub as any,
      })
    ).rejects.toThrow("install exploded");

    // pm.start should NOT have been called
    expect(pm.start).not.toHaveBeenCalled();
    // info was NOT moved to "ready"
    expect(info.status).not.toBe("ready");
  });
});

// Sanity: readFileSync is imported for lint-friendly test files but the tests above
// use it indirectly through loadEnvFiles. Suppress unused-import warning.
void readFileSync;
