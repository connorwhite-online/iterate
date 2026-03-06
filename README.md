<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/logo.svg">
  <img alt="iterate" src="assets/logo.svg" height="48">
</picture>

Explore multiple versions of your app simultaneously with agents from a minimal toolbar overlay in your browser.

## How it works

1. **Create** iterations (worktrees) from the press of a button, or enter /iterate:prompt in a Claude session followed by whatever you want to riff on.
2. **Explore** iterations instantly from the toolbar tabs.
3. **Add context** — use the select, draw, and move tools by pointing at elements and areas to add feedback, or moving them around in real-time.
4. **Pick** a direction and merge changes back to your base branch with a single click.
5. **Repeat** as needed whenever you need to riff on an idea!

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
