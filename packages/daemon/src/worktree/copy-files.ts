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
 * Copy all uncommitted changes (modified, added, untracked) from the main
 * working directory into a new worktree so iterations start with the same
 * working state as the developer's current checkout.
 */
export function copyUncommittedFiles(
  cwd: string,
  worktreePath: string
): void {
  // Get all dirty files: modified, added, renamed, and untracked
  const raw = execSync("git status --porcelain", { cwd, encoding: "utf-8" });
  if (!raw.trim()) return;

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

    // Skip .iterate/ directory to avoid copying worktrees into themselves
    if (filePath === ".iterate" || filePath.startsWith(".iterate/")) continue;

    // Deleted files: remove from worktree if present
    if (statusCode === " D" || statusCode === "D ") {
      const dest = join(worktreePath, filePath);
      try { unlinkSync(dest); } catch { /* may not exist */ }
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
}
