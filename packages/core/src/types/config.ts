/** iterate project configuration (stored in .iterate/config.json) */
export interface IterateConfig {
  /** Command to start the dev server (e.g., "next dev", "vite") */
  devCommand: string;
  /** Package manager detected or configured */
  packageManager: "pnpm" | "npm" | "yarn" | "bun";
  /** Base port for iteration dev servers (default: 3100) */
  basePort: number;
  /** Port for the iterate daemon/control server (default: 4000) */
  daemonPort: number;
  /** Maximum concurrent iterations (default: 3) */
  maxIterations: number;
  /** Auto-stop idle servers after this many seconds (0 = disabled) */
  idleTimeout: number;
  /** Optional build command to run after install (e.g., "pnpm build" for monorepos with workspace deps) */
  buildCommand?: string;
  /** Subdirectory within the repo where the app lives (for monorepos). Dev command runs here. */
  appDir?: string;
  /** Glob patterns for files to copy from project root into each new worktree (default: [".env*"]) */
  copyFiles?: string[];
}

export const DEFAULT_CONFIG: IterateConfig = {
  devCommand: "npm run dev",
  packageManager: "npm",
  basePort: 3100,
  daemonPort: 4000,
  maxIterations: 3,
  idleTimeout: 0,
  copyFiles: [".env*"],
};
