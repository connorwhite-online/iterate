# iterate

A visual feedback tool for AI-assisted development. Select elements, annotate intent, drag to reposition — then hand structured context to any AI agent. Powered by git worktrees for parallel design exploration.

## Quick Start

### Install

```bash
npm install -D iterate
```

### Setup

```bash
npx iterate init
```

This creates:
- `.iterate/config.json` — auto-detects your package manager and dev command
- `.mcp.json` — registers the iterate MCP server for Claude Code

### Framework Config

**Next.js:**
```js
// next.config.mjs
import { withIterate } from 'iterate-ui-next'

const nextConfig = {}
export default withIterate(nextConfig)
```

**Vite:**
```ts
// vite.config.ts
import { iterate } from 'iterate-ui-vite'

export default defineConfig({
  plugins: [react(), iterate()]
})
```

Both plugins auto-inject the overlay and start the daemon in development mode only. No production impact.

### Run

```bash
npm run dev
```

Open your app in the browser — you'll see the iterate overlay (toggle with **Alt+Shift+I**).

## Claude Code Slash Commands

After setup, three slash commands are available in your Claude Code session:

| Command | What it does |
|---------|-------------|
| `/iterate:go` | Fetch all pending UI annotations and implement them |
| `/iterate:prompt <text>` | Create multiple variations from a design prompt |
| `/iterate:keep <name>` | Pick a winning iteration and merge it to your base branch |

### Typical flow

1. Browse your app, use the overlay to select elements, annotate feedback, drag things around
2. Click **Send** to submit the batch
3. In Claude Code, type `/iterate:go` — Claude reads your annotations, makes the code changes, and resolves each one
4. Dev server hot-reloads, you see the results immediately
5. Repeat until satisfied, then `/iterate:keep v2` to merge the winner

## CLI Commands

```
iterate init              # detect package manager + dev command, create config
iterate serve             # launch daemon on :4000
iterate branch feature-a  # git worktree + npm install + start dev server on port 3101
iterate branch feature-b  # another worktree on port 3102
iterate list              # show all active iterations with status
iterate pick feature-a    # merge feature-a to main, remove all other worktrees
iterate stop              # shut down daemon + all dev servers
```

## The Toolbar

The overlay injects a floating panel (bottom-right, draggable to any corner, toggle with **Alt+Shift+I**):

```
┌──────────────────────────────────────────────────────────────┐
│  [iteration-a] [iteration-b]              ← iteration tabs   │
│──────────────────────────────────────────────────────────────│
│  [Select][Move] │ [Preview][Undo] 3 │ [Send][Copy][Clear] │×│
│   tool modes    │  move controls    │  batch actions       │ │
└──────────────────────────────────────────────────────────────┘
```

- **Iteration tabs** — only visible with multiple iterations. Colored dot shows status (green=ready, yellow=starting, red=error). Click to switch which iteration iframe is displayed.
- **Select / Move** — tool modes. Select to click or marquee-select elements for annotation. Move to drag elements to new positions.
- **Move controls** — appear when moves are pending. Preview toggle, undo last move, and a badge with pending count.
- **Batch actions** — appear when anything is pending (annotations + moves > 0). Send submits to the daemon (for MCP-connected agents). Copy formats everything as markdown for clipboard. Clear discards pending work.

## Workflows

### Workflow 1: Copy Context (works with any agent)

1. **Select elements** — click or marquee-select. The SelectionPanel slides in from the right showing each element with its React component name and source file location.
2. **Annotate** — choose an intent (fix / change / question / approve), severity (suggestion / important / blocking), write a comment, and click "Add to batch" (or Cmd+Enter). Gold numbered badges appear on annotated elements.
3. **Optionally move elements** — switch to Move mode, drag things around. Each move is recorded in the pending batch.
4. **Copy** — click the Copy button. This produces structured markdown with all element context:

```markdown
# UI Feedback from iterate

**Iteration**: iteration-a

## 1. "Make this button bigger"
- Intent: change | Severity: suggestion
- **Elements** (1):
  - **<Button>** — `src/components/Hero.tsx:42`
    Selector: `.hero-section > button.cta`
    Size: 120×40 at (300, 500)
    Text: "Get Started"
    Styles: font-size: 14px, padding: 8px 16px, ...

## DOM Changes (1)
- **move** on <NavItem> — `src/components/Nav.tsx:15`
  Before: 200×40 at (0, 0) → After: 200×40 at (50, 0)
```

5. **Paste** into Claude Code, ChatGPT, Cursor, or any agent. The structured context gives it everything needed to make the changes.

### Workflow 2: Submit to Agent (MCP-connected)

1. **Same annotation flow** — select, annotate, move, build up a batch.
2. **Submit** — click the Send button. The batch is sent to the daemon over WebSocket, which stores annotations as `pending` and broadcasts to all connected clients.
3. **Trigger the agent** — in your Claude Code session, type `/iterate:go`. Claude fetches all pending annotations, acknowledges each one, reads the source files, implements the changes, and resolves each annotation with a summary.
4. **See results** — dev server hot-reloads and you see the changes in the browser immediately. The overlay shows annotations transitioning from pending to resolved.

> **Note:** The Submit button stores the batch centrally and saves you from manual copying, but the agent still needs to be triggered to pick it up. MCP is a tool-pull protocol — the agent must initiate tool calls. The `/iterate:go` slash command is the quickest way to kick this off.

## The Iterate Lifecycle

### 1. Create iterations from a prompt

Tell the daemon to create N worktrees (e.g. "3 hero section variations"). Each gets its own git branch, `npm install`, and dev server on a unique port. The MCP-connected agent calls `iterate_get_command_context` to learn what to build, then makes different code changes in each worktree.

### 2. Review and annotate

Switch between iteration tabs in the toolbar to compare variations. Select elements, add annotations, drag things around. Each annotation is scoped to the active iteration.

### 3. Continue prompting

Submit or copy feedback → agent processes it → makes more changes → dev server hot-reloads → you see results in the iframe. Repeat as many times as needed.

### 4. Pick a winner

Once you favor a direction, the agent calls `iterate_pick_iteration` with a merge strategy (merge / squash / rebase). The winning branch merges back to the base branch; all other worktrees and branches are removed. You're left with a single codebase.

## Packages

| Package | Description |
|---------|-------------|
| `iterate-ui-core` | Shared types, WebSocket protocol, batch prompt formatter |
| `iterate-ui-cli` | CLI commands: `init`, `branch`, `list`, `pick`, `serve`, `stop` |
| `iterate-ui-daemon` | Fastify server: worktree manager, process manager, reverse proxy, WebSocket hub, state store |
| `iterate-ui-overlay` | React overlay: FloatingPanel, SelectionPanel, annotation badges, move tool, marquee select |
| `iterate-ui-mcp` | MCP server for AI agent integration (Claude Code, Cursor, etc.) |
| `iterate-ui-vite` | Vite plugin — auto-injects the overlay in dev mode |
| `iterate-ui-next` | Next.js plugin — auto-injects the overlay in dev mode |
| `iterate-ui-babel-plugin` | Babel plugin — injects React component names + source locations into JSX for element identification |

## Architecture

```
CLI (thin orchestrator)
  │
  ▼
Daemon (:4000)
  ├── Worktree Manager (git worktree add/remove/merge via simple-git)
  ├── Process Manager (spawn dev servers via execa, auto-assign ports 3100+)
  ├── Reverse Proxy (/:iteration/* → localhost:port)
  ├── WebSocket Hub (real-time sync: overlay ↔ daemon ↔ MCP)
  └── State Store (in-memory: iterations, annotations, DOM changes, command context)
        │
        ▼
Browser Overlay (injected via Vite/Next plugin)
  ├── FloatingPanel (toolbar: tool modes, move controls, batch actions)
  ├── SelectionPanel (element list with component names + source locations)
  ├── Annotation form within SelectionPanel (intent, severity, comment → structured batch entry)
  ├── Marquee select + click select (multi-element selection)
  ├── Move tool (drag-to-reposition with preview toggle)
  └── Iteration tabs (switch between worktree iframes)
        │
        ▼
MCP Server (stdio sidecar to your agent)
  ├── Tools: iterate_list_iterations, iterate_get_pending_batch,
  │          iterate_acknowledge_annotation, iterate_resolve_annotation,
  │          iterate_pick_iteration, iterate_create_iteration, ...
  └── Prompts: iterate_process_feedback (formatted batch as actionable prompt)
```

## MCP Integration

`iterate init` automatically generates a `.mcp.json` that registers the MCP server with Claude Code:

```json
{
  "mcpServers": {
    "iterate": {
      "command": "npx",
      "args": ["iterate-mcp"],
      "env": { "ITERATE_DAEMON_PORT": "4000" }
    }
  }
}
```

If you're using a different MCP-compatible agent, point it at the `iterate-mcp` binary. The agent can call tools like `iterate_get_pending_batch` to read annotations with full element context (React component names, source file locations, CSS selectors, computed styles), and `iterate_pick_iteration` to merge the winning direction.

## Status

Early prototype / design exploration. The annotation model, batch formatting, and MCP tooling are functional. The daemon and overlay work against example apps but are not yet battle-tested against complex real-world projects.
