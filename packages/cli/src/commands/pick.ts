import { Command } from "commander";
import { loadConfig, resolveDaemonPort } from "iterate-ui-core/node";
import { fetchWithTimeout, parseJsonSafe, resolveRepoRoot } from "../http-utils.js";

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
    const cwd = resolveRepoRoot();
    const config = loadConfig(cwd);
    if (!config) {
      console.error("Error: iterate not initialized. Run `iterate init` first.");
      process.exit(1);
    }

    const port = resolveDaemonPort(cwd, config);

    try {
      // Picking triggers a merge + worktree cleanup; can take a bit on large repos.
      const res = await fetchWithTimeout(`http://localhost:${port}/api/iterations/pick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, strategy: opts.strategy }),
        timeoutMs: 60_000,
      });

      if (!res.ok) {
        const err = (await parseJsonSafe<{ message?: string }>(res)) ?? { message: "Unknown error" };
        console.error(`Error: ${err.message ?? "Unknown error"}`);
        process.exit(1);
      }

      console.log(`Picked iteration "${name}".`);
      console.log("  Branch merged to base, other iterations removed.");
    } catch (err) {
      const timedOut = (err as Error).name === "AbortError";
      const prefix = timedOut
        ? `Error: request to iterate daemon on port ${port} timed out.`
        : `Error: cannot connect to iterate daemon on port ${port}.`;
      console.error(`${prefix} Run \`iterate serve\` first.`);
      process.exit(1);
    }
  });
