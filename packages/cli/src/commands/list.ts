import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { IterateConfig, IterationInfo } from "iterate-ui-core";

export const listCommand = new Command("list")
  .description("List all active iterations")
  .action(async () => {
    const cwd = process.cwd();
    const config = loadConfig(cwd);
    if (!config) return;

    try {
      const res = await fetch(
        `http://localhost:${config.daemonPort}/api/iterations`
      );
      const iterations: Record<string, IterationInfo> = await res.json();
      const entries = Object.values(iterations);

      if (entries.length === 0) {
        console.log("No active iterations. Run `iterate branch <name>` to create one.");
        return;
      }

      console.log("Active iterations:\n");
      for (const it of entries) {
        const status =
          it.status === "ready" ? "\x1b[32m●\x1b[0m" : "\x1b[33m○\x1b[0m";
        console.log(
          `  ${status} ${it.name} (branch: ${it.branch}, port: ${it.port}, status: ${it.status})`
        );
      }
    } catch {
      console.error(
        "Error: cannot connect to iterate daemon. Run `iterate serve` first."
      );
      process.exit(1);
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
