import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { resolveRepoRoot } from "../http-utils.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "iterate-repo-root-"));
  execSync("git init -q", { cwd: tmp });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("resolveRepoRoot", () => {
  it("returns the repo root when invoked from the root itself", () => {
    // macOS /tmp is a symlink to /private/tmp; git resolves the canonical path.
    // Compare via basename to avoid filesystem-realpath noise.
    const root = resolveRepoRoot(tmp);
    expect(root.endsWith(tmp.split("/").pop()!)).toBe(true);
  });

  it("walks up to find the repo root from a subdirectory", () => {
    const subdir = join(tmp, "apps", "web", "src", "deep");
    mkdirSync(subdir, { recursive: true });
    const fromRoot = resolveRepoRoot(tmp);
    const fromDeep = resolveRepoRoot(subdir);
    expect(fromDeep).toBe(fromRoot);
  });

  it("falls back to the invocation cwd when outside a git repo", () => {
    // Create a dir with no git.
    const noGit = mkdtempSync(join(tmpdir(), "iterate-no-git-"));
    try {
      expect(resolveRepoRoot(noGit)).toBe(noGit);
    } finally {
      rmSync(noGit, { recursive: true, force: true });
    }
  });

  it("uses process.cwd() by default", () => {
    const orig = process.cwd();
    try {
      process.chdir(tmp);
      const root = resolveRepoRoot();
      // Should be a non-empty path; exact match depends on /tmp realpath.
      expect(typeof root).toBe("string");
      expect(root.length).toBeGreaterThan(0);
    } finally {
      process.chdir(orig);
    }
  });
});
