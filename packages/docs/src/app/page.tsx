import Link from "next/link";
import { CodeBlock } from "@/components/CodeBlock";

export default function IntroductionPage() {
  return (
    <>
      <h1 style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>
        Parallel iteration, right in your browser.
      </h1>

      <p style={{ fontSize: "1.1rem", color: "var(--color-text-secondary)", marginBottom: "2rem" }}>
        Fork worktrees into tabs, each with a live dev server. Compare directions side by side, annotate what you want changed, and merge your pick back — all from one interface.
      </p>

      <h2>Dive in</h2>
      <ol>
        <li>
          <strong>Create</strong> iterations (worktrees) from the press of a button, or enter <code>/iterate:prompt</code> in a Claude session followed by whatever you want to riff on.
        </li>
        <li>
          <strong>Compare</strong> iterations instantly from the toolbar tabs, and continue working in parallel as long as you wish.
        </li>
        <li>
          <strong>Pick</strong> a direction and merge it back to your base branch with a single click.
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
        Then in Claude Code:
      </p>
      <CodeBlock
        code={`/iterate`}
      />

    </>
  );
}
