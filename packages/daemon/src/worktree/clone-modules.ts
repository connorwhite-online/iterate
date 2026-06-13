import { existsSync, mkdirSync, linkSync, readdirSync, symlinkSync, readlinkSync } from "node:fs";
import { join } from "node:path";

/**
 * Result of a `cloneNodeModules` attempt. `cloned` is false (with a `reason`)
 * when there was nothing to do or the clone failed — the caller falls back to a
 * full install in either case.
 */
export interface CloneResult {
  cloned: boolean;
  /**
   * True when the clone was a benign no-op (no source `node_modules`, or the
   * destination already has one) rather than a genuine failure. Skips do not
   * warrant a "falling back" warning — there was simply nothing to clone.
   */
  skipped: boolean;
  /** Human-readable reason the clone was skipped or failed (for logging). */
  reason?: string;
  /** Number of files hardlinked (for benchmarking / debugging). */
  linked: number;
}

/**
 * Recursively hardlink-clone a directory tree from `src` to `dest`.
 *
 * Files are `link()`ed (sharing inodes — near-instant, zero extra disk), dirs
 * are `mkdir()`ed, and symlinks are recreated as symlinks. This is the
 * dependency-free equivalent of `cp -al` (Linux) / `cp -cR` (APFS).
 *
 * NOTE: `fs.cpSync(..., { mode: COPYFILE_FICLONE })` does NOT hardlink — it
 * copy-on-writes whole files where supported and plain-copies otherwise, so it
 * is both slower and uses real disk. We walk and `link()` instead.
 *
 * Hardlinks require src and dest to be on the same filesystem. iterate places
 * worktrees at `<parent>/.iterate/<project>/` (sibling of the repo), so this
 * holds in the normal case; cross-device failures (EXDEV) surface as a thrown
 * error and are handled by the caller's fallback.
 */
function hardlinkTree(src: string, dest: string): number {
  mkdirSync(dest, { recursive: true });
  let linked = 0;

  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      linked += hardlinkTree(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      // Recreate the symlink rather than following it — npm-style nested
      // node_modules and pnpm's `.bin` shims rely on symlinks staying symlinks.
      symlinkSync(readlinkSync(srcPath), destPath);
    } else {
      linkSync(srcPath, destPath);
      linked += 1;
    }
  }

  return linked;
}

/**
 * Hardlink-clone `<srcRoot>/node_modules` into `<destRoot>/node_modules` if it
 * exists and the destination doesn't already have one.
 *
 * Never throws: any failure is reported via `CloneResult.reason` so the caller
 * can log it and fall back to a full install. Designed as a best-effort
 * install accelerator for npm/yarn/bun (pnpm shares its store already).
 */
export function cloneNodeModules(srcRoot: string, destRoot: string): CloneResult {
  const src = join(srcRoot, "node_modules");
  const dest = join(destRoot, "node_modules");

  if (!existsSync(src)) {
    return { cloned: false, skipped: true, reason: `source ${src} does not exist`, linked: 0 };
  }
  if (existsSync(dest)) {
    return { cloned: false, skipped: true, reason: `destination ${dest} already exists`, linked: 0 };
  }

  try {
    const linked = hardlinkTree(src, dest);
    return { cloned: true, skipped: false, linked };
  } catch (err) {
    return {
      cloned: false,
      skipped: false,
      reason: err instanceof Error ? err.message : String(err),
      linked: 0,
    };
  }
}
