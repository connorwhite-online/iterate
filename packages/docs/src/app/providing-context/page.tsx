import type { Metadata } from "next";
import { CodeBlock } from "@/components/CodeBlock";
import { MermaidDiagram } from "@/components/MermaidDiagram";
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

      <h2>Workflow 1: Submit to agent (MCP)</h2>
      <p>
        When you have an MCP-connected agent, changes are visible to the agent automatically via MCP tools:
      </p>
      <ol>
        <li><strong>Make changes</strong> — use the select, draw, and move tools to pin-point contextual changes for the agent.</li>
        <li><strong>Trigger the agent</strong> — in Claude Code, run <code>/iterate:go</code>. The agent fetches changes, reads source files, implements them, and resolves each one.</li>
        <li><strong>See results instantly</strong> — dev server hot-reloads. Changes transition from pending to resolved in the overlay.</li>
      </ol>

      <Callout>
        <p>
          MCP is a tool-pull protocol — the agent must initiate tool calls. The <code>/iterate:go</code> slash command
          is the quickest way to trigger processing. Changes are available to the MCP automatically, no extra step needed.
        </p>
      </Callout>

      <h2>Workflow 2: Copy context</h2>
      <p>
        This works with any AI agent — Claude Code, ChatGPT, Cursor, or anything that accepts text input.
      </p>
      <ol>
        <li><strong>Make changes</strong> — use the select, draw, and move tools to pin-point contextual changes for the agent.</li>
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

      <h2>Architecture</h2>
      <MermaidDiagram
        code={`graph TD
  CLI("CLI")
  CLI --> Daemon

  subgraph Daemon[" Daemon :4000 "]
    direction LR
    D1("Worktree Mgr") --- D2("Process Mgr") --- D3("Proxy") --- D4("WebSocket") --- D5("State")
  end

  Daemon --> Overlay

  subgraph Overlay[" Browser Overlay "]
    direction LR
    O1("Toolbar") --- O2("Selection") --- O3("Move") --- O4("Tabs")
  end

  Overlay --> MCP

  subgraph MCP[" MCP Server "]
    direction LR
    M1("Tools") --- M2("Prompts")
  end`}
      />

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
          <tr><td><code>iterate_list_iterations</code></td><td>List all active iterations (worktrees with dev servers)</td></tr>
          <tr><td><code>iterate_create_iteration</code></td><td>Create a new iteration (git worktree + dev server)</td></tr>
          <tr><td><code>iterate_pick_iteration</code></td><td>Pick a winning iteration — merge to base and remove all others</td></tr>
          <tr><td><code>iterate_remove_iteration</code></td><td>Remove a specific iteration</td></tr>
          <tr><td><code>iterate_list_changes</code></td><td>List all user-submitted changes with elements, components, and status</td></tr>
          <tr><td><code>iterate_get_dom_context</code></td><td>Get full DOM context for a specific change</td></tr>
          <tr><td><code>iterate_start_change</code></td><td>Mark a change as in-progress</td></tr>
          <tr><td><code>iterate_implement_change</code></td><td>Mark a change as implemented with a summary</td></tr>
          <tr><td><code>iterate_get_pending_changes</code></td><td>Get all queued changes that need attention</td></tr>
          <tr><td><code>iterate_get_pending_batch</code></td><td>Get all queued changes and DOM changes from the latest batch</td></tr>
          <tr><td><code>iterate_get_command_context</code></td><td>Get the context for the latest /iterate command</td></tr>
          <tr><td><code>iterate_connection_status</code></td><td>Check daemon connection health</td></tr>
        </tbody>
      </table>
    </>
  );
}
