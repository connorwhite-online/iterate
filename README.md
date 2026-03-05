# iterate

Iterate manages git worktrees with an easily navigable toolbar system, allowing you to ideate in parallel easily.

## Quick Start

With [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills):

```bash
npx skills add connorwhite-online/iterate
```

Then in Claude Code, run `/iterate` — it detects your framework, installs the adapter, and configures everything.

### Manual setup

```bash
npm i iterate-ui
```

**Next.js** (`next.config.mjs`):
```js
import { withIterate } from 'iterate-ui-next'
export default withIterate(nextConfig)
```

**Vite** (`vite.config.ts`):
```ts
import { iterate } from 'iterate-ui-vite'
export default defineConfig({ plugins: [react(), iterate()] })
```

## How it works

1. **Fork** — spin up parallel worktrees, each with its own branch, install, and dev server
2. **Compare** — switch between live variations in the browser toolbar
3. **Annotate** — select elements and submit feedback directly to your AI agent
4. **Pick** — merge the winner back to your base branch, clean up the rest

## Docs

[iterate-ui.com](https://iterate-ui.com)

## License

PolyForm Shield 1.0.0
