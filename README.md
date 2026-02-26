# iterate

A visual feedback tool for AI-assisted development. Select elements, annotate intent, drag to reposition — then hand structured context to any AI agent. Powered by git worktrees for parallel design exploration.

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/connorwhite-online/iterate.git
cd iterate
pnpm install

# 2. Build all packages
pnpm run build

# 3. Try the example app
cd examples/vite-app
pnpm install
pnpm run dev
# → opens on http://localhost:5173 with the overlay injected
```

## How it works

```
iterate init              # detect package manager + dev command, create .iterate/ config
iterate branch feature-a  # git worktree + npm install + start dev server on port 3101
iterate branch feature-b  # another worktree on port 3102
iterate serve             # launch daemon on :4000 — opens browser UI
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
3. **Prompt your agent** — in your Claude Code session (or any MCP-connected agent), say "process the pending iterate feedback". The agent calls `iterate_get_pending_batch` or uses the `iterate_process_feedback` prompt to retrieve the full batch with element context.
4. **Agent processes** — acknowledges each annotation, makes code changes, then resolves with a reply. Dev server hot-reloads and you see the result in the overlay immediately.

> **Note:** The Submit button stores the batch centrally and saves you from manual copying, but the agent still needs to be prompted to pick it up. MCP is a tool-pull protocol — the agent must initiate tool calls; the server cannot push work to it.

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
| `@iterate/core` | Shared types, WebSocket protocol, batch prompt formatter |
| `@iterate/cli` | CLI commands: `init`, `branch`, `list`, `pick`, `serve`, `stop` |
| `@iterate/daemon` | Fastify server: worktree manager, process manager, reverse proxy, WebSocket hub, state store |
| `@iterate/overlay` | React overlay: FloatingPanel, SelectionPanel, annotation badges, move tool, marquee select |
| `@iterate/mcp` | MCP server for AI agent integration (Claude Code, Cursor, etc.) |
| `@iterate/vite` | Vite plugin — auto-injects the overlay in dev mode |
| `@iterate/next` | Next.js plugin — auto-injects the overlay in dev mode |
| `@iterate/babel-plugin` | Babel plugin — injects React component names + source locations into JSX for element identification |

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

Register iterate as an MCP server with your agent:

```bash
# Claude Code
claude mcp add iterate -- node /path/to/iterate/packages/mcp/dist/index.js

# Or in .mcp.json for project-level config
{
  "mcpServers": {
    "iterate": {
      "command": "node",
      "args": ["/path/to/iterate/packages/mcp/dist/index.js"]
    }
  }
}
```

The agent can then call tools like `iterate_get_pending_batch` to read your annotations with full element context (React component names, source file locations, CSS selectors, computed styles), and `iterate_pick_iteration` to merge the winning direction.

## Framework Setup

### Vite

```ts
// vite.config.ts
import { iterate } from '@iterate/vite'

export default defineConfig({
  plugins: [react(), iterate()]
})
```

### Next.js

```ts
// next.config.ts
import { withIterate } from '@iterate/next'

export default withIterate(nextConfig)
```

Both plugins auto-inject the overlay in development mode only. No production impact.

## Status

Early prototype / design exploration. The annotation model, batch formatting, and MCP tooling are functional. The daemon and overlay work against example apps but are not yet battle-tested against complex real-world projects.
