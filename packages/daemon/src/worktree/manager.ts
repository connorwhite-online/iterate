import { simpleGit, type SimpleGit } from "simple-git";
import { join } from "node:path";

export class WorktreeManager {
  private git: SimpleGit;
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.git = simpleGit(cwd);
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

  /** List all iterate worktrees */
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

  /**
   * Pick a winner: merge the chosen iteration's branch into base,
   * then remove all other iteration worktrees.
   */
  async pick(
    winnerName: string,
    allIterationNames: string[],
    strategy: "merge" | "squash" | "rebase" = "merge"
  ): Promise<void> {
    const winnerBranch = `iterate/${winnerName}`;

    try {
      if (strategy === "squash") {
        await this.git.raw(["merge", "--squash", winnerBranch]);
        // Check if there are staged changes to commit
        const status = await this.git.status();
        if (status.staged.length > 0) {
          await this.git.raw(["commit", "-m", `iterate: pick ${winnerName}`]);
        }
      } else if (strategy === "rebase") {
        await this.git.raw(["rebase", winnerBranch]);
      } else {
        await this.git.raw([
          "merge",
          winnerBranch,
          "-m",
          `iterate: pick ${winnerName}`,
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
    for (const name of allIterationNames) {
      try {
        await this.remove(name, true);
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
