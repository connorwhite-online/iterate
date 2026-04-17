import { Command } from "commander";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { loadConfig, readLockfile, isDaemonAlive } from "iterate-ui-core/node";
import { resolveRepoRoot } from "../fetch-with-timeout.js";

export const serveCommand = new Command("serve")
  .description("Start the iterate daemon (control server + proxy)")
  .option("--port <port>", "Override daemon port (skips auto-pick)")
  .action(async (opts) => {
    const cwd = resolveRepoRoot();
    const config = loadConfig(cwd);
    if (!config) {
      console.error("Error: iterate not initialized. Run `iterate init` first.");
      process.exit(1);
    }

    // If a daemon is already running in this repo, short-circuit with a useful message.
    const existingLock = readLockfile(cwd);
    if (existingLock && isDaemonAlive(existingLock)) {
      console.log(
        `iterate daemon already running on port ${existingLock.port} (pid ${existingLock.pid}). ` +
          `Run \`iterate stop\` first to restart.`
      );
      return;
    }

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ITERATE_CWD: cwd,
    };
    // Explicit --port overrides auto-pick. Otherwise the daemon auto-picks starting
    // from config.daemonPort and writes the resolved port to .iterate/daemon.lock.
    if (opts.port) {
      env.ITERATE_PORT = String(parseInt(opts.port, 10));
      console.log(`Starting iterate daemon on port ${opts.port}...\n`);
    } else {
      console.log(
        `Starting iterate daemon (auto-picking port from ${config.daemonPort})...\n`
      );
    }

    // Spawn the daemon process
    const daemonBin = join(cwd, "node_modules", "iterate-ui-daemon", "dist", "index.js");

    if (existsSync(daemonBin)) {
      const child = spawn("node", [daemonBin], {
        cwd,
        env,
        stdio: "inherit",
      });

      child.on("error", (err) => {
        console.error(`Failed to start daemon: ${err.message}`);
        process.exit(1);
      });
    } else {
      // Fallback: try to import and run daemon directly
      try {
        // @ts-expect-error — optional peer; only resolved when installed alongside daemon
        const { startDaemon } = await import("iterate-ui-daemon");
        await startDaemon({
          cwd,
          port: opts.port ? parseInt(opts.port, 10) : undefined,
        });
      } catch {
        console.error(
          "Error: iterate-ui-daemon not found. Run `pnpm install` first."
        );
        process.exit(1);
      }
    }
  });
