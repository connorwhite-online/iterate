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

      <div style={{
        borderRadius: "16px",
        border: "1px solid var(--color-border)",
        overflow: "hidden",
        marginBottom: "2rem",
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px 14px",
          background: "var(--color-bg-code)",
          borderBottom: "1px solid var(--color-border)",
        }}>
          <div style={{ display: "flex", gap: "6px", marginRight: "4px" }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--color-border)" }} />
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--color-border)" }} />
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--color-border)" }} />
          </div>
          <div style={{
            width: "75%",
            background: "var(--color-bg)",
            borderRadius: "6px",
            padding: "2px 8px",
            fontSize: "9px",
            fontFamily: "var(--font-mono)",
            color: "var(--color-text-secondary)",
          }}>
            localhost:3000
          </div>
        </div>
        <video
          src="/iterate-v1.mp4"
          autoPlay
          loop
          muted
          playsInline
          style={{
            width: "100%",
            display: "block",
          }}
        />
      </div>

      <h2>How to iterate</h2>
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
