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
        <strong>iterate</strong> supports Next.js and Vite projects. The fastest path is through the Claude Code slash command,
        but you can also set things up manually.
      </p>

      <h2>1. Install skills</h2>
      <p>
        Add the <strong>iterate</strong> slash commands to your Claude Code session:
      </p>
      <CodeBlock
        code={`npx skills add connorwhite-online/iterate`}
      />

      <h2>2. Set up your project</h2>
      <p>
        In Claude Code, run:
      </p>
      <CodeBlock
        code={`/iterate`}
      />
      <p>
        Claude will automatically:
      </p>
      <ul>
        <li>Detect your framework (Next.js or Vite)</li>
        <li>Install the adapter package (<code>iterate-ui-next</code> or <code>iterate-ui-vite</code>)</li>
        <li>Wrap your framework config with the <strong>iterate</strong> plugin</li>
        <li>Create <code>.iterate/config.json</code>, <code>.mcp.json</code>, and register the Claude Code plugin</li>
      </ul>
      <p>
        Restart Claude Code or open a new session to connect the MCP server and slash commands.
      </p>

      <h2>3. Run</h2>
      <CodeBlock
        code={`npm run dev`}
      />
      <p>
        Open your app in the browser — you&apos;ll see the <strong>iterate</strong> overlay. Toggle it with <strong>Cmd+I</strong>.
      </p>

      <hr />

      <h2>Manual setup</h2>
      <p>
        If you prefer to configure things yourself:
      </p>

      <h3>Install</h3>
      <CodeBlock
        code={`npm i iterate-ui`}
      />

      <h3>Initialize</h3>
      <CodeBlock
        code={`npx iterate init`}
      />
      <p>
        This detects your package manager and dev command, then creates <code>.iterate/config.json</code>.
      </p>

      <h3>Next.js</h3>
      <p>
        Wrap your existing config with <code>withIterate</code>:
      </p>
      <CodeBlock
        lang="javascript"
        filename="next.config.mjs"
        code={`import { withIterate } from 'iterate-ui-next'

export default withIterate(nextConfig)`}
      />

      <h3>Vite</h3>
      <p>
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
            <td><code>.claude-plugin</code></td>
            <td>Claude Code plugin configuration for slash commands</td>
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
