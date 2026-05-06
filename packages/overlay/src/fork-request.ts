/**
 * Build the JSON body sent to POST /api/command when the user forks
 * iterations via the overlay toolbar.
 *
 * Extracted from standalone.tsx so it can be unit-tested without mounting
 * the whole overlay React tree.
 */
export interface IterateShellLike {
  appName?: string;
}

export interface ForkRequestBody {
  command: "iterate";
  count: number;
  appName?: string;
}

export function buildForkRequest(shell: IterateShellLike | null | undefined, count = 3): ForkRequestBody {
  const body: ForkRequestBody = { command: "iterate", count };
  if (shell?.appName) body.appName = shell.appName;
  return body;
}

/**
 * Filter the daemon's iteration map down to the ones the current overlay
 * should show. In a multi-app repo, each dev server's overlay only sees
 * iterations targeting its own app — without this, forking on next-16
 * would also pop up tabs on next-15's page (since they share the daemon
 * and its WebSocket broadcast).
 *
 * Special cases:
 * - `isDaemonShell` true → ALL iterations (the shell at /:daemonPort/ is
 *   the cross-app admin view).
 * - `currentAppName` undefined (single-app repo, or plugin didn't pass
 *   appName) → ALL iterations, preserving pre-multi-app behavior.
 * - Iterations without `appName` → always visible (legacy, plus a safety
 *   net for iterations created before the user wired up appName).
 */
export function filterIterationsForApp<T extends { appName?: string }>(
  all: Record<string, T>,
  ctx: { isDaemonShell: boolean; currentAppName: string | undefined }
): Record<string, T> {
  if (ctx.isDaemonShell || !ctx.currentAppName) return all;
  const out: Record<string, T> = {};
  for (const [name, info] of Object.entries(all)) {
    if (!info.appName || info.appName === ctx.currentAppName) {
      out[name] = info;
    }
  }
  return out;
}
