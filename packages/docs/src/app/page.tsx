import Link from "next/link";
import { CodeBlock } from "@/components/CodeBlock";

export default function IntroductionPage() {
  return (
    <>
      <h1 style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>
        Parallel iteration, right in your browser.
      </h1>

      <p style={{ fontSize: "1.1rem", color: "var(--color-text-secondary)", marginBottom: "2rem" }}>
        Explore multiple versions of your app simultaneously with agents from a minimal toolbar overlay in your browser.
      </p>

      <video
        src="/iterate-v1.mp4"
        autoPlay
        loop
        muted
        playsInline
        style={{
          width: "100%",
          display: "block",
          borderRadius: "16px",
          marginBottom: "2rem",
        }}
      />

      <h2>How it works</h2>
      <ol>
        <li>
          <strong>Create</strong> iterations (worktrees) from the press of a button, or enter <code>/iterate:prompt</code> in a Claude session followed by whatever you want to riff on.
        </li>
        <li>
          <strong>Explore</strong> iterations instantly from the toolbar tabs.
        </li>
        <li>
          <strong>Add context</strong> with the select, draw and move tools by pointing at elements and areas to add feedback, or moving them around in real-time.
        </li>
        <li>
          <strong>Pick</strong> a direction and merge changes back to your base branch with a single click.
        </li>
        <li>
          <strong>Repeat</strong> as needed whenever you need to riff on an idea!
        </li>
      </ol>
      <p style={{
        background: "var(--color-bg-code)",
        border: "1px solid var(--color-border)",
        borderRadius: "8px",
        padding: "0.75rem 1rem",
        fontSize: "0.95rem",
      }}>
        The toolbar also includes context tools for selecting elements, annotating intent, repositioning, and drawing — built on ideas from the{" "}
        <a href="https://agentation.dev" target="_blank" rel="noopener noreferrer">Agentation</a> team.
        See <Link href="/toolbar">Toolbar</Link> for details.
      </p>

      <h2>Quick start</h2>
      <p>
        This detects your framework, installs the adapter, and configures the MCP server.
        Run <code>npm run dev</code>, open your app, and you&apos;ll see the overlay.
        See <Link href="/installation">Installation</Link> for the full setup guide.
      </p>
      <CodeBlock
        code={`npx skills add connorwhite-online/iterate`}
      />
      <p>
        Open a new Claude Code session to make the slash commands available, then run:
      </p>
      <CodeBlock
        code={`/iterate`}
      />

      <h2>Requirements</h2>
      <ul>
        <li><strong>React</strong> projects using <strong>Next.js</strong> or <strong>Vite</strong></li>
        <li><strong>Claude Code</strong> with MCP support for full agent integration</li>
        <li>Other MCP-compatible agents can connect via the <code>iterate-mcp</code> server</li>
        <li>Without an agent, you can still use the toolbar to select elements, annotate, and copy context manually</li>
      </ul>

    </>
  );
}
