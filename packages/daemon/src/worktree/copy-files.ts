import { copyFileSync, cpSync, mkdirSync, existsSync, unlinkSync, globSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";

/**
 * Copy files matching glob patterns from the project root into a worktree.
 * Preserves relative paths (e.g., "config/.env" → "<worktree>/config/.env").
 */
export function copyFilesToWorktree(
  cwd: string,
  worktreePath: string,
  patterns: string[]
): void {
  for (const pattern of patterns) {
    const matches = globSync(pattern, { cwd });
    for (const match of matches) {
      const src = join(cwd, match);
      if (statSync(src).isDirectory()) continue;
      const dest = join(worktreePath, match);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }
  }
}

/**
 * Path-segment names that are excluded from untracked-directory copies by default.
 * These are typically large build artefacts or vendored dependencies that cost
 * seconds and gigabytes per iteration without adding value.
 */
export const DEFAULT_COPY_IGNORE = [
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  ".cache",
];

/**
 * Return true when any path segment in `relPath` is present in `ignoreSet`.
 * Works for both forward- and back-slash separators.
 */
function hasIgnoredSegment(relPath: string, ignoreSet: Set<string>): boolean {
  for (const segment of relPath.split(/[/\\]/)) {
    if (ignoreSet.has(segment)) return true;
  }
  return false;
}

/**
 * Copy all uncommitted changes (modified, added, untracked) from the main
 * working directory into a new worktree so iterations start with the same
 * working state as the developer's current checkout.
 *
 * @param copyIgnore - Additional segment names to exclude on top of DEFAULT_COPY_IGNORE.
 */
export function copyUncommittedFiles(
  cwd: string,
  worktreePath: string,
  copyIgnore: string[] = []
): void {
  // Build the combined ignore set: defaults + user-supplied extras
  const ignoreSet = new Set([...DEFAULT_COPY_IGNORE, ...copyIgnore]);

  // Get all dirty files: modified, added, renamed, and untracked
  const raw = execSync("git status --porcelain", { cwd, encoding: "utf-8" });
  if (!raw.trim()) return;

  const skipped: string[] = [];

  for (const line of raw.split("\n")) {
    if (!line) continue;

    const statusCode = line.slice(0, 2);
    // For renames (R), the new path is after " -> "
    let filePath: string;
    if (statusCode.startsWith("R")) {
      const parts = line.slice(3).split(" -> ");
      filePath = parts[1] ?? parts[0]!;
    } else {
      filePath = line.slice(3);
    }

    filePath = filePath.trim();

    // Strip trailing slash that git appends to untracked directory entries
    if (filePath.endsWith("/")) filePath = filePath.slice(0, -1);

    // Skip .iterate/ directory to avoid copying worktrees into themselves
    if (filePath === ".iterate" || filePath.startsWith(".iterate/")) continue;

    // Deleted files: remove from worktree if present
    if (statusCode === " D" || statusCode === "D ") {
      const dest = join(worktreePath, filePath);
      try { unlinkSync(dest); } catch { /* may not exist */ }
      continue;
    }

    // Skip untracked entries whose path contains an ignored segment
    const isUntracked = statusCode === "??" || statusCode === "? ";
    if (isUntracked && hasIgnoredSegment(filePath, ignoreSet)) {
      skipped.push(filePath);
      continue;
    }

    const src = join(cwd, filePath);
    if (!existsSync(src)) continue;

    const dest = join(worktreePath, filePath);
    if (statSync(src).isDirectory()) {
      // Untracked directories show as a single entry in git status (e.g. "?? components/")
      // Recursively copy the entire directory
      cpSync(src, dest, { recursive: true });
    } else {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }
  }

  if (skipped.length > 0) {
    const names = skipped.map((p) => p.split(/[/\\]/).find((s) => ignoreSet.has(s)) ?? p);
    const unique = [...new Set(names)];
    console.log(`[iterate] skipped copying ${skipped.length} untracked ${skipped.length === 1 ? "entry" : "entries"} (${unique.join(", ")})`);
  }
}
