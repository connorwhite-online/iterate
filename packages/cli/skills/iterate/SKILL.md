---
name: iterate
description: Set up iterate in the current project. Detects one or more React apps (Next or Vite) in a monorepo, discovers dev-script quirks and env files, wires up the adapter, and configures the MCP server.
disable-model-invocation: true
---

Set up iterate in the user's project. This skill handles anything from a greenfield Next.js app to a mature monorepo with custom dev-script wrappers, shared env files, and multiple React apps.

## Approach

Don't treat this as a linear install script — treat it as an investigation. At each step, prefer concrete evidence from the repo over assumptions. Ask the user to confirm choices when ambiguous; do the obvious thing silently when unambiguous.

## Steps

### 1. Find all React apps in the repo

Start from the repo root (the directory the user invoked the skill from — confirm with `git rev-parse --show-toplevel`).

Glob for `**/package.json`, excluding `node_modules/**`, `.next/**`, `dist/**`, `build/**`. For each one, read its `dependencies` + `devDependencies` and classify:

- Depends on `next` → Next.js app
- Depends on `vite` → Vite app
- Otherwise → skip (library, backend service, etc.)

If you find **zero** apps, tell the user iterate currently supports Next.js and Vite only, and stop.

If you find **one** app, proceed with it (no need to prompt).

If you find **multiple**, list them with their paths and frameworks, then ask the user which one(s) they want to register. They can pick one now and re-run the skill later for others. Each iteration of the skill adds an entry to the same `.iterate/config.json`.

### 2. For each chosen app, investigate its dev script

Read the app's `package.json` `scripts.dev` (or `scripts.start` as fallback). Classify what you find:

**Plain command** (e.g., `next dev`, `vite`, `vite --host`):
- No wrapper. iterate can append `-p <port>` or `--port <port>` directly. Leave `portEnvVar` unset in config.

**Wrapped command** — look for any of these prefixes/words:
- `dotenv-cli` / `dotenv` (CLI form)
- `env-cmd`
- `cross-env`
- `doppler run`
- `op run` (1Password)
- `direnv exec`
- A custom runner like `env-cmd.ts`, `scripts/dev.ts`, `bun run` on a TS file

For wrapped commands, iterate must NOT mutate the command string. Instead, find the **port env var** the script uses:
- Look for `PORT=$FOO`, `--port $FOO`, `-p $FOO`, `--port ${FOO}`, `PORT=%FOO%` in the script value.
- If the script reads from `process.env.FOO` or similar in a custom TS/JS runner, look inside that runner file.
- If you genuinely can't tell, ask the user: "Which env var does your dev script read for its port?"

Set that var name as the app's `portEnvVar`.

### 3. Find env files

Look for dotenv files at likely locations, in roughly this priority:

1. Repo root: `.env`, `.env.local`, `.env.development`, `.env.development.local`, `.env.development.pre`, `.env.shared`
2. App directory: same names
3. Any other `.env*` files the dev script or project docs reference

For each candidate, open it and check: does it actually contain values the app would need? In particular, does it set the `portEnvVar` you identified in step 2? A `.env.example` or `.env.template` with only placeholder names is NOT useful — skip those.

Present the ordered list of `envFiles` you want to put in config and ask the user to confirm or edit. Paths are relative to the repo root.

### 4. Detect basePath

**Next.js**: read `next.config.{js,mjs,ts}`. Look for a top-level `basePath: "..."`. If found, record it.

**Vite**: read `vite.config.{js,mjs,ts}`. Look for `base: "..."` in the `defineConfig` call. If found, record it (omit if it's `"/"` — that's the default).

If a basePath is set, record it in the app entry so the overlay-injection and iteration proxy routes are prefixed correctly.

### 5. Install the framework adapter in the app's directory

In the app's directory (not necessarily repo root), add the iterate adapter as a dev dependency using the app's package manager:

- Next.js: `iterate-ui-next`
- Vite: `iterate-ui-vite`

Use the detected package manager (pnpm/yarn/npm/bun). In a pnpm workspace, this means `pnpm add -D --filter <app> iterate-ui-next` from the repo root, OR `pnpm add -D iterate-ui-next` from the app dir.

### 6. Wire the adapter into the app's config

**Next.js** (`next.config.{js,mjs,ts}`):
- Import: `import { withIterate } from "iterate-ui-next"`
- Wrap the default export: `export default withIterate(nextConfig)`
- Skip if already wrapped.
- Also add the `<Iterate />` component to the root layout (`app/layout.tsx` or `app/layout.jsx`):
  - Import: `import { Iterate } from "iterate-ui-next/devtools"`
  - Render `<Iterate />` inside `<body>` after `{children}`.
  - Skip if already present.

**Vite** (`vite.config.{js,mjs,ts}`):
- Import: `import { iterate } from "iterate-ui-vite"`
- Add `iterate()` to the `plugins` array.
- Skip if already present.

### 7. Write `.iterate/config.json` at the repo root

Use the `iterate init` CLI with the detected values — it handles merging into an existing config if one app is already registered. For each app you're configuring in this skill invocation, run:

```bash
iterate init \
  --app-name <app-id> \
  --dev-command <devCommand> \
  [--app-dir <relative-path>] \
  [--port-env-var <VAR>] \
  [--env-file <path> ...] \
  [--base-path <path>]
```

Pick a short, stable `--app-name` based on the app's directory or `package.json` name (e.g., `brand-admin`, `web`, `admin`).

If init reports a starting daemon port that's already in use, pass `--port <N>` with a free alternative in the 47000–48000 range.

### 8. Check prerequisites and surface them to the user

Run `iterate doctor` and show the output. It will flag:

- Whether your starting daemon port is free
- Whether the `appDir` and `package.json` exist
- Whether env files parse and contain the expected port variable
- Whether the package manager is installed
- Whether `docker-compose.yaml` is present at the repo root (a reminder that backend services have to be running separately)

If doctor shows any ✗ (fail) items, fix them before moving on. Warnings (`!`) are usually fine to ignore but worth mentioning.

### 9. Ensure `.mcp.json` and `.claude/settings.json` are set up

The `iterate init` CLI handles these — just verify they were created. If `.mcp.json` already existed, confirm that the `iterate` MCP server entry is present; if not, add it. Do NOT hardcode `ITERATE_DAEMON_PORT` — the MCP server auto-discovers the port from `.iterate/daemon.lock`.

```json
{
  "mcpServers": {
    "iterate": {
      "command": "npx",
      "args": ["iterate-ui-mcp"]
    }
  }
}
```

### 10. Summarize what happened and what the user needs to do next

List:

- Which apps you registered (names, paths, dev commands).
- Warnings from `iterate doctor` that the user should be aware of.
- Any external services (docker-compose, reverse proxy, `/etc/hosts` entries for local domains) the user must start independently — iterate doesn't manage these.
- How to start iterating:
  - Restart Claude Code to pick up the MCP server.
  - Run `iterate serve` in a terminal.
  - Available slash commands: `/iterate:prompt`, `/iterate:go`, `/iterate:keep`.

## What this skill does NOT do

- Start docker-compose or any backend services.
- Edit `/etc/hosts` or configure local reverse proxies.
- Run `pnpm install` at the repo level (only in the app directory when adding the adapter dep). The user is expected to have already installed deps.
- Guess at secrets that aren't in any env file. If the app needs a secret that's not committed (e.g., DOPPLER_TOKEN), tell the user they need to have it in their shell or pass it via `envPassthrough` in config.

## When to re-run

Re-run the skill if the user wants to register an additional app in the same repo. It's safe to re-run — it merges into the existing config by app name.
