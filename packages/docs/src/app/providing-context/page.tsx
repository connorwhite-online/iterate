import type { Metadata } from "next";
import { CodeBlock } from "@/components/CodeBlock";
import { Callout } from "@/components/Callout";

export const metadata: Metadata = {
  title: "Providing Context",
  description: "Two workflows for handing structured feedback to AI agents — copy to clipboard or submit via MCP.",
};

export default function ProvidingContextPage() {
  return (
    <>
      <h1>Providing Context</h1>
      <p>
        <strong>iterate</strong> captures rich, structured context about your UI feedback and provides two ways to
        hand it to an AI agent. Both workflows produce the same information — they differ only in delivery.
      </p>

      <h2>Workflow 1: Copy context</h2>
      <p>
        This works with any AI agent — Claude Code, ChatGPT, Cursor, or anything that accepts text input.
      </p>
      <ol>
        <li><strong>Select elements</strong> — click or marquee-select. The SelectionPanel shows each element with its React component name and source file.</li>
        <li><strong>Annotate</strong> — choose intent (fix / change / question / approve), severity (suggestion / important / blocking), write a comment, and click &quot;Add to batch&quot;.</li>
        <li><strong>Optionally move elements</strong> — switch to Move mode, drag things around. Each move is recorded.</li>
        <li><strong>Copy</strong> — click the Copy button. Structured markdown is placed on your clipboard.</li>
        <li><strong>Paste</strong> — into your agent of choice. The structured context gives it everything it needs.</li>
      </ol>

      <h3>What gets copied</h3>
      <p>
        The Copy button produces structured markdown like this:
      </p>
      <CodeBlock
        lang="markdown"
        code={`# UI Feedback from iterate

**Iteration**: iteration-a

## 1. "Make this button bigger"
- Intent: change | Severity: suggestion
- **Elements** (1):
  - **<Button>** — \`src/components/Hero.tsx:42\`
    Selector: \`.hero-section > button.cta\`
    Size: 120×40 at (300, 500)
    Text: "Get Started"
    Styles: font-size: 14px, padding: 8px 16px, ...

## DOM Changes (1)
- **move** on <NavItem> — \`src/components/Nav.tsx:15\`
  Before: 200×40 at (0, 0) → After: 200×40 at (50, 0)`}
      />

      <h2>Workflow 2: Submit to agent (MCP)</h2>
      <p>
        When you have an MCP-connected agent, you can submit feedback directly:
      </p>
      <ol>
        <li><strong>Same annotation flow</strong> — select, annotate, move, build up a batch.</li>
        <li><strong>Submit</strong> — click the Send button. The batch goes to the daemon via WebSocket.</li>
        <li><strong>Trigger the agent</strong> — in Claude Code, run <code>/iterate:go</code>. The agent fetches annotations, reads source files, implements changes, and resolves each annotation.</li>
        <li><strong>See results</strong> — dev server hot-reloads. Annotations transition from pending to resolved in the overlay.</li>
      </ol>

      <Callout>
        <p>
          MCP is a tool-pull protocol — the agent must initiate tool calls. The <code>/iterate:go</code> slash command
          is the quickest way to trigger processing. The Send button stores the batch centrally so you don&apos;t have to copy/paste.
        </p>
      </Callout>

      <h2>What context gets captured</h2>
      <p>
        For each annotated element, <strong>iterate</strong> captures:
      </p>
      <ul>
        <li><strong>React component name</strong> — injected by the Babel plugin at build time</li>
        <li><strong>Source file location</strong> — file path and line number (e.g. <code>src/components/Hero.tsx:42</code>)</li>
        <li><strong>CSS selector</strong> — a unique selector path to the element</li>
        <li><strong>Computed styles</strong> — font-size, padding, color, background, and other relevant properties</li>
        <li><strong>Bounding box</strong> — width, height, and position on screen</li>
        <li><strong>Text content</strong> — the visible text inside the element</li>
        <li><strong>Text selections</strong> — if you highlighted specific text within an element</li>
      </ul>

      <h2>MCP tools reference</h2>
      <p>
        These tools are available to any MCP-connected agent:
      </p>
      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>iterate_list_iterations</code></td><td>List all active worktrees with status</td></tr>
          <tr><td><code>iterate_create_iteration</code></td><td>Create new worktree variations</td></tr>
          <tr><td><code>iterate_get_pending_batch</code></td><td>Fetch all pending annotations with full DOM context</td></tr>
          <tr><td><code>iterate_get_pending_annotations</code></td><td>List pending items (compact view)</td></tr>
          <tr><td><code>iterate_get_dom_context</code></td><td>Deep dive into one annotation&apos;s element details</td></tr>
          <tr><td><code>iterate_acknowledge_annotation</code></td><td>Mark an annotation as started</td></tr>
          <tr><td><code>iterate_resolve_annotation</code></td><td>Mark as completed with a summary</td></tr>
          <tr><td><code>iterate_dismiss_annotation</code></td><td>Skip with a reason</td></tr>
          <tr><td><code>iterate_get_command_context</code></td><td>Get the design prompt for variation creation</td></tr>
          <tr><td><code>iterate_pick_iteration</code></td><td>Merge the winning direction</td></tr>
          <tr><td><code>iterate_connection_status</code></td><td>Check daemon connection health</td></tr>
          <tr><td><code>iterate_process_feedback</code></td><td>Get formatted batch as an actionable instruction</td></tr>
        </tbody>
      </table>
    </>
  );
}
