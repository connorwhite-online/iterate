import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { IterateConfig } from "iterate-ui-core";

export const branchCommand = new Command("branch")
  .description("Create a new iteration from the current branch")
  .argument("<name>", "Name for the new iteration")
  .option("--from <branch>", "Base branch to fork from (default: current branch)")
  .action(async (name: string, opts) => {
    const cwd = process.cwd();
    const config = loadConfig(cwd);
    if (!config) return;

    // Call the daemon API to create the iteration
    const daemonUrl = `http://localhost:${config.daemonPort}`;

    try {
      const res = await fetch(`${daemonUrl}/api/iterations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, baseBranch: opts.from }),
      });

      if (!res.ok) {
        const err = await res.json();
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }

      const iteration = await res.json();
      console.log(`Created iteration "${name}":`);
      console.log(`  Branch: ${iteration.branch}`);
      console.log(`  Port: ${iteration.port}`);
      console.log(`  Worktree: ${iteration.worktreePath}`);
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
    console.error(
      "Error: iterate not initialized. Run `iterate init` first."
    );
    process.exit(1);
  }
  return JSON.parse(readFileSync(configPath, "utf-8"));
}
