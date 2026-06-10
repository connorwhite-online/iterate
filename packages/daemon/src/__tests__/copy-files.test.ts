import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyFilesToWorktree, copyUncommittedFiles, DEFAULT_COPY_IGNORE } from "../worktree/copy-files.js";

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

// ---------------------------------------------------------------------------
// copyUncommittedFiles — exclusion / copyIgnore tests
// These tests mock `execSync` so they don't need a real git repo.
// ---------------------------------------------------------------------------

import { execSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

const mockExecSync = execSync as ReturnType<typeof vi.fn>;

describe("copyUncommittedFiles – DEFAULT_COPY_IGNORE", () => {
  it("exports the expected default ignore list", () => {
    expect(DEFAULT_COPY_IGNORE).toEqual(
      expect.arrayContaining(["node_modules", "dist", "build", ".next", ".turbo", "coverage", ".cache"])
    );
  });
});

describe("copyUncommittedFiles – skips ignored untracked dirs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("skips a top-level untracked node_modules directory", () => {
    // git status reports untracked dirs with a trailing slash
    mockExecSync.mockReturnValue("?? node_modules/\n");

    copyUncommittedFiles(src, dst);

    // Nothing should have been written to dst
    expect(existsSync(join(dst, "node_modules"))).toBe(false);
  });

  it("skips a nested node_modules dir (e.g. apps/web/node_modules)", () => {
    mockExecSync.mockReturnValue("?? apps/web/node_modules/\n");

    copyUncommittedFiles(src, dst);

    expect(existsSync(join(dst, "apps", "web", "node_modules"))).toBe(false);
  });

  it("skips .next, dist, build, .turbo, coverage, and .cache by default", () => {
    const dirs = [".next", "dist", "build", ".turbo", "coverage", ".cache"];
    mockExecSync.mockReturnValue(dirs.map((d) => `?? ${d}/`).join("\n") + "\n");

    copyUncommittedFiles(src, dst);

    for (const d of dirs) {
      expect(existsSync(join(dst, d))).toBe(false);
    }
  });

  it("does NOT skip a tracked (modified) file whose path contains an ignored segment name", () => {
    // Suppose there's a tracked file "dist/bundle.js" that was modified —
    // it has " M" status, not "??", so it must still be copied.
    writeFileSync(join(src, "dist-notes.txt"), "modified content");
    mockExecSync.mockReturnValue(" M dist-notes.txt\n");

    copyUncommittedFiles(src, dst);

    // dist-notes.txt doesn't contain an ignored segment so it should be copied
    expect(existsSync(join(dst, "dist-notes.txt"))).toBe(true);
  });

  it("copies untracked files not in the ignore list", () => {
    writeFileSync(join(src, "newfile.ts"), "export {}");
    mockExecSync.mockReturnValue("?? newfile.ts\n");

    copyUncommittedFiles(src, dst);

    expect(existsSync(join(dst, "newfile.ts"))).toBe(true);
    expect(readFileSync(join(dst, "newfile.ts"), "utf-8")).toBe("export {}");
  });

  it("skips entries matching a user-supplied copyIgnore segment", () => {
    mkdirSync(join(src, "vendor"), { recursive: true });
    writeFileSync(join(src, "vendor", "lib.js"), "// vendored");
    mockExecSync.mockReturnValue("?? vendor/\n");

    copyUncommittedFiles(src, dst, ["vendor"]);

    expect(existsSync(join(dst, "vendor"))).toBe(false);
  });

  it("logs a summary line when entries are skipped", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExecSync.mockReturnValue("?? node_modules/\n?? dist/\n");

    copyUncommittedFiles(src, dst);

    expect(consoleSpy).toHaveBeenCalledOnce();
    const msg: string = consoleSpy.mock.calls[0]![0] as string;
    expect(msg).toMatch(/\[iterate\] skipped copying 2 untracked entries/);
    expect(msg).toMatch(/node_modules/);
    expect(msg).toMatch(/dist/);

    consoleSpy.mockRestore();
  });

  it("does not log when nothing is skipped", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    writeFileSync(join(src, "readme.md"), "# hi");
    mockExecSync.mockReturnValue("?? readme.md\n");

    copyUncommittedFiles(src, dst);

    // console.log should NOT have been called for the skip summary
    const skipCalls = consoleSpy.mock.calls.filter((c) =>
      typeof c[0] === "string" && (c[0] as string).includes("[iterate] skipped")
    );
    expect(skipCalls).toHaveLength(0);

    consoleSpy.mockRestore();
  });

  it("handles empty git status without errors", () => {
    mockExecSync.mockReturnValue("   \n");

    // Should not throw
    expect(() => copyUncommittedFiles(src, dst)).not.toThrow();
  });
});
