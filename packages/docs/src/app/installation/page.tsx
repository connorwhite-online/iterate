import type { Metadata } from "next";
import { CodeBlock } from "@/components/CodeBlock";
import { Callout } from "@/components/Callout";

export const metadata: Metadata = {
  title: "Installation",
  description: "Set up iterate in your Next.js or Vite project with a single slash command or manual configuration.",
};

export default function InstallationPage() {
  return (
    <>
      <h1>Installation</h1>
      <p>
        <strong>iterate</strong> works with React projects using Next.js or Vite. The fastest path is through the Claude Code slash command,
        but you can also set things up manually.
      </p>

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

      <h2>Manual setup</h2>
      <p>
        If you prefer to configure things yourself:
      </p>

      <h3 style={{ marginTop: "1rem" }}>Install</h3>
      <CodeBlock
        code={`npm i iterate-ui`}
      />

      <h3 style={{ marginTop: "1rem" }}>Initialize</h3>
      <CodeBlock
        code={`npx iterate init`}
      />
      <p style={{ marginBottom: "0.5rem" }}>
        This detects your package manager and dev command, then creates <code>.iterate/config.json</code>.
      </p>

      <h3 style={{ marginTop: "1rem" }}>Next.js 14–15 (webpack)</h3>
      <p style={{ marginBottom: "0.5rem" }}>
        Wrap your existing config with <code>withIterate</code>. The overlay auto-injects via webpack:
      </p>
      <CodeBlock
        lang="javascript"
        filename="next.config.mjs"
        code={`import { withIterate } from 'iterate-ui-next'

export default withIterate(nextConfig)`}
      />

      <h3 style={{ marginTop: "1rem" }}>Next.js 16+ (Turbopack)</h3>
      <p style={{ marginBottom: "0.5rem" }}>
        Next.js 16 defaults to Turbopack, which doesn&apos;t support webpack entry injection.
        Wrap your config the same way, then add the devtools component to your root layout:
      </p>
      <CodeBlock
        lang="javascript"
        filename="next.config.mjs"
        code={`import { withIterate } from 'iterate-ui-next'

export default withIterate(nextConfig)`}
      />
      <CodeBlock
        lang="tsx"
        filename="app/layout.tsx"
        code={`import { IterateDevTools } from "iterate-ui-next/devtools"

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <IterateDevTools />
      </body>
    </html>
  )
}`}
      />
      <Callout>
        <p>
          Alternatively, you can run <code>next dev --webpack</code> to use webpack instead of Turbopack, which allows the overlay to auto-inject without the manual component.
        </p>
      </Callout>

      <h3 style={{ marginTop: "1rem" }}>Vite</h3>
      <p style={{ marginBottom: "0.5rem" }}>
        Add the <code>iterate()</code> plugin:
      </p>
      <CodeBlock
        lang="typescript"
        filename="vite.config.ts"
        code={`import { iterate } from 'iterate-ui-vite'

export default defineConfig({
  plugins: [react(), iterate()]
})`}
      />

      <Callout>
        <p>
          Both plugins auto-inject the overlay and start the daemon in development mode only.
          There is no production impact.
        </p>
      </Callout>

      <h2>What gets created</h2>
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>.iterate/config.json</code></td>
            <td>Project configuration (package manager, dev command, port)</td>
          </tr>
          <tr>
            <td><code>.mcp.json</code></td>
            <td>Registers the <strong>iterate</strong> MCP server with Claude Code</td>
          </tr>
          <tr>
            <td><code>.claude/settings.json</code></td>
            <td>Registers the iterate plugin so slash commands are available</td>
          </tr>
        </tbody>
      </table>

      <h2>MCP configuration</h2>
      <p>
        The <code>.mcp.json</code> file registers the MCP server so your agent can interact with <strong>iterate</strong>:
      </p>
      <CodeBlock
        lang="json"
        filename=".mcp.json"
        code={`{
  "mcpServers": {
    "iterate": {
      "command": "npx",
      "args": ["iterate-mcp"],
      "env": { "ITERATE_DAEMON_PORT": "4000" }
    }
  }
}`}
      />
      <p>
        If you&apos;re using a different MCP-compatible agent, point it at the <code>iterate-mcp</code> binary.
      </p>

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
