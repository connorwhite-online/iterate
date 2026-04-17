# Working on iterate

iterate has two distinct UI surfaces. Conflating them wastes time.

## The two surfaces

### 1. Daemon shell (`http://localhost:<daemonPort>/`, default 47100)

An admin/control view served by `getShellHTML()` in
[`packages/daemon/src/index.ts`](packages/daemon/src/index.ts). Tab bar of
iterations, command input, iframes of iteration dev servers. Mostly for
power users and debugging.

### 2. Overlay on the user's dev server (`http://localhost:3000` or similar)

**This is the primary UX.** A floating panel injected INTO the user's
running Next or Vite app via:
- `withIterate` + `<Iterate />` from `iterate-ui-next` (Next), or
- `iterate()` from `iterate-ui-vite` (Vite), or
- The daemon's HTML proxy injector when serving an iteration under the shell

From the user's perspective: they run `npm run dev` on their own app, open
`http://localhost:3000/`, see their app, and the iterate overlay floats
on top — that's where they select elements, draw feedback, submit changes.

## Which surface to target when making changes

| Change type | Target |
|---|---|
| Polishing iteration management (tabs, shell layout) | Daemon shell |
| Polishing the floating toolbar, selection UI, feedback flow | Overlay on dev server |
| Anything the end user actually sees day-to-day | **Overlay on dev server** |

## How to boot and screenshot the overlay

```bash
pnpm -r build
cd examples/next-15-app
npm run dev            # auto-starts the iterate daemon alongside Next
# then open http://localhost:3000/ in a browser
```

The example apps under `examples/` (`next-15-app`, `next-16-app`,
`vite-app`) are the canonical way to smoke-test.

## Tests and architecture

- **Multi-app monorepo support**: per-app config in `apps[]` (see
  [`packages/core/src/types/config.ts`](packages/core/src/types/config.ts)). Each
  iteration targets one registered app.
- **Daemon auto-port**: writes resolved port to `.iterate/daemon.lock`; CLI,
  MCP, and plugins discover it from there (see
  [`packages/core/src/node.ts`](packages/core/src/node.ts)).
- **Shell HTML is a template literal**: the inline `<script>` inside
  `getShellHTML()` is a string. Escape sequences like `\n` inside JS string
  literals must be written as `\\n` in the TypeScript source (a regression
  test in
  [`packages/daemon/src/__tests__/shell-html.test.ts`](packages/daemon/src/__tests__/shell-html.test.ts)
  validates that the served script parses).
- **Overlay lives in `packages/overlay`** — the floating panel, selection
  tools, annotation UI. Built as a standalone bundle served at
  `/__iterate__/overlay.js`.

## Always-relevant test commands

```bash
pnpm -r build                 # builds all workspace packages
pnpm -r test                  # runs vitest across all packages
pnpm -F iterate-ui-daemon test   # just the daemon
```
