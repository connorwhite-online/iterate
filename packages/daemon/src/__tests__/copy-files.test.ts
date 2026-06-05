import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyFilesToWorktree } from "../worktree/copy-files.js";

/**
 * copyFilesToWorktree handles the copying of `.env*`, `.npmrc`, and any
 * user-configured patterns from the repo root into a fresh worktree. Tests
 * here lock in the glob semantics + nested-path behavior so users can rely
 * on them.
 */

let src: string;
let dst: string;

beforeEach(() => {
  src = mkdtempSync(join(tmpdir(), "iterate-copy-src-"));
  dst = mkdtempSync(join(tmpdir(), "iterate-copy-dst-"));
});

afterEach(() => {
  rmSync(src, { recursive: true, force: true });
  rmSync(dst, { recursive: true, force: true });
});

describe("copyFilesToWorktree", () => {
  it("copies .env* patterns including multi-suffix files like .env.development.pre", () => {
    writeFileSync(join(src, ".env"), "A=1");
    writeFileSync(join(src, ".env.local"), "B=2");
    writeFileSync(join(src, ".env.development.pre"), "C=3");
    writeFileSync(join(src, "other.txt"), "unrelated");

    copyFilesToWorktree(src, dst, [".env*"]);

    expect(existsSync(join(dst, ".env"))).toBe(true);
    expect(existsSync(join(dst, ".env.local"))).toBe(true);
    expect(existsSync(join(dst, ".env.development.pre"))).toBe(true);
    expect(existsSync(join(dst, "other.txt"))).toBe(false);
    expect(readFileSync(join(dst, ".env.development.pre"), "utf-8")).toBe("C=3");
  });

  it("copies .npmrc alongside .env* when multiple patterns are supplied", () => {
    writeFileSync(join(src, ".env"), "A=1");
    writeFileSync(join(src, ".npmrc"), "registry=https://example.com");

    copyFilesToWorktree(src, dst, [".env*", ".npmrc"]);

    expect(existsSync(join(dst, ".env"))).toBe(true);
    expect(existsSync(join(dst, ".npmrc"))).toBe(true);
  });

  it("skips directories that match the glob pattern", () => {
    // A directory named ".envs" would match ".env*"
    mkdirSync(join(src, ".envs"));
    writeFileSync(join(src, ".envs", "secrets.env"), "secret");
    writeFileSync(join(src, ".env"), "A=1");

    copyFilesToWorktree(src, dst, [".env*"]);

    // The plain .env file is copied; the .envs/ directory is skipped
    expect(existsSync(join(dst, ".env"))).toBe(true);
    expect(existsSync(join(dst, ".envs"))).toBe(false);
  });

  it("preserves nested paths for patterns with slashes", () => {
    mkdirSync(join(src, "config"), { recursive: true });
    writeFileSync(join(src, "config", ".env"), "N=1");

    copyFilesToWorktree(src, dst, ["config/.env"]);

    expect(existsSync(join(dst, "config", ".env"))).toBe(true);
    expect(readFileSync(join(dst, "config", ".env"), "utf-8")).toBe("N=1");
  });

  it("is a no-op when no files match", () => {
    copyFilesToWorktree(src, dst, [".env*"]);
    // dst should be empty
    // Just confirm there are no files copied by checking a handful of expected names
    expect(existsSync(join(dst, ".env"))).toBe(false);
    expect(existsSync(join(dst, ".npmrc"))).toBe(false);
  });

  it("handles empty pattern list safely", () => {
    writeFileSync(join(src, ".env"), "A=1");
    copyFilesToWorktree(src, dst, []);
    expect(existsSync(join(dst, ".env"))).toBe(false);
  });

  it("creates intermediate directories as needed", () => {
    mkdirSync(join(src, "apps", "web"), { recursive: true });
    writeFileSync(join(src, "apps", "web", ".env"), "X=1");

    copyFilesToWorktree(src, dst, ["apps/web/.env"]);

    expect(existsSync(join(dst, "apps", "web", ".env"))).toBe(true);
  });
});
