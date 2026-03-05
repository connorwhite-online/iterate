import type { Metadata } from "next";
import { CodeBlock } from "@/components/CodeBlock";
import { Callout } from "@/components/Callout";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { ForkIcon, PickIcon, DiscardIcon } from "@/lib/icons";

export const metadata: Metadata = {
  title: "Worktrees as iterations",
  description: "How iterate uses git worktrees to explore multiple design directions in parallel.",
};

export default function WorktreeWorkflowPage() {
  return (
    <>
      <h1>Worktrees as iterations</h1>
      <p>
        <strong>iterate</strong> packages git worktrees into an easily navigable toolbar system,
        allowing you to ideate in parallel easily.
      </p>

      <h2>How it works</h2>
      <MermaidDiagram
        code={`
graph TD
  subgraph repo ["Your Repository"]
    base["Base Branch"]
    base -->|git worktree add| wt1[".iterate/worktrees/v1"]
    base -->|git worktree add| wt2[".iterate/worktrees/v2"]
    base -->|git worktree add| wt3[".iterate/worktrees/v3"]
  end

  subgraph servers ["Dev Servers"]
    wt1 -->|npm run dev| s1[":3100"]
    wt2 -->|npm run dev| s2[":3101"]
    wt3 -->|npm run dev| s3[":3102"]
  end

  subgraph toolbar ["Iterate Toolbar (browser)"]
    s1 -->|iframe| tab1["Tab 1"]
    s2 -->|iframe| tab2["Tab 2"]
    s3 -->|iframe| tab3["Tab 3"]
    tab1 --- overlay["Icon Toolbar"]
    tab2 --- overlay
    tab3 --- overlay
  end

  overlay -->|submit changes| agent["Claude Code"]
  agent -->|edit files| wt1
  agent -->|edit files| wt2
  agent -->|edit files| wt3
`}
      />
      <p>
        Each iteration is a full git worktree with its own branch, dev server, and port.
        The toolbar loads each server in an iframe and layers an interactive overlay on top
        for selecting elements, adding annotations, and dragging components. When you submit
        feedback, Claude Code edits the source files directly and the dev server hot-reloads.
      </p>

      <h2>From the toolbar:</h2>
      <p>
        The fastest way to create and manage iterations is through the toolbar overlay.
      </p>

      <h3>1. Create iterations</h3>
      <p>
        Click <strong><ForkIcon size={14} style={{ verticalAlign: "-0.15em", marginRight: "0.1rem" }} /> Fork</strong> in the toolbar to create 3 iteration worktrees.
        Each gets its own branch, dev server, and port. Tabs appear so you can switch between them.
      </p>

      <h3>2. Review and refine</h3>
      <p>
        Switch between iteration tabs to compare. Select elements, describe what you want changed, drag things around.
        Each change is scoped to the active iteration tab. When you&apos;re ready, run the slash command:
      </p>
      <CodeBlock
        code={`/iterate:go`}
        noCopy
      />
      <p>
        The agent reads all pending changes, modifies the code, and the dev server hot-reloads.
        You see results immediately. Rinse and repeat endlessly.
      </p>

      <h3>3. Pick a direction</h3>
      <p>
        Once you favor a direction, click <strong><PickIcon size={14} style={{ verticalAlign: "-0.15em", marginRight: "0.1rem" }} /> Pick</strong> in the toolbar or run the <code>/iterate:keep &lt;tab/worktree-name&gt;</code> command.
        The desired branch merges back to the base branch and all other worktrees and branches are
        removed. You&apos;re left with a single codebase.
      </p>
      <CodeBlock
        code={`/iterate:keep hero-v2`}
        noCopy
      />
      <p>
        The <strong><DiscardIcon size={14} style={{ verticalAlign: "-0.15em", marginRight: "0.1rem" }} /> Discard</strong> button does the opposite — it keeps the original and removes
        all iteration worktrees. Both <strong><PickIcon size={14} style={{ verticalAlign: "-0.15em", marginRight: "0.1rem" }} /> Pick</strong> and <strong><DiscardIcon size={14} style={{ verticalAlign: "-0.15em", marginRight: "0.1rem" }} /> Discard</strong> clean up
        worktrees regardless of where they live (see <a href="#auto-discovery">auto-discovery</a> below).
      </p>

      <hr />

      <h2>From the command line:</h2>
      <p>
        You can also manage iterations through slash commands in your Claude Code session:
      </p>
      <ul>
        <li>
          <code>/iterate:prompt</code> — create multiple iteration worktrees from a verbal prompt, if you have an initial concept you want to riff on
        </li>
        <li>
          <code>/iterate:go</code> — implement all pending changes from the toolbar overlay
        </li>
        <li>
          <code>/iterate:keep</code> — choose a preferred iteration to merge back to the base branch and clean up the rest
        </li>
      </ul>

      <hr />

      <h1>Improving on worktree management</h1>
      <p>
        Claude Code already supports git worktrees, but they only contain committed files.
        If you have uncommitted edits, untracked components, or gitignored config like <code>.env.local</code>,
        a vanilla worktree starts from a blank slate. <strong>iterate</strong> fixes this by
        automatically copying your full working state into every new worktree — so each
        iteration begins exactly where you left off.
      </p>

      <MermaidDiagram
        code={`
graph LR
  root["Project Root"] --> committed["Committed Files"]
  root --> uncommitted["Uncommitted Edits"]
  root --> untracked["Untracked Files"]
  root --> envfiles["Gitignored Configs"]

  committed --> wt["New Worktree"]
  uncommitted --> wt
  untracked --> wt
  envfiles --> wt

  style committed fill:#e8e8e8,stroke:#999,color:#555
  style uncommitted fill:#d4edda,stroke:#28a745,color:#155724
  style untracked fill:#d4edda,stroke:#28a745,color:#155724
  style envfiles fill:#d4edda,stroke:#28a745,color:#155724
`}
      />

      <p>
        This is a fundamental step-change: without it, every worktree needs manual setup —
        re-applying patches, recreating config files, re-installing dependencies with the right
        environment. With <strong>iterate</strong>, you fork your exact working state and start
        jamming immediately.
      </p>

      <hr />

      <h2 id="auto-discovery">Auto-discovery</h2>
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
        The <strong><PickIcon size={14} style={{ verticalAlign: "-0.15em", marginRight: "0.1rem" }} /> Pick</strong> and <strong><DiscardIcon size={14} style={{ verticalAlign: "-0.15em", marginRight: "0.1rem" }} /> Discard</strong> toolbar buttons work across both
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

      <h2>Copying uncommitted files into worktrees</h2>
      <p>
        Git worktrees only contain committed files from the current branch. To ensure each iteration
        starts with the same working state as your current checkout, <strong>iterate</strong> automatically
        copies two categories of files from the project root into every new worktree:
      </p>

      <h3>1. Uncommitted changes</h3>
      <p>
        All modified, staged, and untracked files detected by <code>git status</code> are copied into
        each new worktree automatically. This means your in-progress work (edited source files,
        new components, updated configs) is available in every iteration from the start. Deleted files
        are also reflected in the worktree.
      </p>

      <h3>2. Config files (<code>copyFiles</code>)</h3>
      <p>
        Some files like <code>.env.local</code> are gitignored and won&apos;t appear in <code>git status</code>,
        but dev servers still depend on them. The <code>copyFiles</code> config option handles these by
        copying matching files from your project root into each new worktree. By default it copies
        all <code>.env*</code> files:
      </p>
      <CodeBlock
        lang="json"
        filename=".iterate/config.json"
        code={`{
  "copyFiles": [".env*"]
}`}
      />
      <p>
        You can add additional glob patterns for other untracked files your dev server needs:
      </p>
      <CodeBlock
        lang="json"
        filename=".iterate/config.json"
        code={`{
  "copyFiles": [".env*", "credentials/**", "*.local"]
}`}
      />

      <h2>Example session</h2>
      <ol>
        <li>Run <code>/iterate:prompt &quot;Create 3 distinct hero sections&quot;</code> or press the <strong><ForkIcon size={14} style={{ verticalAlign: "-0.15em", marginRight: "0.1rem" }} /> Fork</strong> button on the toolbar.</li>
        <li>Switch between tabs in the toolbar to compare.</li>
        <li>Select elements, annotate what you&apos;d change, drag things around.</li>
        <li>Run <code>/iterate:go</code> in your Claude session — the agent reads all pending changes, implements them, and the dev server hot-reloads.</li>
        <li>Satisfied with an iteration? Press <strong><PickIcon size={14} style={{ verticalAlign: "-0.15em", marginRight: "0.1rem" }} /> Pick</strong> in the toolbar or enter <code>/iterate:keep &lt;tab-name&gt;</code> in your chat session.</li>
        <li>The preferred branch is merged to base and other worktrees are removed. Or use <strong><DiscardIcon size={14} style={{ verticalAlign: "-0.15em", marginRight: "0.1rem" }} /> Discard</strong> in the Original tab to delete all worktrees and keep the base changes.</li>
      </ol>
    </>
  );
}
