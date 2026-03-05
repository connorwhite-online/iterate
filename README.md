# iterate

Iterate manages git worktrees with an easily navigable toolbar system, allowing you to ideate in parallel easily.

## How it works

1. **Create** iterations (worktrees) from the press of a button, or enter /iterate:prompt in a Claude session followed by whatever you want to riff on.
2. **Compare** iterations instantly from the toolbar tabs, and continue working in parallel as long as you wish.
3. **Pick** a direction and merge it back to your base branch with a single click.
4. **Repeat** as needed whenever you need to riff on an idea!

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

## Docs

Read the full documentation here: [iterate-ui.com](https://iterate-ui.com)

## License

MIT
