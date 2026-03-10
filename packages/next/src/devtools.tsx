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
export function Iterate({ port }: { port?: number } = {}) {
  const resolvedPort = port ?? (Number(process.env.NEXT_PUBLIC_ITERATE_DAEMON_PORT) || 4000);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;

    if (!(window as any).__iterate_shell__) {
      (window as any).__iterate_shell__ = {
        activeTool: "browse",
        activeIteration: process.env.NEXT_PUBLIC_ITERATE_ITERATION_NAME ?? "__original__",
        daemonPort: resolvedPort,
      };
    }

    if (!document.getElementById("iterate-overlay-script")) {
      const script = document.createElement("script");
      script.id = "iterate-overlay-script";
      script.src = "/__iterate__/overlay.js";
      document.body.appendChild(script);
    }
  }, [resolvedPort]);

  return null;
}

/** @deprecated Use `Iterate` instead */
export const IterateDevTools = Iterate;

export default Iterate;
