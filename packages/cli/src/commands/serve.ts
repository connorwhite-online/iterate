import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { IterateConfig } from "@iterate/core";

export const serveCommand = new Command("serve")
  .description("Start the iterate daemon (control server + proxy)")
  .option("--port <port>", "Override daemon port")
  .action(async (opts) => {
    const cwd = process.cwd();
    const config = loadConfig(cwd);
    if (!config) return;

    const port = opts.port ? parseInt(opts.port, 10) : config.daemonPort;

    console.log(`Starting iterate daemon on port ${port}...`);
    console.log(`Open http://localhost:${port} in your browser.\n`);

    // Spawn the daemon process
    // In development, we run the daemon directly via tsx
    // In production, this would run the built daemon binary
    const daemonBin = join(cwd, "node_modules", "@iterate", "daemon", "dist", "index.js");

    if (existsSync(daemonBin)) {
      const child = spawn("node", [daemonBin], {
        cwd,
        env: {
          ...process.env,
          ITERATE_PORT: String(port),
          ITERATE_CWD: cwd,
        },
        stdio: "inherit",
      });

      child.on("error", (err) => {
        console.error(`Failed to start daemon: ${err.message}`);
        process.exit(1);
      });
    } else {
      // Fallback: try to import and run daemon directly
      try {
        const { startDaemon } = await import("@iterate/daemon");
        await startDaemon({ port, cwd });
      } catch {
        console.error(
          "Error: @iterate/daemon not found. Run `pnpm install` first."
        );
        process.exit(1);
      }
    }
  });

function loadConfig(cwd: string): IterateConfig | null {
  const configPath = join(cwd, ".iterate", "config.json");
  if (!existsSync(configPath)) {
    console.error("Error: iterate not initialized. Run `iterate init` first.");
    process.exit(1);
  }
  return JSON.parse(readFileSync(configPath, "utf-8"));
}
