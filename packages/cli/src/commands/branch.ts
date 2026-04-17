import { Command } from "commander";
import { loadConfig, resolveDaemonPort } from "iterate-ui-core/node";

export const branchCommand = new Command("branch")
  .description("Create a new iteration from the current branch")
  .argument("<name>", "Name for the new iteration")
  .option("--from <branch>", "Base branch to fork from (default: current branch)")
  .option("--app <name>", "Registered app this iteration targets (required when multiple apps are configured)")
  .action(async (name: string, opts) => {
    const cwd = process.cwd();
    const config = loadConfig(cwd);
    if (!config) {
      console.error("Error: iterate not initialized. Run `iterate init` first.");
      process.exit(1);
    }

    // If there's only one app configured and the caller didn't pass --app,
    // the daemon will pick the single app by default. For multi-app repos we
    // fail fast with a helpful message rather than letting the daemon 400.
    if (!opts.app && config.apps.length > 1) {
      console.error(
        `Error: this repo has ${config.apps.length} apps configured (${config.apps.map((a) => a.name).join(", ")}). ` +
          `Pass --app <name> to pick which one to iterate on.`
      );
      process.exit(1);
    }

    const port = resolveDaemonPort(cwd, config);
    const daemonUrl = `http://localhost:${port}`;

    try {
      const res = await fetch(`${daemonUrl}/api/iterations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, baseBranch: opts.from, appName: opts.app }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({ message: "Unknown error" }))) as { message?: string };
        console.error(`Error: ${err.message ?? "Unknown error"}`);
        process.exit(1);
      }

      const iteration = await res.json();
      console.log(`Created iteration "${name}":`);
      console.log(`  Branch: ${iteration.branch}`);
      console.log(`  App: ${iteration.appName ?? "(default)"}`);
      console.log(`  Port: ${iteration.port}`);
      console.log(`  Worktree: ${iteration.worktreePath}`);
    } catch {
      console.error(
        "Error: cannot connect to iterate daemon. Run `iterate serve` first."
      );
      process.exit(1);
    }
  });
