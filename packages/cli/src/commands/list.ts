import { Command } from "commander";
import type { IterationInfo } from "iterate-ui-core";
import { loadConfig, resolveDaemonPort } from "iterate-ui-core/node";
import { fetchWithTimeout, parseJsonSafe, resolveRepoRoot } from "../fetch-with-timeout.js";

export const listCommand = new Command("list")
  .description("List all active iterations")
  .action(async () => {
    const cwd = resolveRepoRoot();
    const config = loadConfig(cwd);
    if (!config) {
      console.error("Error: iterate not initialized. Run `iterate init` first.");
      process.exit(1);
    }
    const port = resolveDaemonPort(cwd, config);

    try {
      const res = await fetchWithTimeout(`http://localhost:${port}/api/iterations`);
      const iterations = (await parseJsonSafe<Record<string, IterationInfo>>(res)) ?? {};
      const entries = Object.values(iterations);

      if (entries.length === 0) {
        console.log("No active iterations. Run `iterate branch <name>` to create one.");
        return;
      }

      console.log("Active iterations:\n");
      for (const it of entries) {
        const status =
          it.status === "ready" ? "\x1b[32m●\x1b[0m" : "\x1b[33m○\x1b[0m";
        const app = it.appName ? ` app: ${it.appName},` : "";
        console.log(
          `  ${status} ${it.name} (branch: ${it.branch},${app} port: ${it.port}, status: ${it.status})`
        );
      }
    } catch (err) {
      const timedOut = (err as Error).name === "AbortError";
      const prefix = timedOut
        ? `Error: request to iterate daemon on port ${port} timed out.`
        : `Error: cannot connect to iterate daemon on port ${port}.`;
      console.error(`${prefix} Run \`iterate serve\` first.`);
      process.exit(1);
    }
  });
