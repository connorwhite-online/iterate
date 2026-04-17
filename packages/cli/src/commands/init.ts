import { Command } from "commander";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_CONFIG,
  normalizeConfig,
  type AppConfig,
  type IterateConfig,
} from "iterate-ui-core";
import { saveConfig, loadConfig } from "iterate-ui-core/node";

export const initCommand = new Command("init")
  .description("Initialize iterate in the current project")
  .option("--dev-command <cmd>", "Dev server command (auto-detected if omitted)")
  .option("--app-name <name>", "Name of the app to register (default: \"app\")")
  .option("--app-dir <path>", "Subdirectory of this repo where the app lives (for monorepos)")
  .option("--port-env-var <var>", "Env var the dev script reads for its port (e.g., BRAND_ADMIN_PORT)")
  .option("--env-file <path>", "Dotenv file to source into the dev server (repeatable)", collect, [])
  .option("--base-path <path>", "App's basePath (Next) or base (Vite), e.g. /admin")
  .option("--port <port>", "Starting daemon port (auto-picks upward from here)")
  .action(async (opts) => {
    const cwd = process.cwd();

    // Check we're in a git repo (supports monorepos where .git is in a parent)
    try {
      execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "ignore" });
    } catch {
      console.error("Error: not a git repository. Run `git init` first.");
      process.exit(1);
    }

    const iterateDir = join(cwd, ".iterate");
    let existing;
    try {
      existing = loadConfig(cwd);
    } catch (err) {
      console.error(
        `Error: failed to parse existing .iterate/config.json — ${(err as Error).message}`
      );
      console.error(
        "Fix or delete the file, then re-run `iterate init`."
      );
      process.exit(1);
    }

    // Detect package manager
    const packageManager = detectPackageManager(cwd);

    // Detect dev command (only used when not already registered or supplied)
    const rootPkgDir = opts.appDir ? join(cwd, opts.appDir) : cwd;
    const devCommand = opts.devCommand ?? detectDevCommand(rootPkgDir, packageManager);

    const appEntry: AppConfig = {
      name: opts.appName ?? "app",
      devCommand,
      ...(opts.appDir ? { appDir: opts.appDir } : {}),
      ...(opts.portEnvVar ? { portEnvVar: opts.portEnvVar } : {}),
      ...(opts.envFile && opts.envFile.length > 0 ? { envFiles: opts.envFile } : {}),
      ...(opts.basePath ? { basePath: opts.basePath } : {}),
    };

    let config: IterateConfig;
    if (existing) {
      // Merge: add or replace the app entry of the same name
      const apps = [...existing.apps];
      const idx = apps.findIndex((a) => a.name === appEntry.name);
      if (idx === -1) apps.push(appEntry);
      else apps[idx] = { ...apps[idx], ...appEntry };

      config = normalizeConfig({
        ...existing,
        apps,
        packageManager: existing.packageManager ?? packageManager,
        daemonPort: opts.port ? parseInt(opts.port, 10) : existing.daemonPort,
      });
    } else {
      config = normalizeConfig({
        ...DEFAULT_CONFIG,
        apps: [appEntry],
        packageManager,
        daemonPort: opts.port ? parseInt(opts.port, 10) : DEFAULT_CONFIG.daemonPort,
      });
    }

    mkdirSync(iterateDir, { recursive: true });
    saveConfig(cwd, config);

    // Generate / patch .mcp.json for Claude Code integration. The port is
    // intentionally omitted — the MCP server auto-discovers via
    // .iterate/daemon.lock, so the config stays correct when the daemon
    // auto-picks a different port.
    const iterateMcpEntry = {
      command: "npx",
      args: ["iterate-ui-mcp"],
    };
    const mcpPath = join(cwd, ".mcp.json");
    if (!existsSync(mcpPath)) {
      writeFileSync(
        mcpPath,
        JSON.stringify({ mcpServers: { iterate: iterateMcpEntry } }, null, 2) + "\n"
      );
      console.log("Created .mcp.json for Claude Code integration.");
    } else {
      // Patch existing .mcp.json: add the iterate server if missing, or replace
      // a stale entry (older versions pinned ITERATE_DAEMON_PORT: 4000, which
      // breaks auto-port discovery).
      try {
        const raw = JSON.parse(readFileSync(mcpPath, "utf-8"));
        const servers = (raw.mcpServers ?? {}) as Record<string, unknown>;
        const existingIterate = servers.iterate as Record<string, unknown> | undefined;
        const hasStaleEnv =
          existingIterate && typeof existingIterate.env === "object" && existingIterate.env !== null;
        if (!existingIterate || hasStaleEnv) {
          raw.mcpServers = { ...servers, iterate: iterateMcpEntry };
          writeFileSync(mcpPath, JSON.stringify(raw, null, 2) + "\n");
          console.log(
            existingIterate
              ? "Patched .mcp.json: removed the hardcoded ITERATE_DAEMON_PORT (auto-discovery via lockfile)."
              : "Patched .mcp.json: added the iterate MCP server entry."
          );
        }
      } catch {
        console.log("Note: .mcp.json exists but couldn't be parsed — add the iterate MCP server manually.");
      }
    }

    // Register Claude Code plugin via .claude/settings.json
    const claudeDir = join(cwd, ".claude");
    const claudeSettingsPath = join(claudeDir, "settings.json");
    mkdirSync(claudeDir, { recursive: true });

    let claudeSettings: Record<string, unknown> = {};
    if (existsSync(claudeSettingsPath)) {
      try {
        claudeSettings = JSON.parse(readFileSync(claudeSettingsPath, "utf-8"));
      } catch {
        // Start fresh on parse error
      }
    }

    let settingsModified = false;

    if (!claudeSettings.extraKnownMarketplaces || typeof claudeSettings.extraKnownMarketplaces !== "object") {
      claudeSettings.extraKnownMarketplaces = {};
    }
    const marketplaces = claudeSettings.extraKnownMarketplaces as Record<string, unknown>;
    if (!marketplaces["iterate-plugins"]) {
      marketplaces["iterate-plugins"] = {
        source: {
          source: "github",
          repo: "connorwhite-online/iterate",
        },
      };
      settingsModified = true;
    }

    if (!claudeSettings.enabledPlugins || typeof claudeSettings.enabledPlugins !== "object") {
      claudeSettings.enabledPlugins = {};
    }
    const plugins = claudeSettings.enabledPlugins as Record<string, unknown>;
    if (!("iterate@iterate-plugins" in plugins)) {
      plugins["iterate@iterate-plugins"] = true;
      settingsModified = true;
    }

    if (settingsModified) {
      writeFileSync(claudeSettingsPath, JSON.stringify(claudeSettings, null, 2) + "\n");
      console.log("Registered iterate plugin in .claude/settings.json.");
    }

    // Ensure .iterate is in .gitignore
    const gitignorePath = join(cwd, ".gitignore");
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, "utf-8");
      if (!content.split("\n").some((line) => line.trim() === ".iterate")) {
        writeFileSync(gitignorePath, content.trimEnd() + "\n.iterate\n");
        console.log("Added .iterate to .gitignore.");
      }
    } else {
      writeFileSync(gitignorePath, ".iterate\n");
      console.log("Created .gitignore with .iterate entry.");
    }

    console.log("\nInitialized iterate:");
    console.log(`  Package manager: ${config.packageManager}`);
    console.log(`  Registered apps: ${config.apps.map((a) => a.name).join(", ")}`);
    for (const a of config.apps) {
      console.log(`    - ${a.name}: ${a.devCommand}${a.appDir ? ` (in ${a.appDir})` : ""}`);
    }
    console.log(`  Daemon port (starting point): ${config.daemonPort}`);
    console.log(`  Max iterations: ${config.maxIterations}`);
    console.log(`\nRun \`iterate doctor\` to verify setup, then \`iterate serve\` to start the daemon.`);
    console.log(`Slash commands: /iterate:go, /iterate:prompt, /iterate:keep`);
    console.log(`Restart Claude Code to activate slash commands.`);
  });

function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

function detectPackageManager(cwd: string): IterateConfig["packageManager"] {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock")))
    return "bun";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}

function detectDevCommand(
  cwd: string,
  pm: IterateConfig["packageManager"]
): string {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return `${pm} run dev`;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const scripts = pkg.scripts ?? {};

    // Prefer "dev" script, fallback to "start"
    if (scripts.dev) return `${pm} run dev`;
    if (scripts.start) return `${pm} run start`;
  } catch {
    // Ignore parse errors
  }

  return `${pm} run dev`;
}
