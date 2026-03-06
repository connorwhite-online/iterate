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
npx iterate init
```

#### Next.js 14–15 (Webpack)

Wrap your existing config:

```js
// next.config.mjs
import { withIterate } from 'iterate-ui-next'

export default withIterate(nextConfig)
```

The overlay auto-injects through webpack — no additional setup needed.

#### Next.js 16+ (Turbopack)

Next.js 16 defaults to Turbopack, which doesn't support webpack injection. Use the same config wrapper, then add the DevTools component to your root layout:

```js
// next.config.mjs
import { withIterate } from 'iterate-ui-next'

export default withIterate(nextConfig)
```

```tsx
// app/layout.tsx
import { IterateDevTools } from "iterate-ui-next/devtools"

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <IterateDevTools />
      </body>
    </html>
  )
}
```

Alternatively, run `next dev --webpack` to use webpack instead, enabling auto-injection without the manual component.

#### Vite

```ts
// vite.config.ts
import { iterate } from 'iterate-ui-vite'

export default defineConfig({ plugins: [react(), iterate()] })
```

## Docs

Read the full documentation here: [iterate-ui.com](https://iterate-ui.com)

## License

MIT
