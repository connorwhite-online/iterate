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
