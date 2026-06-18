import { execa } from "execa";

/**
 * Auto-run a design critique by launching a headless Claude agent that invokes
 * the `iterate:critique` skill. This is what makes the overlay's Critique button
 * "click → findings appear" rather than requiring the user to run the skill by
 * hand.
 *
 * Safety: this is a deliberately *bounded, read-only* agent. It is NOT given
 * skip-permissions. It is restricted via `--allowedTools` to read-only source
 * inspection (Read/Grep/Glob) plus the two iterate critique MCP tools — so it
 * can analyze the page and submit findings but cannot edit code, run shell
 * commands, or take any destructive action. In headless `-p` mode any tool
 * outside the allowlist is denied (there is no interactive prompt), so the
 * allowlist is a hard boundary.
 *
 * Degrades gracefully: if the `claude` CLI isn't available (not installed, not
 * on PATH), this rejects and the caller leaves the request pending so the
 * overlay can fall back to a manual "run /iterate:critique" hint. The manual
 * skill path always works.
 */
export interface CritiqueAgentOptions {
  /** The critique request to analyze */
  requestId: string;
  /** Working directory the agent runs in (iteration worktree, or repo root) */
  cwd: string;
  /** Repo root, exposed as ITERATE_CWD so MCP/daemon discovery works */
  repoRoot: string;
  /** Called when the agent process exits (ok = clean exit) */
  onExit?: (ok: boolean, detail?: string) => void;
}

const AGENT_PROMPT =
  "Use the iterate:critique skill to analyze the pending design critique " +
  "request and submit findings.";

/**
 * The only tools the critique agent may use: read-only source inspection plus
 * the two iterate MCP critique tools. No Write/Edit/Bash — this agent cannot
 * change anything.
 */
const ALLOWED_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "mcp__iterate__iterate_get_critique_request",
  "mcp__iterate__iterate_submit_critique",
].join(",");

export function spawnCritiqueAgent(opts: CritiqueAgentOptions): void {
  const { requestId, cwd, repoRoot, onExit } = opts;

  // Headless, non-interactive, read-only run. `-p` prints and exits; the skill
  // discovers the pending request via the iterate MCP server (ITERATE_CWD points
  // at the repo). `--allowedTools` is the safety boundary (see file header).
  const child = execa(
    "claude",
    ["-p", `${AGENT_PROMPT} (request ${requestId})`, "--allowedTools", ALLOWED_TOOLS],
    {
      cwd,
      env: { ...process.env, ITERATE_CWD: repoRoot },
      reject: false,
      stdio: "ignore",
    },
  );

  child
    .then((result) => {
      const ok = result.exitCode === 0;
      onExit?.(ok, ok ? undefined : `claude exited with code ${result.exitCode}`);
    })
    .catch((err) => {
      // execa throws here only when the binary can't be spawned (ENOENT) since
      // reject:false suppresses non-zero exits.
      onExit?.(false, (err as Error)?.message ?? String(err));
    });
}
