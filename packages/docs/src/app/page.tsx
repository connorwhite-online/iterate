import Link from "next/link";
import { CodeBlock } from "@/components/CodeBlock";
import { VideoPlayer } from "@/components/VideoPlayer";

export default function IntroductionPage() {
  return (
    <>
      <h1 style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>
        Iterate on designs, right in your browser.
      </h1>

      <p style={{ fontSize: "1.1rem", color: "var(--color-text-secondary)", marginBottom: "2rem" }}>
        Explore multiple versions of your app simultaneously with agents from a minimal toolbar overlay in your browser.
      </p>

      <VideoPlayer src="/iterate-v1.mp4" aspectRatio="1940 / 1080" />

      <style>{`
        @keyframes mascotWalk {
          0%    { left: 75%; transform: translateX(-50%) translateY(-100%) scaleX(1); }
          10%   { left: 75%; transform: translateX(-50%) translateY(-100%) scaleX(1); animation-timing-function: ease-in-out; }
          20%   { left: 88%; transform: translateX(-50%) translateY(-100%) scaleX(1); animation-timing-function: steps(1); }
          20.1% { left: 88%; transform: translateX(-50%) translateY(-100%) scaleX(-1); }
          30%   { left: 88%; transform: translateX(-50%) translateY(-100%) scaleX(-1); animation-timing-function: ease-in-out; }
          45%   { left: 55%; transform: translateX(-50%) translateY(-100%) scaleX(-1); animation-timing-function: steps(1); }
          45.1% { left: 55%; transform: translateX(-50%) translateY(-100%) scaleX(1); }
          55%   { left: 55%; transform: translateX(-50%) translateY(-100%) scaleX(1); animation-timing-function: ease-in-out; }
          65%   { left: 78%; transform: translateX(-50%) translateY(-100%) scaleX(1); animation-timing-function: steps(1); }
          65.1% { left: 78%; transform: translateX(-50%) translateY(-100%) scaleX(-1); }
          75%   { left: 78%; transform: translateX(-50%) translateY(-100%) scaleX(-1); animation-timing-function: ease-in-out; }
          85%   { left: 60%; transform: translateX(-50%) translateY(-100%) scaleX(-1); animation-timing-function: steps(1); }
          85.1% { left: 60%; transform: translateX(-50%) translateY(-100%) scaleX(1); }
          92%   { left: 60%; transform: translateX(-50%) translateY(-100%) scaleX(1); animation-timing-function: ease-in-out; }
          100%  { left: 75%; transform: translateX(-50%) translateY(-100%) scaleX(1); }
        }
        @keyframes legA {
          0%,10%,12%,14%,16%,18%,20%,30%,32%,34%,36%,38%,40%,42%,44%,45%,55%,57%,59%,61%,63%,65%,75%,77%,79%,81%,83%,85%,92%,94%,96%,98%,100% { transform: translateY(0); }
          11%,13%,15%,17%,19%,31%,33%,35%,37%,39%,41%,43%,56%,58%,60%,62%,64%,76%,78%,80%,82%,84%,93%,95%,97%,99% { transform: translateY(-6px); }
        }
        @keyframes legB {
          0%,10%,11%,13%,15%,17%,19%,20%,30%,31%,33%,35%,37%,39%,41%,43%,45%,55%,56%,58%,60%,62%,64%,65%,75%,76%,78%,80%,82%,84%,85%,92%,93%,95%,97%,99%,100% { transform: translateY(0); }
          12%,14%,16%,18%,32%,34%,36%,38%,40%,42%,44%,57%,59%,61%,63%,77%,79%,81%,83%,94%,96%,98% { transform: translateY(-6px); }
        }
        .claude-mascot-walk {
          position: absolute;
          top: -1px;
          animation: mascotWalk 24s ease-in-out infinite;
          z-index: 1;
          cursor: pointer;
        }
        .claude-mascot-walk .leg-1,
        .claude-mascot-walk .leg-4 {
          animation: legA 24s linear infinite;
        }
        .claude-mascot-walk .leg-2,
        .claude-mascot-walk .leg-3 {
          animation: legB 24s linear infinite;
        }
        .claude-mascot-walk .eye-expr {
          opacity: 0;
        }
        .claude-mascot-walk:hover .eye-normal,
        .claude-mascot-walk:active .eye-normal {
          opacity: 0;
        }
        .claude-mascot-walk:hover .eye-expr,
        .claude-mascot-walk:active .eye-expr {
          opacity: 1;
        }
      `}</style>

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

      <p style={{ fontSize: "0.95rem", color: "var(--color-text-secondary)" }}>
        Optimized for <strong style={{ color: "var(--color-text)" }}>Claude Code</strong> with <strong style={{ color: "var(--color-text)" }}>Next.js</strong>, but works with any agent and all React apps using Vite.
      </p>

      <h2 style={{ marginBottom: "0.5rem", color: "hsl(15, 63.1%, 59.6%)" }}>Claude Code setup</h2>
      <div style={{
        position: "relative",
        border: "1px solid var(--color-border)",
        borderRadius: "12px",
        padding: "0.75rem 1.25rem",
      }}>
        <div className="claude-mascot-walk">
          <svg width="48" height="38" viewBox="0 0 66 52" fill="none" style={{ display: "block" }}>
            {/* Body */}
            <rect x="6" y="0" width="54" height="39" fill="hsl(15, 63.1%, 59.6%)" />
            {/* Arm stubs */}
            <rect x="0" y="13" width="6" height="13" fill="hsl(15, 63.1%, 59.6%)" />
            <rect x="60" y="13" width="6" height="13" fill="hsl(15, 63.1%, 59.6%)" />
            {/* Normal eyes */}
            <rect className="eye-normal" x="12" y="13" width="6" height="6.5" fill="black" />
            <rect className="eye-normal" x="48" y="13" width="6" height="6.5" fill="black" />
            {/* Expression eyes (> <) */}
            <path className="eye-expr" d="M12,13 L18,16.25 L12,19.5" fill="none" stroke="black" strokeWidth="2.5" />
            <path className="eye-expr" d="M54,13 L48,16.25 L54,19.5" fill="none" stroke="black" strokeWidth="2.5" />
            {/* Legs - two pairs flush to body edges */}
            <rect className="leg-1" x="6" y="39" width="6" height="13" fill="hsl(15, 63.1%, 59.6%)" />
            <rect className="leg-2" x="18" y="39" width="6" height="13" fill="hsl(15, 63.1%, 59.6%)" />
            <rect className="leg-3" x="42" y="39" width="6" height="13" fill="hsl(15, 63.1%, 59.6%)" />
            <rect className="leg-4" x="54" y="39" width="6" height="13" fill="hsl(15, 63.1%, 59.6%)" />
          </svg>
        </div>
        <ol style={{ margin: 0, paddingLeft: "1.25rem" }}>
          <li>Install the skill:
            <CodeBlock code={`npx skills add connorwhite-online/iterate`} />
          </li>
          <li>Restart your Claude Code session to load the new slash commands, then run:
            <CodeBlock code={`/iterate`} />
          </li>
          <li style={{ color: "var(--color-text-secondary)" }}>
            You&apos;re all set! With your app running, restart your Claude session again to connect the MCP server.
          </li>
        </ol>
      </div>
      <p style={{ marginTop: "8px", marginBottom: 0, fontSize: "0.85rem", color: "var(--color-text-secondary)", paddingLeft: "1.25rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        Checkout other <Link href="/installation">Installation</Link> options.
      </p>

    </>
  );
}
