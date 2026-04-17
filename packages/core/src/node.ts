/**
 * Node-only helpers: filesystem config IO, daemon lockfile, free port probing,
 * dotenv file loading. This module is NOT safe to import in a browser build.
 *
 * Consumers should import via `iterate-ui-core/node`.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname, resolve, isAbsolute } from "node:path";
import { createConnection, createServer } from "node:net";
import { normalizeConfig, DEFAULT_CONFIG, type IterateConfig } from "./types/config.js";

// ---------- Config file IO ----------

/** Location of the iterate config file relative to a repo root. */
export function configPath(cwd: string): string {
  return join(cwd, ".iterate", "config.json");
}

/**
 * Read and normalize `.iterate/config.json` from the given directory.
 * Returns null if the file doesn't exist. Throws on invalid JSON.
 */
export function loadConfig(cwd: string): IterateConfig | null {
  const path = configPath(cwd);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<IterateConfig> & Record<string, unknown>;
  return normalizeConfig(raw);
}

/** Read config, or return DEFAULT_CONFIG if absent. */
export function loadConfigOrDefault(cwd: string): IterateConfig {
  return loadConfig(cwd) ?? { ...DEFAULT_CONFIG };
}

/** Write a normalized config to `.iterate/config.json`. */
export function saveConfig(cwd: string, config: IterateConfig): void {
  const path = configPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
}

// ---------- Daemon lockfile ----------

export interface DaemonLockfile {
  /** PID of the daemon process. */
  pid: number;
  /** Port the daemon is actually bound to (post-auto-pick). */
  port: number;
  /** Repo root the daemon was started against. */
  cwd: string;
  /** ISO timestamp of when the daemon started. */
  startedAt: string;
}

export function lockfilePath(cwd: string): string {
  return join(cwd, ".iterate", "daemon.lock");
}

/** Read the daemon lockfile. Returns null if missing or malformed. */
export function readLockfile(cwd: string): DaemonLockfile | null {
  const path = lockfilePath(cwd);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (
      typeof raw?.pid === "number" &&
      typeof raw?.port === "number" &&
      typeof raw?.cwd === "string" &&
      typeof raw?.startedAt === "string"
    ) {
      return raw as DaemonLockfile;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeLockfile(cwd: string, info: DaemonLockfile): void {
  const path = lockfilePath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(info, null, 2) + "\n");
}

export function removeLockfile(cwd: string): void {
  const path = lockfilePath(cwd);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // best-effort cleanup
    }
  }
}

/**
 * Is the PID in the lockfile still alive? Uses `process.kill(pid, 0)` which
 * throws if the process is gone. Returns false on any error.
 */
export function isDaemonAlive(lock: DaemonLockfile): boolean {
  try {
    process.kill(lock.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the daemon port for CLIs and MCP:
 *   1. Explicit override (env var or CLI flag) wins.
 *   2. Live lockfile (PID alive + port responsive) next.
 *   3. Stale lockfile port as a guess.
 *   4. Config `daemonPort` as the final fallback.
 */
export function resolveDaemonPort(cwd: string, config: IterateConfig | null, override?: number): number {
  if (override && Number.isFinite(override)) return override;
  const lock = readLockfile(cwd);
  if (lock) return lock.port;
  return config?.daemonPort ?? DEFAULT_CONFIG.daemonPort;
}

// ---------- Port probing ----------

/** Is something already bound to this port on 127.0.0.1? */
export function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolveFn) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolveFn(true);
    });
    socket.once("error", () => resolveFn(false));
  });
}

/** Can we bind a fresh listener to this port? (Stronger check than isPortInUse.) */
export function canBindPort(port: number): Promise<boolean> {
  return new Promise((resolveFn) => {
    const server = createServer();
    server.once("error", () => resolveFn(false));
    server.once("listening", () => {
      server.close(() => resolveFn(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Find the first bindable port at or above `startingFrom`, up to `maxAttempts` tries.
 * Throws if no port in the range is free.
 */
export async function findFreePort(startingFrom: number, maxAttempts = 50): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startingFrom + i;
    if (port > 65535) break;
    if (await canBindPort(port)) return port;
  }
  throw new Error(`No free port in range ${startingFrom}..${startingFrom + maxAttempts - 1}`);
}

// ---------- Dotenv loading ----------

/**
 * Minimal .env parser. Supports:
 *   - `KEY=value` and `KEY="value"` / `KEY='value'`
 *   - `#` comments (full-line or trailing on unquoted values)
 *   - empty lines
 *   - multi-line double-quoted values with `\n` escapes
 * Does NOT support variable interpolation (`$OTHER`) — callers should compose
 * multiple files in explicit order instead.
 */
export function parseDotenv(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = src.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    i++;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let rest = line.slice(eq + 1);
    // Trim leading spaces but not within quotes
    let value: string;
    const leading = rest.match(/^\s*/)?.[0] ?? "";
    rest = rest.slice(leading.length);
    if (rest.startsWith('"')) {
      // Double-quoted: may span lines
      let acc = rest.slice(1);
      let closed = false;
      while (true) {
        const closeIdx = findUnescapedQuote(acc, '"');
        if (closeIdx !== -1) {
          value = acc.slice(0, closeIdx);
          closed = true;
          break;
        }
        if (i >= lines.length) {
          value = acc;
          break;
        }
        acc += "\n" + lines[i];
        i++;
      }
      if (closed) {
        value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    } else if (rest.startsWith("'")) {
      const end = rest.indexOf("'", 1);
      value = end === -1 ? rest.slice(1) : rest.slice(1, end);
    } else {
      // Unquoted: strip trailing comment
      const hashIdx = rest.indexOf(" #");
      value = (hashIdx === -1 ? rest : rest.slice(0, hashIdx)).trim();
    }
    out[key] = value;
  }
  return out;
}

function findUnescapedQuote(s: string, q: string): number {
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\\") {
      i += 2;
      continue;
    }
    if (s[i] === q) return i;
    i++;
  }
  return -1;
}

/**
 * Load one or more dotenv files from disk, merging in order (later wins).
 * Paths may be absolute or relative to `repoRoot`. Missing files are skipped
 * silently; they're commonly optional.
 */
export function loadEnvFiles(repoRoot: string, files: string[] = []): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const rel of files) {
    const full = isAbsolute(rel) ? rel : resolve(repoRoot, rel);
    if (!existsSync(full)) continue;
    try {
      const src = readFileSync(full, "utf-8");
      Object.assign(merged, parseDotenv(src));
    } catch {
      // ignore unreadable files
    }
  }
  return merged;
}
