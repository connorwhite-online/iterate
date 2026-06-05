"use client";

import { useEffect } from "react";

/**
 * Drop-in overlay loader. Add this component to your root layout to
 * enable the iterate toolbar in development.
 *
 * Usage (root layout):
 * ```tsx
 * import { Iterate } from "iterate-ui-next/devtools";
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html><body>
 *       {children}
 *       <Iterate />
 *     </body></html>
 *   );
 * }
 * ```
 */
export function Iterate({ port, appName }: { port?: number; appName?: string } = {}) {
  // Resolution order: explicit prop → NEXT_PUBLIC_ITERATE_DAEMON_PORT injected
  // by the withIterate wrapper → 47100 default (matches iterate's default
  // starting daemon port).
  const resolvedPort = port ?? (Number(process.env.NEXT_PUBLIC_ITERATE_DAEMON_PORT) || 47100);
  const basePath = process.env.NEXT_PUBLIC_ITERATE_BASE_PATH ?? "";
  // App identity: explicit prop wins, else the env var stamped by
  // withIterate({ appName }), else undefined (the daemon falls back to
  // "sole configured app" if there's only one).
  const resolvedAppName = appName ?? process.env.NEXT_PUBLIC_ITERATE_APP_NAME ?? undefined;

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;

    if (!(window as any).__iterate_shell__) {
      (window as any).__iterate_shell__ = {
        activeTool: "browse",
        activeIteration: process.env.NEXT_PUBLIC_ITERATE_ITERATION_NAME ?? "__original__",
        daemonPort: resolvedPort,
        basePath,
        ...(resolvedAppName ? { appName: resolvedAppName } : {}),
      };
    } else if (resolvedAppName && !(window as any).__iterate_shell__.appName) {
      // An earlier injection (e.g. daemon HTML proxy) set up the shell
      // without appName; fill it in so overlay -> daemon calls know which
      // app they originated from.
      (window as any).__iterate_shell__.appName = resolvedAppName;
    }

    if (!document.getElementById("iterate-overlay-script")) {
      const script = document.createElement("script");
      script.id = "iterate-overlay-script";
      // Honor basePath so the overlay script resolves under subpath-mounted
      // apps (e.g. basePath: "/admin").
      script.src = `${basePath}/__iterate__/overlay.js`;
      document.body.appendChild(script);
    }
  }, [resolvedPort, basePath, resolvedAppName]);

  return null;
}

/** @deprecated Use `Iterate` instead */
export const IterateDevTools = Iterate;

export default Iterate;
