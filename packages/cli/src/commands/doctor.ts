import { Command } from "commander";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import {
  loadConfig,
  readLockfile,
  isDaemonAlive,
  canBindPort,
  isPortInUse,
  parseDotenv,
} from "iterate-ui-core/node";
import type { AppConfig, IterateConfig } from "iterate-ui-core";

type Status = "ok" | "warn" | "fail";

interface CheckResult {
  status: Status;
  label: string;
  detail?: string;
}

const ICON: Record<Status, string> = { ok: "\x1b[32m✓\x1b[0m", warn: "\x1b[33m!\x1b[0m", fail: "\x1b[31m✗\x1b[0m" };

export const doctorCommand = new Command("doctor")
  .description("Preflight checks for iterate — verify config, ports, env files, and dev scripts")
  .option("--app <name>", "Only check this app (default: all configured apps)")
  .action(async (opts) => {
    const cwd = process.cwd();
    const results: CheckResult[] = [];

    // --- Git repo check ---
    try {
      execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "ignore" });
      results.push({ status: "ok", label: "Inside a git repository" });
    } catch {
      results.push({ status: "fail", label: "Not inside a git repository" });
    }

    // --- Config check ---
    const config = loadConfig(cwd);
    if (!config) {
      results.push({
        status: "fail",
        label: ".iterate/config.json not found",
        detail: "Run `iterate init` to create it.",
      });
      printAndExit(results);
      return;
    }
    results.push({ status: "ok", label: "Loaded .iterate/config.json" });

    if (config.apps.length === 0) {
      results.push({
        status: "fail",
        label: "No apps registered",
        detail: "Run `iterate init` (optionally with --app-name, --app-dir) to register one.",
      });
      printAndExit(results);
      return;
    }
    results.push({
      status: "ok",
      label: `Registered apps (${config.apps.length}): ${config.apps.map((a) => a.name).join(", ")}`,
    });

    // --- Daemon / port check ---
    const lock = readLockfile(cwd);
    if (lock) {
      if (isDaemonAlive(lock)) {
        results.push({
          status: "ok",
          label: `Daemon running on port ${lock.port} (pid ${lock.pid})`,
        });
      } else {
        results.push({
          status: "warn",
          label: "Stale daemon lockfile",
          detail: `PID ${lock.pid} is not alive. Run \`iterate stop\` to clean up, or start fresh with \`iterate serve\`.`,
        });
      }
    } else {
      const startingFree = await canBindPort(config.daemonPort);
      if (startingFree) {
        results.push({
          status: "ok",
          label: `Starting daemon port ${config.daemonPort} is available`,
        });
      } else {
        results.push({
          status: "warn",
          label: `Starting daemon port ${config.daemonPort} is in use`,
          detail: "iterate will auto-pick the next free port above it when the daemon starts.",
        });
      }
    }

    // --- Per-app checks ---
    const apps = opts.app
      ? config.apps.filter((a) => a.name === opts.app)
      : config.apps;

    if (opts.app && apps.length === 0) {
      results.push({
        status: "fail",
        label: `No app named "${opts.app}" in config`,
      });
      printAndExit(results);
      return;
    }

    for (const app of apps) {
      results.push({ status: "ok", label: `— App: ${app.name} —` });
      await checkApp(cwd, config, app, results);
    }

    // --- docker-compose hint (informational only) ---
    if (existsSync(join(cwd, "docker-compose.yaml")) || existsSync(join(cwd, "docker-compose.yml"))) {
      results.push({
        status: "warn",
        label: "docker-compose detected at repo root",
        detail: "iterate doesn't manage these services — make sure they're running if your app depends on them.",
      });
    }

    printAndExit(results);
  });

async function checkApp(cwd: string, config: IterateConfig, app: AppConfig, results: CheckResult[]): Promise<void> {
  // appDir exists
  const appRoot = app.appDir ? (isAbsolute(app.appDir) ? app.appDir : resolve(cwd, app.appDir)) : cwd;
  if (!existsSync(appRoot)) {
    results.push({
      status: "fail",
      label: `  appDir "${app.appDir}" does not exist`,
    });
    return;
  }
  const pkgPath = join(appRoot, "package.json");
  if (!existsSync(pkgPath)) {
    results.push({
      status: "fail",
      label: `  No package.json in ${app.appDir ?? "repo root"}`,
    });
  } else {
    results.push({ status: "ok", label: `  appDir resolves and has package.json` });
  }

  // Dev command sanity
  if (!app.devCommand || app.devCommand.trim() === "") {
    results.push({ status: "fail", label: "  devCommand is empty" });
  } else {
    results.push({ status: "ok", label: `  devCommand: ${app.devCommand}` });
  }

  // portEnvVar sanity
  if (app.portEnvVar) {
    // If the dev command doesn't reference this var, iterate's port won't reach the script.
    const referenced =
      app.devCommand.includes(`$${app.portEnvVar}`) ||
      app.devCommand.includes(`\${${app.portEnvVar}}`) ||
      app.devCommand.includes(`%${app.portEnvVar}%`);
    if (!referenced) {
      // This is informational — some wrappers (env-cmd, dotenv-cli) read the var
      // internally rather than referencing it in the command string.
      results.push({
        status: "warn",
        label: `  portEnvVar "${app.portEnvVar}" not referenced inline in devCommand`,
        detail:
          "Make sure your dev-script wrapper reads it from the environment (env-cmd/dotenv-cli/direnv are fine).",
      });
    } else {
      results.push({
        status: "ok",
        label: `  portEnvVar "${app.portEnvVar}" is set and referenced in devCommand`,
      });
    }
  }

  // envFiles exist and contain something meaningful
  if (app.envFiles && app.envFiles.length > 0) {
    for (const rel of app.envFiles) {
      const full = isAbsolute(rel) ? rel : resolve(cwd, rel);
      if (!existsSync(full)) {
        results.push({
          status: "warn",
          label: `  envFile missing: ${rel}`,
          detail: "It'll be skipped at runtime. Check the path is correct (relative to repo root).",
        });
        continue;
      }
      try {
        const parsed = parseDotenv(readFileSync(full, "utf-8"));
        const n = Object.keys(parsed).length;
        if (n === 0) {
          results.push({ status: "warn", label: `  envFile ${rel} parsed but has no keys` });
        } else {
          const mentionsPortVar =
            app.portEnvVar && Object.prototype.hasOwnProperty.call(parsed, app.portEnvVar);
          results.push({
            status: "ok",
            label: `  envFile ${rel} → ${n} keys${mentionsPortVar ? ` (incl. ${app.portEnvVar})` : ""}`,
          });
        }
      } catch (err) {
        results.push({
          status: "fail",
          label: `  envFile ${rel} failed to parse`,
          detail: (err as Error).message,
        });
      }
    }

    // If portEnvVar is set but not defined in any envFile AND not in process.env, warn
    if (app.portEnvVar && !process.env[app.portEnvVar]) {
      const inAFile = app.envFiles.some((rel) => {
        const full = isAbsolute(rel) ? rel : resolve(cwd, rel);
        if (!existsSync(full)) return false;
        try {
          const parsed = parseDotenv(readFileSync(full, "utf-8"));
          return Object.prototype.hasOwnProperty.call(parsed, app.portEnvVar!);
        } catch {
          return false;
        }
      });
      if (!inAFile) {
        results.push({
          status: "warn",
          label: `  portEnvVar "${app.portEnvVar}" not found in any envFile or the current shell`,
          detail: "iterate sets it per iteration, so this is usually fine — but verify if the dev script needs a default.",
        });
      }
    }
  }

  // basePath plausibility
  if (app.basePath && !app.basePath.startsWith("/")) {
    results.push({
      status: "warn",
      label: `  basePath "${app.basePath}" should start with "/"`,
    });
  }

  // Package manager: verify the configured one (or app override) resolves
  const pm = app.packageManager ?? config.packageManager;
  if (pm) {
    try {
      execSync(`${pm} --version`, { stdio: "ignore" });
      results.push({ status: "ok", label: `  package manager "${pm}" is installed` });
    } catch {
      results.push({
        status: "fail",
        label: `  package manager "${pm}" not found in PATH`,
      });
    }
  }
}

function printAndExit(results: CheckResult[]): void {
  console.log("iterate doctor:\n");
  let hasFail = false;
  for (const r of results) {
    console.log(`  ${ICON[r.status]} ${r.label}`);
    if (r.detail) console.log(`      ${r.detail}`);
    if (r.status === "fail") hasFail = true;
  }
  console.log();
  if (hasFail) {
    console.log("\x1b[31mFailed.\x1b[0m Fix the ✗ items above and rerun `iterate doctor`.");
    process.exit(1);
  }
  const warnCount = results.filter((r) => r.status === "warn").length;
  if (warnCount > 0) {
    console.log(`\x1b[33mOK with ${warnCount} warning(s).\x1b[0m`);
  } else {
    console.log("\x1b[32mAll checks passed.\x1b[0m");
  }
}

// Also export for testing
export const __internal = { checkApp };

// Guard against isPortInUse being "unused" in the import — some checks may
// opt into it later (e.g. hostname-based reverse proxy probing).
void isPortInUse;
