import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync, symlinkSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cloneNodeModules } from "../clone-modules.js";

let srcRoot: string;
let destRoot: string;

beforeEach(() => {
  srcRoot = mkdtempSync(join(tmpdir(), "iterate-clone-src-"));
  destRoot = mkdtempSync(join(tmpdir(), "iterate-clone-dest-"));
});

afterEach(() => {
  rmSync(srcRoot, { recursive: true, force: true });
  rmSync(destRoot, { recursive: true, force: true });
});

/** Populate `<srcRoot>/node_modules` with a small package tree. */
function seedNodeModules() {
  const nm = join(srcRoot, "node_modules");
  mkdirSync(join(nm, "left-pad"), { recursive: true });
  writeFileSync(join(nm, "left-pad", "index.js"), "module.exports = () => {};");
  writeFileSync(join(nm, "left-pad", "package.json"), '{"name":"left-pad"}');
  // Nested dependency.
  mkdirSync(join(nm, "left-pad", "node_modules", "dep"), { recursive: true });
  writeFileSync(join(nm, "left-pad", "node_modules", "dep", "index.js"), "// dep");
  return nm;
}

describe("cloneNodeModules", () => {
  it("hardlinks the node_modules tree into the destination", () => {
    seedNodeModules();

    const result = cloneNodeModules(srcRoot, destRoot);

    expect(result.cloned).toBe(true);
    expect(result.linked).toBeGreaterThan(0);

    const destFile = join(destRoot, "node_modules", "left-pad", "index.js");
    expect(existsSync(destFile)).toBe(true);
    expect(readFileSync(destFile, "utf-8")).toBe("module.exports = () => {};");
    // Nested file copied too.
    expect(existsSync(join(destRoot, "node_modules", "left-pad", "node_modules", "dep", "index.js"))).toBe(true);
  });

  it("creates hardlinks (same inode), not copies", () => {
    seedNodeModules();
    cloneNodeModules(srcRoot, destRoot);

    const srcStat = statSync(join(srcRoot, "node_modules", "left-pad", "index.js"));
    const destStat = statSync(join(destRoot, "node_modules", "left-pad", "index.js"));
    expect(destStat.ino).toBe(srcStat.ino);
    expect(destStat.nlink).toBeGreaterThanOrEqual(2);
  });

  it("preserves symlinks as symlinks rather than dereferencing them", () => {
    const nm = seedNodeModules();
    mkdirSync(join(nm, ".bin"), { recursive: true });
    symlinkSync("../left-pad/index.js", join(nm, ".bin", "left-pad"));

    const result = cloneNodeModules(srcRoot, destRoot);
    expect(result.cloned).toBe(true);

    const destLink = join(destRoot, "node_modules", ".bin", "left-pad");
    expect(statSync(destLink, { throwIfNoEntry: true }) && readlinkSync(destLink)).toBe("../left-pad/index.js");
  });

  it("falls back (cloned: false) when the source node_modules does not exist", () => {
    const result = cloneNodeModules(srcRoot, destRoot);

    expect(result.cloned).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/does not exist/);
    expect(result.linked).toBe(0);
    expect(existsSync(join(destRoot, "node_modules"))).toBe(false);
  });

  it("skips (cloned: false) when the destination node_modules already exists", () => {
    seedNodeModules();
    mkdirSync(join(destRoot, "node_modules"), { recursive: true });

    const result = cloneNodeModules(srcRoot, destRoot);

    expect(result.cloned).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/already exists/);
  });
});
