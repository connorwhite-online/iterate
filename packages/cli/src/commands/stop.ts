import { Command } from "commander";
import { loadConfig, resolveDaemonPort, removeLockfile } from "iterate-ui-core/node";
import { fetchWithTimeout, resolveRepoRoot } from "../http-utils.js";

export const stopCommand = new Command("stop")
  .description("Stop the iterate daemon and all dev servers")
  .action(async () => {
    const cwd = resolveRepoRoot();
    const config = loadConfig(cwd);
    if (!config) {
      console.error("Error: iterate not initialized. Run `iterate init` first.");
      process.exit(1);
    }
    const port = resolveDaemonPort(cwd, config);

    try {
      const res = await fetchWithTimeout(`http://localhost:${port}/api/shutdown`, {
        method: "POST",
        timeoutMs: 5000,
      });

      if (res.ok) {
        console.log("iterate daemon stopped. All dev servers terminated.");
      } else {
        console.error("Error: failed to stop daemon.");
        process.exit(1);
      }
    } catch {
      console.error("Daemon is not running.");
      // Clean up any stale lockfile so subsequent commands don't get confused.
      removeLockfile(cwd);
    }
  });
