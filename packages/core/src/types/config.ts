/**
 * Per-app configuration for a single React app in the repo.
 * A repo may have one (greenfield) or many (monorepo) apps registered.
 */
export interface AppConfig {
  /** Stable identifier for the app (e.g., "brand-admin", "web"). Used in URLs and iteration metadata. */
  name: string;
  /**
   * Dev command as written in the app's package.json. Iterate treats this as opaque when
   * `portEnvVar` is set — it will NOT append `-p <port>` or `--port <port>`. When `portEnvVar`
   * is not set, iterate falls back to its legacy heuristic (append the appropriate flag for
   * next/vite, else set PORT env var).
   */
  devCommand: string;
  /** Subdirectory of the repo where the app lives (dev command runs here). Relative to repo root. */
  appDir?: string;
  /** Package manager for installs inside this app's dir. Falls back to the top-level setting. */
  packageManager?: "pnpm" | "npm" | "yarn" | "bun";
  /**
   * Env var name the dev script reads to pick its port (e.g., "BRAND_ADMIN_PORT", "PORT").
   * If set, iterate passes the allocated port via this env var and leaves `devCommand` untouched.
   */
  portEnvVar?: string;
  /**
   * Paths to dotenv files to source into the dev-server process, in order (later wins).
   * Paths are relative to the repo root. Example: [".env.development.pre", ".env.development"].
   */
  envFiles?: string[];
  /** Next.js `basePath` or Vite `base`, if the app mounts under a subpath (e.g., "/admin"). */
  basePath?: string;
  /** Override install command (e.g., "pnpm install --filter ./projects/brand-admin..."). */
  installCommand?: string;
  /** Optional build command to run after install (for workspace deps that must be built first). */
  buildCommand?: string;
}

/** iterate project configuration (stored in .iterate/config.json) */
export interface IterateConfig {
  /** Registered apps in this repo. A single-app project has one entry. */
  apps: AppConfig[];
  /** Default package manager for the repo (apps may override). */
  packageManager: "pnpm" | "npm" | "yarn" | "bun";
  /** Base port for iteration dev servers (default: 3100). Iterations allocate upward from here. */
  basePort: number;
  /**
   * Starting port for the iterate daemon. The daemon probes upward from here for a free port,
   * then writes the resolved port into `.iterate/daemon.lock`. Default: 47100.
   */
  daemonPort: number;
  /** Maximum concurrent iterations (default: 3) */
  maxIterations: number;
  /** Auto-stop idle servers after this many seconds (0 = disabled) */
  idleTimeout: number;
  /** Glob patterns for files to copy from project root into each new worktree (default: [".env*", ".npmrc"]) */
  copyFiles?: string[];
  /**
   * Host env vars to pass through from the iterate CLI/daemon into every dev-server child.
   * Useful for secrets injected by your shell that shouldn't live in config (e.g., DOPPLER_TOKEN).
   */
  envPassthrough?: string[];

  // --- Legacy fields (accepted on load, migrated to apps[] in memory) ---
  /** @deprecated Use apps[].devCommand. Preserved for migration of older configs. */
  devCommand?: string;
  /** @deprecated Use apps[].appDir. Preserved for migration of older configs. */
  appDir?: string;
  /** @deprecated Use apps[].buildCommand. Preserved for migration of older configs. */
  buildCommand?: string;
}

export const DEFAULT_CONFIG: IterateConfig = {
  apps: [],
  packageManager: "npm",
  basePort: 3100,
  daemonPort: 47100,
  maxIterations: 3,
  idleTimeout: 0,
  copyFiles: [".env*", ".npmrc"],
};

/**
 * Normalize a config loaded from disk into the canonical shape.
 * - Migrates legacy flat configs (`devCommand` at top level) into a single-entry `apps` array.
 * - Fills in defaults for missing fields.
 * - Does NOT mutate the input.
 */
export function normalizeConfig(raw: Partial<IterateConfig> & Record<string, unknown>): IterateConfig {
  const base: IterateConfig = {
    ...DEFAULT_CONFIG,
    ...raw,
    apps: Array.isArray(raw.apps) ? [...(raw.apps as AppConfig[])] : [],
  };

  // Legacy migration: if there are no apps but a top-level devCommand exists,
  // synthesize a single app entry from the legacy fields.
  if (base.apps.length === 0 && typeof raw.devCommand === "string" && raw.devCommand.length > 0) {
    base.apps = [
      {
        name: "app",
        devCommand: raw.devCommand,
        appDir: typeof raw.appDir === "string" ? raw.appDir : undefined,
        buildCommand: typeof raw.buildCommand === "string" ? raw.buildCommand : undefined,
      },
    ];
  }

  return base;
}

/**
 * Look up an app by name. Throws if not found — callers should guard with
 * `config.apps.length === 0` or `findApp` (below) when absence is expected.
 */
export function getApp(config: IterateConfig, name: string): AppConfig {
  const app = config.apps.find((a) => a.name === name);
  if (!app) {
    const available = config.apps.map((a) => a.name).join(", ") || "(none configured)";
    throw new Error(`App "${name}" not found in config. Available: ${available}`);
  }
  return app;
}

/** Non-throwing variant of getApp. */
export function findApp(config: IterateConfig, name: string): AppConfig | undefined {
  return config.apps.find((a) => a.name === name);
}

/**
 * Choose the default app when a caller didn't specify one:
 * - If exactly one app is configured, return it.
 * - Otherwise return undefined (caller must prompt / error).
 */
export function getDefaultApp(config: IterateConfig): AppConfig | undefined {
  return config.apps.length === 1 ? config.apps[0] : undefined;
}
