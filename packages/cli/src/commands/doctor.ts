import { Command } from "commander";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import {
  loadConfig,
  readLockfile,
  isDaemonAlive,
  canBindPort,
  parseDotenv,
} from "iterate-ui-core/node";
import type { AppConfig, IterateConfig } from "iterate-ui-core";

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  status: DoctorStatus;
  label: string;
  detail?: string;
}

export interface RunDoctorOptions {
  cwd: string;
  /** Optional: only check this registered app. */
  app?: string;
  /** Injectable for tests so we don't spawn real processes. */
  isPackageManagerInstalled?: (pm: string) => boolean;
}

const ICON: Record<DoctorStatus, string> = {
  ok: "\x1b[32m✓\x1b[0m",
  warn: "\x1b[33m!\x1b[0m",
  fail: "\x1b[31m✗\x1b[0m",
};

/**
 * Run doctor checks and return the ordered list. Does NOT call process.exit —
 * callers decide what to do with the results.
 */
export async function runDoctor(opts: RunDoctorOptions): Promise<DoctorCheck[]> {
  const { cwd, app: appFilter } = opts;
  const isPmInstalled =
    opts.isPackageManagerInstalled ?? ((pm: string) => probePackageManager(pm));

  const results: DoctorCheck[] = [];

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
    return results;
  }
  results.push({ status: "ok", label: "Loaded .iterate/config.json" });

  if (config.apps.length === 0) {
    results.push({
      status: "fail",
      label: "No apps registered",
      detail: "Run `iterate init` (optionally with --app-name, --app-dir) to register one.",
    });
    return results;
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
  const apps = appFilter
    ? config.apps.filter((a) => a.name === appFilter)
    : config.apps;

  if (appFilter && apps.length === 0) {
    results.push({
      status: "fail",
      label: `No app named "${appFilter}" in config`,
    });
    return results;
  }

  for (const a of apps) {
    results.push({ status: "ok", label: `— App: ${a.name} —` });
    checkApp(cwd, config, a, results, isPmInstalled);
  }

  // --- docker-compose hint (informational) ---
  if (existsSync(join(cwd, "docker-compose.yaml")) || existsSync(join(cwd, "docker-compose.yml"))) {
    results.push({
      status: "warn",
      label: "docker-compose detected at repo root",
      detail: "iterate doesn't manage these services — make sure they're running if your app depends on them.",
    });
  }

  return results;
}

export function checkApp(
  cwd: string,
  config: IterateConfig,
  app: AppConfig,
  results: DoctorCheck[],
  isPmInstalled: (pm: string) => boolean = probePackageManager
): void {
  // appDir exists
  const appRoot = app.appDir
    ? isAbsolute(app.appDir)
      ? app.appDir
      : resolve(cwd, app.appDir)
    : cwd;
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
    const referenced =
      app.devCommand.includes(`$${app.portEnvVar}`) ||
      app.devCommand.includes(`\${${app.portEnvVar}}`) ||
      app.devCommand.includes(`%${app.portEnvVar}%`);
    if (!referenced) {
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

  // Package manager
  const pm = app.packageManager ?? config.packageManager;
  if (pm) {
    if (isPmInstalled(pm)) {
      results.push({ status: "ok", label: `  package manager "${pm}" is installed` });
    } else {
      results.push({
        status: "fail",
        label: `  package manager "${pm}" not found in PATH`,
      });
    }
  }
}

function probePackageManager(pm: string): boolean {
  try {
    execSync(`${pm} --version`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function formatResults(results: DoctorCheck[]): { output: string; hasFail: boolean; warnCount: number } {
  const lines: string[] = ["iterate doctor:\n"];
  let hasFail = false;
  let warnCount = 0;
  for (const r of results) {
    lines.push(`  ${ICON[r.status]} ${r.label}`);
    if (r.detail) lines.push(`      ${r.detail}`);
    if (r.status === "fail") hasFail = true;
    if (r.status === "warn") warnCount++;
  }
  lines.push("");
  if (hasFail) {
    lines.push("\x1b[31mFailed.\x1b[0m Fix the ✗ items above and rerun `iterate doctor`.");
  } else if (warnCount > 0) {
    lines.push(`\x1b[33mOK with ${warnCount} warning(s).\x1b[0m`);
  } else {
    lines.push("\x1b[32mAll checks passed.\x1b[0m");
  }
  return { output: lines.join("\n"), hasFail, warnCount };
}

export const doctorCommand = new Command("doctor")
  .description("Preflight checks for iterate — verify config, ports, env files, and dev scripts")
  .option("--app <name>", "Only check this app (default: all configured apps)")
  .action(async (opts) => {
    const results = await runDoctor({ cwd: process.cwd(), app: opts.app });
    const { output, hasFail } = formatResults(results);
    console.log(output);
    if (hasFail) process.exit(1);
  });
