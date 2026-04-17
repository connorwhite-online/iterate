import { execSync } from "node:child_process";

/**
 * Resolve the git repo root from any directory inside the repo, so CLI
 * commands can run from subdirectories and still find `.iterate/config.json`
 * at the repo root. Falls back to the invocation cwd if we're outside a
 * git repo — callers will then fail with a clean "iterate not initialized"
 * message.
 */
export function resolveRepoRoot(invocationCwd: string = process.cwd()): string {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: invocationCwd,
      encoding: "utf-8",
    }).trim();
  } catch {
    return invocationCwd;
  }
}

/**
 * fetch() helper with an AbortController timeout. Without this, CLI commands
 * that hit a half-dead daemon (e.g. hung on an iteration startup) would wait
 * indefinitely. Default timeout is 8s — long enough for slow responses, short
 * enough that "is it dead?" is clear.
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 8000, signal: userSignal, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  // If the caller passed their own signal, link them.
  if (userSignal) {
    if (userSignal.aborted) ctrl.abort();
    else userSignal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  try {
    return await fetch(input, { ...rest, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Parse a JSON response, returning null on empty/invalid bodies. */
export async function parseJsonSafe<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
