import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { simpleGit } from "simple-git";
import { WorktreeManager } from "../manager.js";

/**
 * Manager-level tests run against a real temp git repo (matching the style of
 * the daemon's other git-backed tests). They cover the two postmortem fixes:
 *   - getDirtyTrackedFiles() detection (pre-flight warning source)
 *   - pick() naming conflicting files + leaving a clean tree on conflict
 */

let tmp: string;
// Worktrees are created at <parent>/.iterate/<projectName> — outside the repo.
let worktreeScratch: string;

function git(cmd: string, cwd = tmp) {
  execSync(`git ${cmd}`, { cwd, stdio: "pipe" });
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "iterate-mgr-"));
  worktreeScratch = join(resolve(tmp), "..", ".iterate", basename(resolve(tmp)));
  git("init -q -b main");
  git('config user.email "test@iterate.dev"');
  git('config user.name "Iterate Test"');
  // Base commit with a multi-line block we can conflict on.
  writeFileSync(
    join(tmp, "page.tsx"),
    [
      "export default function Page() {",
      "  return (",
      "    <div>",
      "      <p>ORIGINAL paragraph</p>",
      "    </div>",
      "  );",
      "}",
      "",
    ].join("\n")
  );
  git("add -A");
  git('commit -q -m "base"');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(worktreeScratch, { recursive: true, force: true });
});

describe("WorktreeManager.getDirtyTrackedFiles", () => {
  it("returns tracked files with uncommitted edits", async () => {
    writeFileSync(join(tmp, "page.tsx"), "changed\n");
    const mgr = new WorktreeManager(tmp);
    const dirty = await mgr.getDirtyTrackedFiles();
    expect(dirty).toContain("page.tsx");
  });

  it("excludes untracked files (they can't conflict on merge)", async () => {
    writeFileSync(join(tmp, "brand-new.tsx"), "new\n");
    const mgr = new WorktreeManager(tmp);
    const dirty = await mgr.getDirtyTrackedFiles();
    expect(dirty).not.toContain("brand-new.tsx");
  });

  it("returns an empty list on a clean tree", async () => {
    const mgr = new WorktreeManager(tmp);
    expect(await mgr.getDirtyTrackedFiles()).toEqual([]);
  });

  it("excludes the .iterate/ scratch dir", async () => {
    // Track a file under .iterate/, then modify it.
    execSync("mkdir -p .iterate", { cwd: tmp });
    writeFileSync(join(tmp, ".iterate", "config.json"), "{}\n");
    git("add -A");
    git('commit -q -m "add iterate config"');
    writeFileSync(join(tmp, ".iterate", "config.json"), '{"changed":true}\n');
    const mgr = new WorktreeManager(tmp);
    const dirty = await mgr.getDirtyTrackedFiles();
    expect(dirty).not.toContain(".iterate/config.json");
  });
});

describe("WorktreeManager.pick — conflict handling", () => {
  it("merges cleanly when changes don't overlap", async () => {
    const mgr = new WorktreeManager(tmp);
    const { worktreePath, branch } = await mgr.create("v1");

    // Iteration edits a brand-new file — no overlap with base or main.
    writeFileSync(join(worktreePath, "feature.tsx"), "feature\n");

    await mgr.pick(branch, worktreePath, [
      { name: "v1", worktreePath, branch },
    ]);

    // main now has the merged file and a clean tree (a non-divergent pick
    // fast-forwards, so there's no separate merge commit — the iteration's
    // change is simply present on main).
    const status = await simpleGit(tmp).status();
    expect(status.conflicted).toEqual([]);
    expect(status.isClean()).toBe(true);
    const tracked = execSync("git ls-files", { cwd: tmp, encoding: "utf-8" });
    expect(tracked).toContain("feature.tsx");
  });

  it("throws naming the conflicting file and leaves a clean working tree", async () => {
    const mgr = new WorktreeManager(tmp);
    const { worktreePath, branch } = await mgr.create("v1");

    // Iteration changes the paragraph one way (uncommitted — pick auto-commits).
    writeFileSync(
      join(worktreePath, "page.tsx"),
      [
        "export default function Page() {",
        "  return (",
        "    <div>",
        "      <p>ITERATION paragraph</p>",
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n")
    );

    // Base branch changes the SAME line a different way (uncommitted — pick
    // auto-commits to main first). This reproduces the postmortem: the same
    // region diverges on both branches.
    writeFileSync(
      join(tmp, "page.tsx"),
      [
        "export default function Page() {",
        "  return (",
        "    <div>",
        "      <p>MAIN paragraph</p>",
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n")
    );

    await expect(
      mgr.pick(branch, worktreePath, [{ name: "v1", worktreePath, branch }])
    ).rejects.toThrow(/page\.tsx/);

    // The merge must have been aborted: no conflict markers, clean tree.
    const status = await simpleGit(tmp).status();
    expect(status.conflicted).toEqual([]);
    const content = execSync("cat page.tsx", { cwd: tmp, encoding: "utf-8" });
    expect(content).not.toContain("<<<<<<<");
    expect(content).not.toContain(">>>>>>>");
  });
});
