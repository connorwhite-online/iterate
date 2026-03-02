import { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG, type IterateConfig } from "iterate-ui-core";

export const initCommand = new Command("init")
  .description("Initialize iterate in the current project")
  .option("--dev-command <cmd>", "Dev server command (auto-detected if omitted)")
  .option("--port <port>", "Daemon port", "4000")
  .action(async (opts) => {
    const cwd = process.cwd();

    // Check we're in a git repo
    if (!existsSync(join(cwd, ".git"))) {
      console.error("Error: not a git repository. Run `git init` first.");
      process.exit(1);
    }

    // Check for existing .iterate/
    const iterateDir = join(cwd, ".iterate");
    if (existsSync(iterateDir)) {
      console.log("iterate is already initialized in this project.");
      return;
    }

    // Detect package manager
    const packageManager = detectPackageManager(cwd);

    // Detect dev command
    const devCommand = opts.devCommand ?? detectDevCommand(cwd, packageManager);

    const config: IterateConfig = {
      ...DEFAULT_CONFIG,
      devCommand,
      packageManager,
      daemonPort: parseInt(opts.port, 10),
    };

    // Create .iterate directory and config
    mkdirSync(iterateDir, { recursive: true });
    writeFileSync(
      join(iterateDir, "config.json"),
      JSON.stringify(config, null, 2)
    );

    // Generate .mcp.json for Claude Code integration
    const mcpPath = join(cwd, ".mcp.json");
    if (!existsSync(mcpPath)) {
      const mcpConfig = {
        mcpServers: {
          iterate: {
            command: "npx",
            args: ["iterate-mcp"],
            env: {
              ITERATE_DAEMON_PORT: String(config.daemonPort),
            },
          },
        },
      };
      writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + "\n");
      console.log("Created .mcp.json for Claude Code integration.");
    } else {
      console.log("Note: .mcp.json already exists — add the iterate MCP server manually if needed.");
    }

    console.log("\nInitialized iterate:");
    console.log(`  Package manager: ${config.packageManager}`);
    console.log(`  Dev command: ${config.devCommand}`);
    console.log(`  Daemon port: ${config.daemonPort}`);
    console.log(`  Max iterations: ${config.maxIterations}`);
    console.log(`\nRun \`iterate serve\` to start the control server.`);
    console.log(`Claude Code slash commands: /iterate:go, /iterate:prompt, /iterate:keep`);
  });

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
