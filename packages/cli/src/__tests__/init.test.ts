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
import { execSync, execFileSync, spawnSync } from "node:child_process";

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

function runIterate(args: string[]): { stdout: string; stderr: string; status: number } {
  // spawnSync captures stderr on success AND failure (execFileSync only on failure).
  const res = spawnSync("node", [CLI_BIN, ...args], { cwd: tmp, encoding: "utf-8" });
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    status: res.status ?? 1,
  };
}
// Keep execFileSync referenced for the not-in-git-repo test path.
void execFileSync;

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

  it("adds the iterate server to an existing .mcp.json that doesn't have it", () => {
    writeFileSync(
      join(tmp, ".mcp.json"),
      JSON.stringify({ mcpServers: { otherServer: { command: "foo" } } })
    );
    runIterate(["init"]);
    const mcp = JSON.parse(readFileSync(join(tmp, ".mcp.json"), "utf-8"));
    // Both servers present
    expect(mcp.mcpServers.iterate).toBeDefined();
    expect(mcp.mcpServers.otherServer).toBeDefined();
    expect(mcp.mcpServers.iterate.env).toBeUndefined();
  });

  it("patches a stale .mcp.json that still pins ITERATE_DAEMON_PORT", () => {
    writeFileSync(
      join(tmp, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          iterate: {
            command: "npx",
            args: ["iterate-ui-mcp"],
            env: { ITERATE_DAEMON_PORT: "4000" },
          },
        },
      })
    );
    runIterate(["init"]);
    const mcp = JSON.parse(readFileSync(join(tmp, ".mcp.json"), "utf-8"));
    // Stale env block gone; auto-discovery via lockfile takes over
    expect(mcp.mcpServers.iterate.env).toBeUndefined();
  });

  it("leaves a correctly-configured .mcp.json untouched on re-init", () => {
    runIterate(["init"]);
    const firstMcp = readFileSync(join(tmp, ".mcp.json"), "utf-8");
    runIterate(["init"]);
    const secondMcp = readFileSync(join(tmp, ".mcp.json"), "utf-8");
    expect(secondMcp).toBe(firstMcp);
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

  it("writes config to the repo root even when run from a subdirectory", () => {
    mkdirSync(join(tmp, "apps", "web"), { recursive: true });
    writeFileSync(
      join(tmp, "apps", "web", "package.json"),
      JSON.stringify({ scripts: { dev: "next dev" } })
    );
    // Run iterate from the subdirectory.
    const subdir = join(tmp, "apps", "web");
    const { status, stdout } = (() => {
      const res = spawnSync("node", [CLI_BIN, "init"], {
        cwd: subdir,
        encoding: "utf-8",
      });
      return { status: res.status ?? 1, stdout: res.stdout ?? "" };
    })();
    expect(status).toBe(0);
    expect(stdout).toMatch(/writing config to the repo root/i);
    // Config lives at the repo root, not the subdirectory.
    expect(existsSync(join(tmp, ".iterate", "config.json"))).toBe(true);
    expect(existsSync(join(subdir, ".iterate", "config.json"))).toBe(false);
  });

  it("rewrites --app-dir relative to the repo root when run from a subdirectory", () => {
    mkdirSync(join(tmp, "apps", "web"), { recursive: true });
    writeFileSync(
      join(tmp, "apps", "web", "package.json"),
      JSON.stringify({ scripts: { dev: "next dev" } })
    );
    const subdir = join(tmp, "apps", "web");
    // Run from the app subdir with --app-dir "." (meaning "here")
    const res = spawnSync("node", [CLI_BIN, "init", "--app-name", "web", "--app-dir", "."], {
      cwd: subdir,
      encoding: "utf-8",
    });
    expect(res.status).toBe(0);
    const config = JSON.parse(readFileSync(join(tmp, ".iterate", "config.json"), "utf-8"));
    // The "." should have been rewritten to "apps/web"
    expect(config.apps[0].appDir).toBe("apps/web");
  });

  it("fails when --app-name contains invalid characters", () => {
    const { stdout, stderr, status } = runIterate(["init", "--app-name", "has spaces"]);
    expect(status).not.toBe(0);
    const combined = stdout + stderr;
    expect(combined).toMatch(/app-name must be alphanumeric/);
  });

  it("accepts alphanumeric app-name with hyphens and underscores", () => {
    const { status } = runIterate(["init", "--app-name", "brand_admin-v2"]);
    expect(status).toBe(0);
    const config = JSON.parse(readFileSync(join(tmp, ".iterate", "config.json"), "utf-8"));
    expect(config.apps[0].name).toBe("brand_admin-v2");
  });

  it("fails clearly when an existing .iterate/config.json is malformed", () => {
    // tmp already has `git init`. Add a broken config.
    mkdirSync(join(tmp, ".iterate"));
    writeFileSync(join(tmp, ".iterate", "config.json"), "{ this is not json ");
    const { stdout, stderr, status } = (() => {
      try {
        const out = execFileSync("node", [CLI_BIN, "init"], {
          cwd: tmp,
          encoding: "utf-8",
        });
        return { stdout: out, stderr: "", status: 0 };
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; status?: number; message?: string };
        return {
          stdout: e.stdout ?? "",
          stderr: e.stderr ?? e.message ?? "",
          status: e.status ?? 1,
        };
      }
    })();
    expect(status).not.toBe(0);
    const combined = stdout + stderr;
    expect(combined).toMatch(/failed to parse/i);
    expect(combined).toMatch(/\.iterate\/config\.json/);
  });
});
