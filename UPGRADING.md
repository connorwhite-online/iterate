# Upgrading iterate

## Multi-app monorepo support (0.2.x)

This release moves iterate from "works on greenfield Next/Vite apps" to
"works on any React app in any repo," including mature monorepos with
custom dev-script wrappers, shared env files, and subpath-mounted apps.

### TL;DR: what changed for you

- **Existing `.iterate/config.json` files still work.** Legacy flat configs
  (with `devCommand` / `appDir` at the top level) are auto-migrated into an
  `apps[]` array at load time. No edits required for greenfield users.
- **Daemon default port moved from 4000 → 47100.** If you depended on
  port 4000 specifically, pin it in `.iterate/config.json` with
  `"daemonPort": 4000`. Otherwise iterate now auto-picks a free port
  starting from 47100 and writes it to `.iterate/daemon.lock` for the
  CLI, plugins, and MCP to discover.
- **`.mcp.json` no longer needs `ITERATE_DAEMON_PORT`.** Remove it if
  present — the MCP server auto-discovers via the lockfile.
- **`withIterate` now returns an async function.** Next accepts it without
  any changes to your `next.config.ts`. Only affects you if you were
  statically inspecting the default export (unusual).
- **`.gitignore` now partially tracks `.iterate/`.** `iterate init` writes:
  ```
  .iterate/*
  !.iterate/config.json
  ```
  so `config.json` is checked in (it's project intent — everyone on the
  team should agree which apps exist) while `daemon.lock`, worktree state,
  and any future runtime files stay ignored. If your repo still has a
  whole-directory `.iterate` / `.iterate/` entry from an earlier init,
  re-running `iterate init` upgrades it in place.
- **Plugin option: `appName`.** In multi-app repos, pass `appName` to
  `withIterate` / `iterate()` matching the entry in `apps[]`. Without it,
  iterations created via the overlay's fork button always spawn the first
  configured app — not whichever dev server the user was actually viewing.

### New capabilities

- **Multi-app monorepos.** Register each React app in a single
  `.iterate/config.json`:
  ```json
  {
    "apps": [
      {
        "name": "brand-admin",
        "devCommand": "PORT=$BRAND_ADMIN_PORT env-cmd.ts --dev -- next dev",
        "appDir": "projects/tyb-brand-admin",
        "portEnvVar": "BRAND_ADMIN_PORT",
        "envFiles": [".env.development.pre"],
        "basePath": "/admin"
      },
      {
        "name": "world-v3",
        "devCommand": "next dev -p $WORLD_V3_PORT",
        "appDir": "projects/tyb-world-v3",
        "portEnvVar": "WORLD_V3_PORT",
        "envFiles": [".env.development.pre"]
      }
    ],
    "daemonPort": 47100
  }
  ```
  Pick which app an iteration targets at creation time:
  `iterate branch my-feature --app brand-admin`.

  Also pass `appName` to each app's framework plugin so the overlay's
  fork button spawns the right app:

  ```ts
  // apps/brand-admin/next.config.ts
  export default withIterate(nextConfig, { appName: "brand-admin" });

  // projects/world-v3/next.config.ts
  export default withIterate(nextConfig, { appName: "world-v3" });
  ```

- **Opaque dev commands.** Wrappers like `dotenv-cli`, `env-cmd`,
  `doppler run`, `op run`, or custom TS runners now work untouched.
  Set `portEnvVar` in the app config and iterate passes the allocated
  port via that variable rather than mutating the command.

- **Env file loading.** Declare `envFiles` per app (relative to the repo
  root). iterate merges them into the dev server's env with correct
  precedence: files → `envPassthrough` → port var.

- **`envPassthrough`** forwards host-shell secrets (`DOPPLER_TOKEN`,
  `OP_SESSION`, etc.) into every iteration without committing them.

- **`basePath` awareness.** Both the Next plugin and the daemon's overlay
  injector honor the app's `basePath` (or Vite `base`). The overlay
  script loads from the correct subpath.

- **`iterate doctor`** — a preflight check command that catches
  misconfig before you waste time on a failed iteration:
  ```
  iterate doctor                 # checks every configured app
  iterate doctor --app web       # only this app
  ```

- **`iterate-ui-core/node`** — a new subpath export shipping shared
  node-only helpers (config IO, lockfile, port probing, dotenv parser,
  env file loader). If you're building tooling on top of iterate, this
  is the entry point you want.

### Breaking changes

| Change | Impact |
|---|---|
| Default daemon port 4000 → 47100 | Pin `"daemonPort": 4000` in config to keep old default |
| `withIterate` returns an async function | Next/Vite handle this transparently — only matters if you introspect the export |
| `IterateConfig` schema adds `apps[]` | Legacy fields auto-migrate on load; write path now uses `apps[]` |
| `iterate branch` requires `--app <name>` in multi-app repos | Error explicitly lists the registered apps |

### Running `iterate doctor` after upgrading

For existing projects, run `iterate doctor` once after upgrading. It will
flag any collisions or stale lockfiles and explicitly list the registered
apps so you can confirm the migration worked:

```
$ iterate doctor
iterate doctor:

  ✓ Inside a git repository
  ✓ Loaded .iterate/config.json
  ✓ Registered apps (1): app
  ✓ Starting daemon port 47100 is available
  ✓ — App: app —
  ✓   appDir resolves and has package.json
  ✓   devCommand: pnpm run dev
  ✓   package manager "pnpm" is installed

All checks passed.
```

### Adding a second app to an existing project

Re-run `iterate init` with `--app-name` (and other flags) from the repo
root. It merges the new app entry into the existing `apps[]` array
instead of overwriting:

```bash
iterate init \
  --app-name admin \
  --app-dir apps/admin \
  --dev-command "next dev -p \$ADMIN_PORT" \
  --port-env-var ADMIN_PORT \
  --env-file .env.development
```

Follow up with `iterate doctor --app admin` to verify.
