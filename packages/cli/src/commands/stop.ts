import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { IterateConfig } from "@iterate/core";

export const stopCommand = new Command("stop")
  .description("Stop the iterate daemon and all dev servers")
  .action(async () => {
    const cwd = process.cwd();
    const config = loadConfig(cwd);
    if (!config) return;

    try {
      const res = await fetch(
        `http://localhost:${config.daemonPort}/api/shutdown`,
        { method: "POST" }
      );

      if (res.ok) {
        console.log("iterate daemon stopped. All dev servers terminated.");
      } else {
        console.error("Error: failed to stop daemon.");
        process.exit(1);
      }
    } catch {
      console.error("Daemon is not running.");
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
