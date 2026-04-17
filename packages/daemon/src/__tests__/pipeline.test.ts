import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AppConfig, IterateConfig } from "iterate-ui-core";
import {
  buildDevCommand,
  getInstallCommand,
  buildChildEnv,
  resolveAppCwd,
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
});
