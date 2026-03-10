---
name: iterate
description: Set up iterate in the current project. Detects your framework, installs the package, wires it into your config, and configures the MCP server.
disable-model-invocation: true
---

Set up iterate in the user's project. This skill detects the framework, installs the right adapter, configures everything, and gets the user ready to go.

## Steps

1. **Detect the framework.** Look at the project's dependencies in `package.json`:
   - **Next.js**: Has `next` in dependencies or devDependencies → use `iterate-ui-next`
   - **Vite**: Has `vite` in dependencies or devDependencies → use `iterate-ui-vite`
   - If both are present, ask the user which one to configure
   - If neither is found, tell the user iterate currently supports Next.js and Vite, and stop

2. **Detect the package manager.** Check for lock files in the project root:
   - `pnpm-lock.yaml` → pnpm
   - `bun.lockb` or `bun.lock` → bun
   - `yarn.lock` → yarn
   - Otherwise → npm

3. **Install the adapter package** as a dev dependency using the detected package manager:
   - pnpm: `pnpm add -D <package>`
   - bun: `bun add -D <package>`
   - yarn: `yarn add -D <package>`
   - npm: `npm install -D <package>`

4. **Wire into the framework config.** Read the existing config file and add the iterate wrapper:

   **Next.js** (`next.config.mjs`, `next.config.js`, or `next.config.ts`):
   - Add `import { withIterate } from "iterate-ui-next"` at the top
   - Wrap the default export with `withIterate()`:
     ```js
     export default withIterate(nextConfig);
     ```
   - If the config already uses `withIterate`, skip this step
   - **Add the Iterate component**: Find the root layout file (`app/layout.tsx` or `app/layout.jsx`) and add:
     ```tsx
     import { Iterate } from "iterate-ui-next/devtools";
     ```
     Then render `<Iterate />` inside `<body>`, after `{children}`.
     If the layout already has `<Iterate />`, skip this step.

   **Vite** (`vite.config.ts`, `vite.config.js`, or `vite.config.mjs`):
   - Add `import { iterate } from "iterate-ui-vite"` at the top
   - Add `iterate()` to the `plugins` array:
     ```js
     plugins: [react(), iterate()]
     ```
   - If the config already uses `iterate()`, skip this step

5. **Create `.iterate/config.json`** if it doesn't exist. Detect the dev command from `package.json` scripts (prefer `dev`, fallback to `start`):
   ```json
   {
     "devCommand": "<detected dev command>",
     "packageManager": "<detected package manager>",
     "basePort": 3100,
     "daemonPort": 4000,
     "maxIterations": 3,
     "idleTimeout": 0
   }
   ```

6. **Create `.mcp.json`** for Claude Code MCP integration if it doesn't exist. If it already exists, check whether it already has an `iterate` server entry — if not, add one:
   ```json
   {
     "mcpServers": {
       "iterate": {
         "command": "npx",
         "args": ["iterate-ui-mcp"],
         "env": {
           "ITERATE_DAEMON_PORT": "4000"
         }
       }
     }
   }
   ```

7. **Add `.iterate` to `.gitignore`** if not already present. Create `.gitignore` if it doesn't exist.

8. **Register the Claude Code plugin** in `.claude/settings.json` so the iterate skills (`/iterate:go`, `/iterate:prompt`, `/iterate:keep`) are available. Create the file if it doesn't exist, or merge into the existing settings:
   ```json
   {
     "extraKnownMarketplaces": {
       "iterate-plugins": {
         "source": {
           "source": "github",
           "repo": "connorwhite-online/iterate"
         }
       }
     },
     "enabledPlugins": {
       "iterate@iterate-plugins": true
     }
   }
   ```

9. **Summarize.** Tell the user what was set up and what to do next:
   - Restart Claude Code to activate the MCP server and slash commands
   - Available slash commands: `/iterate:prompt`, `/iterate:go`, `/iterate:keep`
   - The iterate overlay will appear automatically when their dev server runs
