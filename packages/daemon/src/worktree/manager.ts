import { simpleGit, type SimpleGit } from "simple-git";
import { join } from "node:path";

export interface DiscoveredWorktree {
  path: string;
  branch: string;
  head: string;
  /** Whether this is a bare/detached worktree (no branch) */
  detached: boolean;
}

export class WorktreeManager {
  private git: SimpleGit;
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.git = simpleGit(cwd);
  }

  /** Get the git repository root (the main worktree path) */
  async getRepoRoot(): Promise<string> {
    return (await this.git.raw(["rev-parse", "--show-toplevel"])).trim();
  }

  /** Get the current branch name */
  async getCurrentBranch(): Promise<string> {
    const status = await this.git.status();
    return status.current ?? "main";
  }

  /** Create a new worktree with a new branch */
  async create(
    name: string,
    baseBranch?: string
  ): Promise<{ worktreePath: string; branch: string }> {
    const base = baseBranch ?? (await this.getCurrentBranch());

    // Verify the base ref exists (handles unborn HEAD, nonexistent branches)
    try {
      await this.git.raw(["rev-parse", "--verify", base]);
    } catch {
      throw new Error(
        `Base ref "${base}" does not exist. Make sure you have at least one commit.`
      );
    }

    const branch = `iterate/${name}`;
    const worktreePath = join(this.cwd, ".iterate", "worktrees", name);

    // Clean up stale branch/worktree from a previous run
    try {
      await this.git.raw(["rev-parse", "--verify", branch]);
      // Branch exists — remove stale worktree first, then delete branch
      try { await this.git.raw(["worktree", "remove", "--force", worktreePath]); } catch { /* may not exist */ }
      await this.git.raw(["worktree", "prune"]);
      await this.git.raw(["branch", "-D", branch]);
    } catch {
      // Branch doesn't exist — good, nothing to clean up
    }

    await this.git.raw([
      "worktree",
      "add",
      "-b",
      branch,
      worktreePath,
      base,
    ]);

    return { worktreePath, branch };
  }

  /** Remove a worktree and optionally delete its branch */
  async remove(name: string, deleteBranch = true): Promise<void> {
    const worktreePath = join(this.cwd, ".iterate", "worktrees", name);

    await this.git.raw(["worktree", "remove", "--force", worktreePath]);

    if (deleteBranch) {
      try {
        await this.git.raw(["branch", "-D", `iterate/${name}`]);
      } catch {
        // Branch may already be deleted
      }
    }
  }

  /** Remove a worktree by its full path (for external worktrees) */
  async removeByPath(worktreePath: string, branch?: string, deleteBranch = false): Promise<void> {
    await this.git.raw(["worktree", "remove", "--force", worktreePath]);

    if (deleteBranch && branch) {
      try {
        await this.git.raw(["branch", "-D", branch]);
      } catch {
        // Branch may already be deleted
      }
    }
  }

  /** List all iterate worktrees (filtered to iterate/ branches only) */
  async list(): Promise<
    Array<{ path: string; branch: string; head: string }>
  > {
    const raw = await this.git.raw(["worktree", "list", "--porcelain"]);
    const worktrees: Array<{ path: string; branch: string; head: string }> = [];
    let current: Partial<{ path: string; branch: string; head: string }> = {};

    for (const line of raw.split("\n")) {
      if (line.startsWith("worktree ")) {
        current.path = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        current.head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length);
        current.branch = ref.replace("refs/heads/", "");
      } else if (line === "") {
        if (
          current.path &&
          current.branch?.startsWith("iterate/")
        ) {
          worktrees.push(current as { path: string; branch: string; head: string });
        }
        current = {};
      }
    }

    return worktrees;
  }

  /** Discover ALL git worktrees (not just iterate/ branches) */
  async discoverAll(): Promise<DiscoveredWorktree[]> {
    const raw = await this.git.raw(["worktree", "list", "--porcelain"]);
    const worktrees: DiscoveredWorktree[] = [];
    let current: Partial<DiscoveredWorktree> = {};

    for (const line of raw.split("\n")) {
      if (line.startsWith("worktree ")) {
        current.path = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        current.head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length);
        current.branch = ref.replace("refs/heads/", "");
        current.detached = false;
      } else if (line === "detached") {
        current.detached = true;
      } else if (line === "") {
        if (current.path && current.head) {
          worktrees.push({
            path: current.path,
            branch: current.branch ?? current.head.slice(0, 8),
            head: current.head,
            detached: current.detached ?? false,
          });
        }
        current = {};
      }
    }

    return worktrees;
  }

  /**
   * Pick a winner: merge the chosen iteration's branch into base,
   * then remove all iteration worktrees.
   */
  async pick(
    winnerBranch: string,
    winnerWorktreePath: string,
    allIterations: Array<{ name: string; worktreePath: string; branch: string; source?: string }>,
    strategy: "merge" | "squash" | "rebase" = "merge"
  ): Promise<void> {
    // Auto-commit any uncommitted changes in the winner's worktree
    const winnerGit = simpleGit(winnerWorktreePath);
    const winnerStatus = await winnerGit.status();
    if (
      winnerStatus.modified.length > 0 ||
      winnerStatus.not_added.length > 0 ||
      winnerStatus.created.length > 0 ||
      winnerStatus.deleted.length > 0
    ) {
      await winnerGit.add(".");
      await winnerGit.commit(`iterate: changes from ${winnerBranch}`);
    }

    const winnerDisplayName = winnerBranch.replace("iterate/", "");

    // Auto-commit any uncommitted/untracked changes on main so merge can proceed
    const mainStatus = await this.git.status();
    if (
      mainStatus.modified.length > 0 ||
      mainStatus.not_added.length > 0 ||
      mainStatus.created.length > 0 ||
      mainStatus.deleted.length > 0
    ) {
      await this.git.add(".");
      await this.git.commit("iterate: save changes before pick");
    }

    try {
      if (strategy === "squash") {
        await this.git.raw(["merge", "--squash", winnerBranch]);
        // Check if there are staged changes to commit
        const status = await this.git.status();
        if (status.staged.length > 0) {
          await this.git.raw(["commit", "-m", `iterate: pick ${winnerDisplayName}`]);
        }
      } else if (strategy === "rebase") {
        await this.git.raw(["rebase", winnerBranch]);
      } else {
        await this.git.raw([
          "merge",
          winnerBranch,
          "-m",
          `iterate: pick ${winnerDisplayName}`,
        ]);
      }
    } catch (err) {
      // Abort on conflict so we don't leave the repo in a broken state
      try {
        if (strategy === "rebase") {
          await this.git.raw(["rebase", "--abort"]);
        } else {
          await this.git.raw(["merge", "--abort"]);
        }
      } catch {
        // Already clean
      }
      throw new Error(
        `Merge failed (likely conflicts). Aborted to keep the repo clean. ` +
        `Resolve manually with: git merge ${winnerBranch}\n` +
        `Original error: ${(err as Error).message}`
      );
    }

    // Remove all iteration worktrees (including the winner)
    for (const iter of allIterations) {
      try {
        if (iter.source === "external") {
          // External worktrees: remove worktree but leave the branch
          await this.removeByPath(iter.worktreePath);
        } else {
          // Iterate-created: remove worktree and branch
          await this.remove(iter.name, true);
        }
      } catch {
        // Best effort cleanup
      }
    }

    await this.git.raw(["worktree", "prune"]);
  }

  /** Prune stale worktree references */
  async prune(): Promise<void> {
    await this.git.raw(["worktree", "prune"]);
  }
}
