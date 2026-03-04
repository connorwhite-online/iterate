import type { Metadata } from "next";
import { CodeBlock } from "@/components/CodeBlock";
import { Callout } from "@/components/Callout";
import { ForkIcon, SendIcon, PickIcon, DiscardIcon } from "@/lib/icons";

export const metadata: Metadata = {
  title: "Worktrees as iterations",
  description: "How iterate uses git worktrees to explore multiple design directions in parallel.",
};

export default function WorktreeWorkflowPage() {
  return (
    <>
      <h1>Worktrees as iterations</h1>
      <p>
        <strong>iterate</strong> uses git worktrees to let you explore multiple design directions simultaneously.
        Each variation lives in its own branch with its own dev server, and you can switch between
        them in the toolbar to compare results side by side.
      </p>

      <h2>Toolbar workflow</h2>
      <p>
        The fastest way to create and manage iterations is through the toolbar overlay.
      </p>

      <h3>1. Fork iterations</h3>
      <p>
        Click <strong style={{ display: "inline-flex", alignItems: "center", gap: "0.2rem", verticalAlign: "middle" }}><ForkIcon size={14} /> Fork</strong> in the toolbar to create 3 iteration worktrees from a prompt.
        Each gets its own git branch, installs dependencies, and starts a dev server on a unique port
        (3100, 3101, 3102, ...). Tabs appear at the top of the toolbar so you can switch between them.
      </p>

      <h3>2. Annotate and refine</h3>
      <p>
        Switch between iteration tabs to compare. Select elements, add annotations, drag things around.
        Each annotation is scoped to the active iteration tab. When you&apos;re ready, click <strong style={{ display: "inline-flex", alignItems: "center", gap: "0.2rem", verticalAlign: "middle" }}><SendIcon size={14} /> Send</strong> to
        submit your feedback:
      </p>
      <CodeBlock
        code={`/iterate:go`}
        noCopy
      />
      <p>
        The agent reads your annotations, modifies the code, and the dev server hot-reloads.
        You see results immediately. Repeat as many times as needed.
      </p>

      <h3>3. Pick a direction</h3>
      <p>
        Once you favor a direction, click <strong style={{ display: "inline-flex", alignItems: "center", gap: "0.2rem", verticalAlign: "middle" }}><PickIcon size={14} /> Pick</strong> in the toolbar or run the command.
        The desired branch merges back to the base branch and all other worktrees and branches are
        removed. You&apos;re left with a single codebase.
      </p>
      <CodeBlock
        code={`/iterate:keep hero-v2`}
        noCopy
      />
      <p>
        The <strong style={{ display: "inline-flex", alignItems: "center", gap: "0.2rem", verticalAlign: "middle" }}><DiscardIcon size={14} /> Discard</strong> button does the opposite — it keeps the original and removes
        all iteration worktrees. Both <strong style={{ display: "inline-flex", alignItems: "center", gap: "0.2rem", verticalAlign: "middle" }}><PickIcon size={14} /> Pick</strong> and <strong style={{ display: "inline-flex", alignItems: "center", gap: "0.2rem", verticalAlign: "middle" }}><DiscardIcon size={14} /> Discard</strong> clean up
        worktrees regardless of where they live (see auto-discovery below).
      </p>

      <hr />

      <h2>CLI workflow</h2>
      <p>
        You can also manage worktrees directly from the terminal:
      </p>
      <CodeBlock
        lang="bash"
        noCopy
        code={`iterate branch feature-a   # create worktree + install + start dev server
iterate branch feature-b   # another worktree on the next port
iterate list               # show all active iterations with status
iterate pick feature-a     # merge feature-a to base, remove all others
iterate stop               # shut down daemon + all dev servers`}
      />

      <hr />

      <h2>Auto-discovery</h2>
      <p>
        <strong>iterate</strong> automatically discovers worktrees in two locations:
      </p>
      <ul>
        <li>
          <strong><code>.iterate/worktrees/</code></strong> — the default location where <strong>iterate</strong> creates
          worktrees. These appear as tabs automatically when the daemon starts.
        </li>
        <li>
          <strong><code>.claude/worktrees/</code></strong> — the standard location when worktrees are
          enabled in a Claude Code session. Any git worktree here with a running dev server is detected
          and shown as a tab.
        </li>
      </ul>
      <p>
        The <strong style={{ display: "inline-flex", alignItems: "center", gap: "0.2rem", verticalAlign: "middle" }}><PickIcon size={14} /> Pick</strong> and <strong style={{ display: "inline-flex", alignItems: "center", gap: "0.2rem", verticalAlign: "middle" }}><DiscardIcon size={14} /> Discard</strong> toolbar buttons work across both
        locations — merging or removing all discovered iteration worktrees regardless of where
        they were created.
      </p>

      <Callout>
        <p>
          Because worktrees are all subdirectories of the same repo, an agent working at the root
          directory has context over all worktrees simultaneously. This means it can compare
          implementations, share patterns between iterations, and make coordinated changes.
        </p>
      </Callout>

      <h2>Example session</h2>
      <CodeBlock
        lang="text"
        noCopy
        code={`# Fork 3 variations of the hero section from the toolbar
# → hero-minimal on :3101
# → hero-bold on :3102
# → hero-illustrated on :3103

# Switch between tabs in the toolbar to compare
# Select elements, annotate what you'd change, drag things around

# Submit feedback on hero-bold
# Click Send → /iterate:go
# Agent reads annotations, modifies code, dev server hot-reloads

# Satisfied with hero-bold — pick it
/iterate:keep hero-bold

# hero-bold merges to base, other worktrees are removed`}
      />
    </>
  );
}
