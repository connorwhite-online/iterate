import { Command } from "commander";
import { loadConfig, resolveDaemonPort } from "iterate-ui-core/node";
import { fetchWithTimeout, parseJsonSafe, resolveRepoRoot } from "../fetch-with-timeout.js";

export const branchCommand = new Command("branch")
  .description("Create a new iteration from the current branch")
  .argument("<name>", "Name for the new iteration")
  .option("--from <branch>", "Base branch to fork from (default: current branch)")
  .option("--app <name>", "Registered app this iteration targets (required when multiple apps are configured)")
  .action(async (name: string, opts) => {
    const cwd = resolveRepoRoot();
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
      // Creating an iteration triggers pnpm install + dev server startup,
      // which can easily take a minute in a big monorepo. Use a generous
      // timeout rather than the default.
      const res = await fetchWithTimeout(`${daemonUrl}/api/iterations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, baseBranch: opts.from, appName: opts.app }),
        timeoutMs: 300_000,
      });

      if (!res.ok) {
        const err = (await parseJsonSafe<{ message?: string }>(res)) ?? { message: "Unknown error" };
        console.error(`Error: ${err.message ?? "Unknown error"}`);
        process.exit(1);
      }

      const iteration = (await parseJsonSafe<{
        branch?: string;
        appName?: string;
        port?: number;
        worktreePath?: string;
      }>(res)) ?? {};
      console.log(`Created iteration "${name}":`);
      console.log(`  Branch: ${iteration.branch ?? "(unknown)"}`);
      console.log(`  App: ${iteration.appName ?? "(default)"}`);
      console.log(`  Port: ${iteration.port ?? "(pending)"}`);
      console.log(`  Worktree: ${iteration.worktreePath ?? "(pending)"}`);
    } catch (err) {
      const timedOut = (err as Error).name === "AbortError";
      const prefix = timedOut
        ? `Error: request to iterate daemon on port ${port} timed out.`
        : `Error: cannot connect to iterate daemon on port ${port}.`;
      console.error(`${prefix} Run \`iterate serve\` first.`);
      process.exit(1);
    }
  });
