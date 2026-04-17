import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync, execFileSync } from "node:child_process";

const CLI_BIN = join(__dirname, "..", "..", "dist", "index.js");

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "iterate-init-"));
  execSync("git init -q", { cwd: tmp });
  writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "example", scripts: { dev: "next dev" } }));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function runIterate(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("node", [CLI_BIN, ...args], { cwd: tmp, encoding: "utf-8" });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; status?: number; message: string };
    return { stdout: e.stdout ?? e.message, status: e.status ?? 1 };
  }
}

function readConfig(): any {
  return JSON.parse(readFileSync(join(tmp, ".iterate", "config.json"), "utf-8"));
}

describe("iterate init — greenfield", () => {
  it("creates a config with a single 'app' entry from the detected dev script", () => {
    const { status } = runIterate(["init"]);
    expect(status).toBe(0);
    const config = readConfig();
    expect(config.apps).toHaveLength(1);
    expect(config.apps[0].name).toBe("app");
    expect(config.apps[0].devCommand).toBe("npm run dev");
    // pnpm/yarn/bun lockfiles are absent, so packageManager defaults to npm
    expect(config.packageManager).toBe("npm");
  });

  it("uses pnpm when pnpm-lock.yaml exists", () => {
    writeFileSync(join(tmp, "pnpm-lock.yaml"), "");
    const { status } = runIterate(["init"]);
    expect(status).toBe(0);
    expect(readConfig().packageManager).toBe("pnpm");
  });

  it("uses yarn when yarn.lock exists", () => {
    writeFileSync(join(tmp, "yarn.lock"), "");
    const { status } = runIterate(["init"]);
    expect(status).toBe(0);
    expect(readConfig().packageManager).toBe("yarn");
  });

  it("uses bun when bun.lock exists", () => {
    writeFileSync(join(tmp, "bun.lock"), "");
    const { status } = runIterate(["init"]);
    expect(status).toBe(0);
    expect(readConfig().packageManager).toBe("bun");
  });

  it("accepts --dev-command override", () => {
    const { status } = runIterate(["init", "--dev-command", "pnpm exec vite --host"]);
    expect(status).toBe(0);
    expect(readConfig().apps[0].devCommand).toBe("pnpm exec vite --host");
  });

  it("accepts --port to set the starting daemon port", () => {
    const { status } = runIterate(["init", "--port", "48000"]);
    expect(status).toBe(0);
    expect(readConfig().daemonPort).toBe(48000);
  });

  it("creates .mcp.json and .claude/settings.json", () => {
    runIterate(["init"]);
    expect(existsSync(join(tmp, ".mcp.json"))).toBe(true);
    expect(existsSync(join(tmp, ".claude", "settings.json"))).toBe(true);
    const mcp = JSON.parse(readFileSync(join(tmp, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers.iterate).toBeDefined();
    // We no longer pin ITERATE_DAEMON_PORT — the MCP auto-discovers via lockfile.
    expect(mcp.mcpServers.iterate.env).toBeUndefined();
  });

  it("adds .iterate to .gitignore if missing", () => {
    runIterate(["init"]);
    const gi = readFileSync(join(tmp, ".gitignore"), "utf-8");
    expect(gi).toContain(".iterate");
  });
});

describe("iterate init — multi-app", () => {
  it("registers an app with all custom fields set", () => {
    mkdirSync(join(tmp, "apps", "brand-admin"), { recursive: true });
    writeFileSync(
      join(tmp, "apps", "brand-admin", "package.json"),
      JSON.stringify({ scripts: { dev: "env-cmd.ts --dev -- pnpm next dev" } })
    );
    writeFileSync(join(tmp, ".env.development.pre"), "BRAND_ADMIN_PORT=4055\n");

    const { status } = runIterate([
      "init",
      "--app-name",
      "brand-admin",
      "--app-dir",
      "apps/brand-admin",
      "--dev-command",
      "PORT=$BRAND_ADMIN_PORT env-cmd.ts --dev -- pnpm next dev",
      "--port-env-var",
      "BRAND_ADMIN_PORT",
      "--env-file",
      ".env.development.pre",
      "--base-path",
      "/admin",
    ]);
    expect(status).toBe(0);

    const config = readConfig();
    expect(config.apps).toHaveLength(1);
    expect(config.apps[0]).toEqual({
      name: "brand-admin",
      devCommand: "PORT=$BRAND_ADMIN_PORT env-cmd.ts --dev -- pnpm next dev",
      appDir: "apps/brand-admin",
      portEnvVar: "BRAND_ADMIN_PORT",
      envFiles: [".env.development.pre"],
      basePath: "/admin",
    });
  });

  it("merges a second app into an existing config (appends to apps[])", () => {
    runIterate(["init", "--app-name", "web"]);
    const { status } = runIterate([
      "init",
      "--app-name",
      "admin",
      "--dev-command",
      "vite",
    ]);
    expect(status).toBe(0);
    const config = readConfig();
    expect(config.apps.map((a: { name: string }) => a.name)).toEqual(["web", "admin"]);
    expect(config.apps[1].devCommand).toBe("vite");
  });

  it("replaces the app entry when re-registering with the same name", () => {
    runIterate(["init", "--app-name", "web", "--dev-command", "next dev"]);
    runIterate(["init", "--app-name", "web", "--dev-command", "next dev --turbo"]);
    const config = readConfig();
    expect(config.apps).toHaveLength(1);
    expect(config.apps[0].devCommand).toBe("next dev --turbo");
  });

  it("accepts multiple --env-file flags", () => {
    writeFileSync(join(tmp, ".env.dev"), "A=1\n");
    writeFileSync(join(tmp, ".env.local"), "B=2\n");
    runIterate([
      "init",
      "--app-name",
      "web",
      "--env-file",
      ".env.dev",
      "--env-file",
      ".env.local",
    ]);
    const config = readConfig();
    expect(config.apps[0].envFiles).toEqual([".env.dev", ".env.local"]);
  });
});

describe("iterate init — failure modes", () => {
  it("exits non-zero when not in a git repo", () => {
    const noGit = mkdtempSync(join(tmpdir(), "iterate-no-git-"));
    writeFileSync(join(noGit, "package.json"), "{}");
    try {
      let status = 0;
      try {
        execFileSync("node", [CLI_BIN, "init"], { cwd: noGit, stdio: "pipe" });
      } catch (err) {
        const e = err as { status?: number };
        status = e.status ?? 1;
      }
      expect(status).not.toBe(0);
    } finally {
      rmSync(noGit, { recursive: true, force: true });
    }
  });
});
