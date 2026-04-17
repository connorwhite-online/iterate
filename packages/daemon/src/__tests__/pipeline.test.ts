import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { AppConfig, IterateConfig } from "iterate-ui-core";
import {
  buildDevCommand,
  getInstallCommand,
  buildChildEnv,
  resolveAppCwd,
  resolveAppForRequest,
  resolveAppForWorktreeBranch,
  joinAppDir,
} from "../iteration/pipeline.js";

const baseConfig: IterateConfig = {
  apps: [],
  packageManager: "pnpm",
  basePort: 3100,
  daemonPort: 47100,
  maxIterations: 3,
  idleTimeout: 0,
};

describe("buildDevCommand", () => {
  it("appends -p <port> for next dev", () => {
    const app: AppConfig = { name: "web", devCommand: "next dev" };
    const out = buildDevCommand(app, 3100);
    expect(out.command).toBe("next dev -p 3100");
    expect(out.env).toEqual({});
  });

  it("appends -p <port> when the command runs next via a package manager", () => {
    const app: AppConfig = { name: "web", devCommand: "pnpm next dev --turbo" };
    const out = buildDevCommand(app, 3101);
    expect(out.command).toBe("pnpm next dev --turbo -p 3101");
  });

  it("appends --port <port> for vite", () => {
    const app: AppConfig = { name: "web", devCommand: "vite" };
    const out = buildDevCommand(app, 3102);
    expect(out.command).toBe("vite --port 3102");
  });

  it("leaves devCommand untouched and sets portEnvVar when configured", () => {
    const app: AppConfig = {
      name: "brand-admin",
      devCommand: "PORT=$BRAND_ADMIN_PORT env-cmd.ts --dev -- pnpm next dev",
      portEnvVar: "BRAND_ADMIN_PORT",
    };
    const out = buildDevCommand(app, 4055);
    expect(out.command).toBe("PORT=$BRAND_ADMIN_PORT env-cmd.ts --dev -- pnpm next dev");
    expect(out.env).toEqual({ BRAND_ADMIN_PORT: "4055" });
  });

  it("sets PORT env var for unknown commands without portEnvVar", () => {
    const app: AppConfig = { name: "web", devCommand: "my-custom-dev-runner" };
    const out = buildDevCommand(app, 3200);
    expect(out.command).toBe("my-custom-dev-runner");
    expect(out.env).toEqual({ PORT: "3200" });
  });

  it("doesn't pattern-match 'next' inside other words", () => {
    const app: AppConfig = { name: "web", devCommand: "nexto-dev" };
    const out = buildDevCommand(app, 3100);
    // Should not treat as next — falls through to default branch
    expect(out.command).toBe("nexto-dev");
    expect(out.env).toEqual({ PORT: "3100" });
  });
});

describe("getInstallCommand", () => {
  it("returns pnpm install --prefer-offline for pnpm", () => {
    expect(getInstallCommand("pnpm")).toBe("pnpm install --prefer-offline");
  });
  it("returns yarn install for yarn", () => {
    expect(getInstallCommand("yarn")).toBe("yarn install");
  });
  it("returns bun install for bun", () => {
    expect(getInstallCommand("bun")).toBe("bun install");
  });
  it("returns npm install --prefer-offline for npm", () => {
    expect(getInstallCommand("npm")).toBe("npm install --prefer-offline");
  });
  it("defaults to npm when undefined", () => {
    expect(getInstallCommand(undefined)).toBe("npm install --prefer-offline");
  });
});

describe("buildChildEnv", () => {
  it("loads env files and merges with port env", () => {
    const tmp = mkdtempSync(join(tmpdir(), "iterate-env-"));
    try {
      writeFileSync(join(tmp, ".env.shared"), "SHARED=yes\nBRAND_ADMIN_PORT=4055\n");
      writeFileSync(join(tmp, ".env.dev"), "NODE_ENV=development\n");
      const app: AppConfig = {
        name: "brand-admin",
        devCommand: "env-cmd -- next dev",
        portEnvVar: "BRAND_ADMIN_PORT",
        envFiles: [".env.shared", ".env.dev"],
      };
      const env = buildChildEnv(tmp, baseConfig, app, { BRAND_ADMIN_PORT: "5000" });
      // File-provided vars come through
      expect(env.SHARED).toBe("yes");
      expect(env.NODE_ENV).toBe("development");
      // The port env passes last and overrides the file-provided 4055
      expect(env.BRAND_ADMIN_PORT).toBe("5000");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("forwards envPassthrough from the host process", () => {
    const app: AppConfig = { name: "web", devCommand: "next dev" };
    const original = process.env.FAKE_PASSTHROUGH_FOR_TEST;
    process.env.FAKE_PASSTHROUGH_FOR_TEST = "sekret";
    try {
      const env = buildChildEnv(
        "/tmp",
        { ...baseConfig, envPassthrough: ["FAKE_PASSTHROUGH_FOR_TEST"] },
        app,
        {}
      );
      expect(env.FAKE_PASSTHROUGH_FOR_TEST).toBe("sekret");
    } finally {
      if (original === undefined) delete process.env.FAKE_PASSTHROUGH_FOR_TEST;
      else process.env.FAKE_PASSTHROUGH_FOR_TEST = original;
    }
  });

  it("skips envPassthrough vars that aren't set in the host", () => {
    const app: AppConfig = { name: "web", devCommand: "next dev" };
    delete process.env.DEFINITELY_NOT_SET_IN_HOST;
    const env = buildChildEnv(
      "/tmp",
      { ...baseConfig, envPassthrough: ["DEFINITELY_NOT_SET_IN_HOST"] },
      app,
      {}
    );
    expect(env.DEFINITELY_NOT_SET_IN_HOST).toBeUndefined();
  });

  it("returns an empty object when no envFiles or passthrough and no portEnv", () => {
    const app: AppConfig = { name: "web", devCommand: "next dev" };
    const env = buildChildEnv("/tmp", baseConfig, app, {});
    expect(env).toEqual({});
  });
});

describe("resolveAppCwd", () => {
  it("returns root when app has no appDir", () => {
    const tmp = mkdtempSync(join(tmpdir(), "iterate-cwd-"));
    try {
      expect(resolveAppCwd(tmp, { name: "x", devCommand: "y" })).toBe(tmp);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("joins appDir relative to root when present", () => {
    const tmp = mkdtempSync(join(tmpdir(), "iterate-cwd-"));
    try {
      mkdirSync(join(tmp, "apps", "web"), { recursive: true });
      const resolved = resolveAppCwd(tmp, {
        name: "web",
        devCommand: "vite",
        appDir: "apps/web",
      });
      expect(resolved).toBe(join(tmp, "apps", "web"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("falls back to root if appDir doesn't exist", () => {
    const tmp = mkdtempSync(join(tmpdir(), "iterate-cwd-"));
    try {
      const resolved = resolveAppCwd(tmp, {
        name: "missing",
        devCommand: "vite",
        appDir: "apps/doesnt-exist",
      });
      expect(resolved).toBe(tmp);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("respects absolute appDir paths", () => {
    const tmp = mkdtempSync(join(tmpdir(), "iterate-cwd-"));
    try {
      const abs = join(tmp, "somewhere");
      mkdirSync(abs);
      const resolved = resolveAppCwd("/tmp", {
        name: "abs",
        devCommand: "x",
        appDir: abs,
      });
      expect(resolved).toBe(abs);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("joinAppDir", () => {
  it("returns root when appDir is undefined", () => {
    expect(joinAppDir("/tmp/repo", undefined)).toBe("/tmp/repo");
  });
  it("joins a relative path", () => {
    expect(joinAppDir("/tmp/repo", "apps/web")).toBe("/tmp/repo/apps/web");
  });
  it("returns absolute path as-is", () => {
    expect(joinAppDir("/tmp/repo", "/elsewhere/app")).toBe("/elsewhere/app");
  });
});

describe("resolveAppForRequest", () => {
  const twoApps: IterateConfig = {
    apps: [
      { name: "admin", devCommand: "next dev" },
      { name: "web", devCommand: "vite" },
    ],
    packageManager: "pnpm",
    basePort: 3100,
    daemonPort: 47100,
    maxIterations: 3,
    idleTimeout: 0,
  };
  const oneApp: IterateConfig = { ...twoApps, apps: [twoApps.apps[0]] };
  const noApps: IterateConfig = { ...twoApps, apps: [] };

  it("returns the named app when appName is provided and matches", () => {
    expect(resolveAppForRequest(twoApps, "admin")?.name).toBe("admin");
  });

  it("returns undefined when appName is provided but doesn't match any app", () => {
    expect(resolveAppForRequest(twoApps, "missing")).toBeUndefined();
  });

  it("returns the sole app when appName is omitted and exactly one app is configured", () => {
    expect(resolveAppForRequest(oneApp, undefined)?.name).toBe("admin");
  });

  it("returns undefined when appName is omitted and multiple apps are configured", () => {
    expect(resolveAppForRequest(twoApps, undefined)).toBeUndefined();
  });

  it("returns undefined when appName is omitted and no apps are configured", () => {
    expect(resolveAppForRequest(noApps, undefined)).toBeUndefined();
  });

  it("treats empty-string appName as omitted", () => {
    expect(resolveAppForRequest(oneApp, "")?.name).toBe("admin");
  });
});

describe("resolveAppForWorktreeBranch", () => {
  const twoApps: IterateConfig = {
    apps: [
      { name: "admin", devCommand: "next dev" },
      { name: "web", devCommand: "vite" },
    ],
    packageManager: "pnpm",
    basePort: 3100,
    daemonPort: 47100,
    maxIterations: 3,
    idleTimeout: 0,
  };
  const oneApp: IterateConfig = { ...twoApps, apps: [twoApps.apps[0]] };

  it("matches iterate/<app>/<rest> convention", () => {
    expect(resolveAppForWorktreeBranch(twoApps, "iterate/admin/my-feature")?.name).toBe("admin");
    expect(resolveAppForWorktreeBranch(twoApps, "iterate/web/nested/path")?.name).toBe("web");
  });

  it("falls back to the sole app when convention doesn't match", () => {
    expect(resolveAppForWorktreeBranch(oneApp, "iterate/my-feature")?.name).toBe("admin");
    expect(resolveAppForWorktreeBranch(oneApp, "random-branch")?.name).toBe("admin");
  });

  it("returns undefined when convention doesn't match and multiple apps exist", () => {
    expect(resolveAppForWorktreeBranch(twoApps, "iterate/my-feature")).toBeUndefined();
    expect(resolveAppForWorktreeBranch(twoApps, "random-branch")).toBeUndefined();
  });

  it("returns undefined when iterate/<app>/... app doesn't exist and multiple apps configured", () => {
    expect(resolveAppForWorktreeBranch(twoApps, "iterate/unknown/x")).toBeUndefined();
  });

  it("handles branches with no segment after iterate/ gracefully", () => {
    expect(resolveAppForWorktreeBranch(oneApp, "iterate/")?.name).toBe("admin");
    expect(resolveAppForWorktreeBranch(twoApps, "iterate/")).toBeUndefined();
  });
});

describe("buildDevCommand — additional coverage", () => {
  it("portEnvVar trumps the next heuristic (wrapper takes precedence)", () => {
    const app: AppConfig = {
      name: "web",
      devCommand: "pnpm next dev --turbo",
      portEnvVar: "PORT_FOR_NEXT",
    };
    const out = buildDevCommand(app, 5000);
    // Because portEnvVar is set, the command string is NOT mutated even though it contains "next"
    expect(out.command).toBe("pnpm next dev --turbo");
    expect(out.env).toEqual({ PORT_FOR_NEXT: "5000" });
  });

  it("portEnvVar trumps the vite heuristic", () => {
    const app: AppConfig = {
      name: "web",
      devCommand: "pnpm vite dev --host",
      portEnvVar: "VITE_PORT",
    };
    const out = buildDevCommand(app, 5001);
    expect(out.command).toBe("pnpm vite dev --host");
    expect(out.env).toEqual({ VITE_PORT: "5001" });
  });

  it("matches word-boundaries, not substrings", () => {
    // 'vitest' must not be treated as 'vite'
    const app: AppConfig = { name: "test-runner", devCommand: "vitest" };
    const out = buildDevCommand(app, 5002);
    expect(out.command).toBe("vitest");
    expect(out.env).toEqual({ PORT: "5002" });
  });

  it("preserves existing flags on next commands", () => {
    const app: AppConfig = { name: "web", devCommand: "next dev --turbo --experimental-https" };
    const out = buildDevCommand(app, 5003);
    expect(out.command).toBe("next dev --turbo --experimental-https -p 5003");
  });
});

describe("buildChildEnv — precedence matrix", () => {
  it("file values come through when nothing else overrides", () => {
    const tmp = mkdtempSync(join(tmpdir(), "iterate-env-prec-"));
    try {
      writeFileSync(join(tmp, "a.env"), "A=from-file\n");
      const env = buildChildEnv(
        tmp,
        {
          apps: [],
          packageManager: "npm",
          basePort: 3100,
          daemonPort: 47100,
          maxIterations: 3,
          idleTimeout: 0,
        },
        { name: "x", devCommand: "y", envFiles: ["a.env"] },
        {}
      );
      expect(env.A).toBe("from-file");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("envPassthrough overrides file values", () => {
    const tmp = mkdtempSync(join(tmpdir(), "iterate-env-prec-"));
    try {
      writeFileSync(join(tmp, "a.env"), "SHARED=from-file\n");
      process.env.SHARED = "from-passthrough";
      const env = buildChildEnv(
        tmp,
        {
          apps: [],
          packageManager: "npm",
          basePort: 3100,
          daemonPort: 47100,
          maxIterations: 3,
          idleTimeout: 0,
          envPassthrough: ["SHARED"],
        },
        { name: "x", devCommand: "y", envFiles: ["a.env"] },
        {}
      );
      expect(env.SHARED).toBe("from-passthrough");
      delete process.env.SHARED;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("portEnv overrides envPassthrough and files", () => {
    const tmp = mkdtempSync(join(tmpdir(), "iterate-env-prec-"));
    try {
      writeFileSync(join(tmp, "a.env"), "MY_PORT=from-file\n");
      process.env.MY_PORT = "from-passthrough";
      const env = buildChildEnv(
        tmp,
        {
          apps: [],
          packageManager: "npm",
          basePort: 3100,
          daemonPort: 47100,
          maxIterations: 3,
          idleTimeout: 0,
          envPassthrough: ["MY_PORT"],
        },
        { name: "x", devCommand: "y", envFiles: ["a.env"], portEnvVar: "MY_PORT" },
        { MY_PORT: "3300" }
      );
      expect(env.MY_PORT).toBe("3300");
      delete process.env.MY_PORT;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("absolute paths in envFiles are honored even when repoRoot is unrelated", () => {
    const tmp = mkdtempSync(join(tmpdir(), "iterate-env-prec-"));
    try {
      const abs = resolve(tmp, "absolute.env");
      writeFileSync(abs, "ABS=1\n");
      const env = buildChildEnv(
        "/somewhere/else",
        {
          apps: [],
          packageManager: "npm",
          basePort: 3100,
          daemonPort: 47100,
          maxIterations: 3,
          idleTimeout: 0,
        },
        { name: "x", devCommand: "y", envFiles: [abs] },
        {}
      );
      expect(env.ABS).toBe("1");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
