/**
 * Tiny single-slot mutex: returns a function that runs each task strictly
 * after the previous one resolves (or rejects).
 *
 * Used to serialize `git worktree add/remove` invocations against the same
 * repo. Concurrent worktree mutations race on `.git/worktrees/`, producing
 * errors like:
 *
 *   fatal: failed to read .git/worktrees/<other>/commondir: Undefined error: 0
 *
 * because one `worktree add` enumerates the dir while another is mid-write.
 * git itself doesn't lock that path, so we funnel everything through a JS-side
 * mutex inside the daemon process. Multi-process concurrency would still
 * race — we don't currently spawn multiple daemons against one repo, so a
 * cross-process file lock is overkill.
 */
export function createSerializer(): <T>(task: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    // Don't poison the chain for subsequent callers if `task` rejects.
    chain = next.catch(() => undefined);
    return next;
  };
}
