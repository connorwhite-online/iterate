import Link from "next/link";
import { CodeBlock } from "@/components/CodeBlock";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { ForkIcon, PickIcon, SendIcon, CopyIcon } from "@/lib/icons";

const iconStyle = { display: "inline-flex" as const, alignItems: "center" as const, gap: "0.2rem" as const, verticalAlign: "middle" as const, position: "relative" as const, top: "-0.075em" as const };

export default function IntroductionPage() {
  return (
    <>
      <h1 style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>
        Parallel iteration, right in your browser.
      </h1>

      <p style={{ fontSize: "1.1rem", color: "var(--color-text-secondary)", marginBottom: "2rem" }}>
        Fork worktrees into tabs, each with a live dev server. Compare directions side by side, annotate what you want changed, and merge your pick back — all from one interface.
      </p>

      <h2>How it works</h2>
      <p>
        <strong>iterate</strong> uses git worktrees to let you explore multiple directions in parallel. Click{" "}
        <strong style={iconStyle}><ForkIcon size={14} /> Fork</strong> in the toolbar to create 3 iteration worktrees from a prompt — each gets its own branch, dependencies, and dev server on a unique port. Tabs appear at the top of the toolbar so you can switch between live previews instantly.
      </p>
      <p>
        When you find a direction you like, click{" "}
        <strong style={iconStyle}><PickIcon size={14} /> Pick</strong> to merge it back to your base branch. All other worktrees are cleaned up automatically.
      </p>
      <p>
        The toolbar also provides context tools — built on foundational agent-interface ideas from the{" "}
        <a href="https://agentation.dev" target="_blank" rel="noopener noreferrer">Agentation</a> team
        (see <Link href="/acknowledgements">Acknowledgements</Link>). Select elements, annotate intent, drag to reposition, and draw with the marker tool. When you&apos;re done, either{" "}
        <strong style={iconStyle}><CopyIcon size={14} /> Copy</strong> the structured context to paste into any AI agent, or{" "}
        <strong style={iconStyle}><SendIcon size={14} /> Send</strong> it directly to a connected agent via MCP. See <Link href="/toolbar">Tools</Link> for details.
      </p>
      <p>
        The agent receives rich context — React component names, source file locations, CSS selectors, computed styles,
        and your natural-language intent — everything it needs to make precise code changes. Your dev server hot-reloads
        and you see results immediately. This is the core interaction loop that makes <strong>iterate</strong> so efficient to interface with.
      </p>

      <h2>Quick start</h2>
      <CodeBlock
        code={`npx skills add connorwhite-online/iterate`}
      />
      <p>
        Then in Claude Code:
      </p>
      <CodeBlock
        code={`/iterate`}
      />
      <p>
        This detects your framework, installs the adapter, and configures the MCP server.
        Run <code>npm run dev</code>, open your app, and you&apos;ll see the overlay.
        See <Link href="/installation">Installation</Link> for the full setup guide.
      </p>

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

      <h2>Packages</h2>
      <table>
        <thead>
          <tr>
            <th>Package</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>iterate-ui-core</code></td><td>Shared types, WebSocket protocol, batch formatter</td></tr>
          <tr><td><code>iterate-ui-cli</code></td><td>CLI commands: init, branch, list, pick, serve, stop</td></tr>
          <tr><td><code>iterate-ui-daemon</code></td><td>Fastify server: worktree manager, reverse proxy, WebSocket hub</td></tr>
          <tr><td><code>iterate-ui-overlay</code></td><td>React overlay: toolbar, selection panel, annotation badges, move tool</td></tr>
          <tr><td><code>iterate-ui-mcp</code></td><td>MCP server for AI agent integration</td></tr>
          <tr><td><code>iterate-ui-vite</code></td><td>Vite plugin — auto-injects overlay in dev mode</td></tr>
          <tr><td><code>iterate-ui-next</code></td><td>Next.js plugin — auto-injects overlay in dev mode</td></tr>
          <tr><td><code>iterate-ui-babel-plugin</code></td><td>Babel plugin — injects component names + source locations</td></tr>
        </tbody>
      </table>
    </>
  );
}
