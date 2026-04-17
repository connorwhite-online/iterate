import { Command } from "commander";
import { loadConfig, resolveDaemonPort } from "iterate-ui-core/node";

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
    if (!config) {
      console.error("Error: iterate not initialized. Run `iterate init` first.");
      process.exit(1);
    }

    const port = resolveDaemonPort(cwd, config);

    try {
      const res = await fetch(`http://localhost:${port}/api/iterations/pick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, strategy: opts.strategy }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({ message: "Unknown error" }))) as { message?: string };
        console.error(`Error: ${err.message ?? "Unknown error"}`);
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
