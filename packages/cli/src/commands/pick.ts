import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { IterateConfig } from "@iterate/core";

export const pickCommand = new Command("pick")
  .description(
    "Pick a winning iteration — merges it to base and removes all others"
  )
  .argument("<name>", "Name of the iteration to keep")
  .option(
    "--strategy <strategy>",
    "Merge strategy: merge, squash, or rebase",
    "merge"
  )
  .action(async (name: string, opts) => {
    const cwd = process.cwd();
    const config = loadConfig(cwd);
    if (!config) return;

    try {
      const res = await fetch(
        `http://localhost:${config.daemonPort}/api/iterations/pick`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, strategy: opts.strategy }),
        }
      );

      if (!res.ok) {
        const err = await res.json();
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }

      console.log(`Picked iteration "${name}".`);
      console.log("  Branch merged to base, other iterations removed.");
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
