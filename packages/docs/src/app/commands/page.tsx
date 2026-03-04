import type { Metadata } from "next";
import { CodeBlock } from "@/components/CodeBlock";

export const metadata: Metadata = {
  title: "Commands & CLI",
  description: "Claude Code slash commands and CLI tools for managing iterate workflows.",
};

export default function CommandsPage() {
  return (
    <>
      <h1>Commands & CLI</h1>
      <p>
        <strong>iterate</strong> provides slash commands for Claude Code and CLI commands for direct terminal use.
        Both interact with the same daemon and worktree system.
      </p>

      <h2>Claude Code slash commands</h2>
      <p>
        After setup, these commands are available in your Claude Code session:
      </p>

      <table>
        <thead>
          <tr>
            <th>Command</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>/iterate</code></td>
            <td>Set up <strong>iterate</strong> in your project (run once). Detects framework, installs adapter, creates config, and registers the MCP server.</td>
          </tr>
          <tr>
            <td><code>/iterate:prompt &lt;text&gt;</code></td>
            <td>Create multiple variations from a prompt. Each gets a worktree, represented by a tab on the toolbar overlay.</td>
          </tr>
          <tr>
            <td><code>/iterate:go</code></td>
            <td>Fetch all pending UI changes and implement them in the current iteration.</td>
          </tr>
          <tr>
            <td><code>/iterate:keep &lt;name&gt;</code></td>
            <td>Pick the preferred iteration, merge it to the base branch, and clean up the rest.</td>
          </tr>
        </tbody>
      </table>

      <h3>Typical flow</h3>
      <CodeBlock
        lang="text"
        code={`1. Browse your app, use the overlay to annotate feedback
2. Click Send to submit the batch
3. /iterate:go — agent reads annotations, makes code changes
4. Dev server hot-reloads, you see results immediately
5. Repeat until satisfied
6. /iterate:keep v2 — merge the winner`}
      />

      <h2>CLI commands</h2>
      <p>
        These commands are available from your terminal after installing <strong>iterate</strong>:
      </p>

      <table>
        <thead>
          <tr>
            <th>Command</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>iterate init</code></td>
            <td>Detect package manager and dev command, create <code>.iterate/config.json</code></td>
          </tr>
          <tr>
            <td><code>iterate serve</code></td>
            <td>Launch the daemon on port 4000</td>
          </tr>
          <tr>
            <td><code>iterate branch &lt;name&gt;</code></td>
            <td>Create a git worktree, install dependencies, start dev server on a unique port</td>
          </tr>
          <tr>
            <td><code>iterate list</code></td>
            <td>Show all active iterations with their status and ports</td>
          </tr>
          <tr>
            <td><code>iterate pick &lt;name&gt;</code></td>
            <td>Merge the named iteration to main, remove all other worktrees</td>
          </tr>
          <tr>
            <td><code>iterate stop</code></td>
            <td>Shut down the daemon and all running dev servers</td>
          </tr>
        </tbody>
      </table>

      <h3>Examples</h3>
      <CodeBlock
        lang="bash"
        code={`# Start the daemon
iterate serve

# Create two parallel variations
iterate branch hero-minimal
iterate branch hero-bold

# Check what's running
iterate list

# Merge the winner
iterate pick hero-bold

# Clean up
iterate stop`}
      />
    </>
  );
}
