# iterate

A Figma-like canvas tool for live web projects, powered by git worktrees. Explore multiple design directions simultaneously, annotate elements, manipulate layouts, and let AI agents generate the code.

## Quick Start (test the example app)

```bash
# 1. Clone and install
git clone https://github.com/connorwhite-online/iterate.git
cd iterate
pnpm install

# 2. Build all packages
pnpm run build

# 3. Try the example app standalone (to see what you'll be iterating on)
cd examples/vite-app
pnpm install
pnpm run dev
# → opens on http://localhost:5173
```

## How iterate works

```
iterate init              # detect package manager + dev command, create .iterate/ config
iterate branch feature-a  # git worktree + npm install + start dev server on port 3101
iterate branch feature-b  # another worktree on port 3102
iterate serve             # launch control server on :4000 — opens browser UI
                          #   → tab bar to switch between iterations
                          #   → annotation overlay (circle + comment)
                          #   → element inspector + drag-to-move
iterate pick feature-a    # merge feature-a to main, remove all other worktrees
iterate stop              # shut down daemon + all dev servers
```

## Testing iterate end-to-end

Once built, you can test the CLI against the example app:

```bash
# From the repo root (after pnpm install && pnpm run build)
cd examples/vite-app

# Initialize iterate in the example app
node ../../packages/cli/dist/index.js init

# Start the daemon (control server + proxy)
node ../../packages/cli/dist/index.js serve

# In another terminal, create iterations:
node ../../packages/cli/dist/index.js branch dark-theme
node ../../packages/cli/dist/index.js branch large-cards

# Open http://localhost:4000 to see the iteration tabs
# Use the toolbar to switch between Select / Annotate / Move modes

# Pick a winner:
node ../../packages/cli/dist/index.js pick dark-theme

# Shut down:
node ../../packages/cli/dist/index.js stop
```

## Packages

| Package | Description |
|---------|-------------|
| `@iterate/core` | Shared types and WebSocket protocol |
| `@iterate/cli` | CLI commands: `init`, `branch`, `list`, `pick`, `serve`, `stop` |
| `@iterate/daemon` | Fastify server: worktree manager, process manager, reverse proxy, WebSocket hub |
| `@iterate/overlay` | React components: SVG annotation canvas, element inspector, drag-to-move |
| `@iterate/mcp` | MCP server for AI agent integration (Claude Code, Cursor, etc.) |

## Architecture

```
CLI (thin orchestrator)
  │
  ▼
Daemon (:4000)
  ├── Worktree Manager (git worktree add/remove/merge via simple-git)
  ├── Process Manager (spawn dev servers via execa, auto-assign ports 3100+)
  ├── Reverse Proxy (/:iteration/* → localhost:port, solves iframe same-origin)
  ├── WebSocket Hub (real-time sync: overlay ↔ daemon ↔ MCP)
  └── State Store (in-memory annotations, iterations, DOM changes)
        │
        ▼
Browser UI (:4000)
  ├── Tab bar (switch between iteration iframes)
  ├── SVG overlay (freehand annotation drawing)
  ├── Element picker (hover highlight, CSS selector capture)
  ├── Drag handler (reposition absolute/flex elements)
  └── Annotation dialog (circle → comment → structured context)
        │
        ▼
MCP Server (sidecar)
  └── Tools: list_iterations, list_annotations, get_dom_context, pick_iteration
```

## MCP Integration

Register iterate with your AI agent:

```bash
claude mcp add iterate -- node /path/to/iterate/packages/mcp/dist/index.js
```

The agent can then call tools like `iterate_list_annotations` to see what you've marked up, and `iterate_create_iteration` to spin up new design directions.

## Status

This is an early prototype / design exploration. The foundation is built and the build system works, but the daemon and overlay are not yet battle-tested against real projects. See the [design plan](https://github.com/connorwhite-online/iterate/blob/main/.claude/plans/) for the full roadmap.
