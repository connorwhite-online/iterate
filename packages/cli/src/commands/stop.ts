import { Command } from "commander";
import { loadConfig, resolveDaemonPort, removeLockfile } from "iterate-ui-core/node";

export const stopCommand = new Command("stop")
  .description("Stop the iterate daemon and all dev servers")
  .action(async () => {
    const cwd = process.cwd();
    const config = loadConfig(cwd);
    if (!config) {
      console.error("Error: iterate not initialized. Run `iterate init` first.");
      process.exit(1);
    }
    const port = resolveDaemonPort(cwd, config);

    try {
      const res = await fetch(`http://localhost:${port}/api/shutdown`, { method: "POST" });

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
