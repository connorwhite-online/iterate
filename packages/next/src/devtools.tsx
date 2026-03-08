"use client";

import { useEffect } from "react";

/**
 * Drop-in overlay loader for Turbopack or any environment where the
 * webpack entry-point injection doesn't run.
 *
 * Usage (root layout):
 * ```tsx
 * import { IterateDevTools } from "iterate-ui-next/devtools";
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html><body>
 *       {children}
 *       <IterateDevTools />
 *     </body></html>
 *   );
 * }
 * ```
 *
 * For production mode (annotation toolbar without fork/pick/discard):
 * ```tsx
 * <IterateDevTools production />
 * ```
 */
export function IterateDevTools({
  port = 4000,
  production = false,
}: {
  port?: number;
  /** Enable production mode — shows the toolbar with fork/pick/discard disabled */
  production?: boolean;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && !production) return;

    if (!(window as any).__iterate_shell__) {
      (window as any).__iterate_shell__ = {
        activeTool: "browse",
        activeIteration: "__original__",
        daemonPort: port,
        ...(production ? { production: true } : {}),
      };
    }

    if (!document.getElementById("iterate-overlay-script")) {
      const script = document.createElement("script");
      script.id = "iterate-overlay-script";
      script.src = "/__iterate__/overlay.js";
      document.body.appendChild(script);
    }
  }, [port, production]);

  return null;
}

export default IterateDevTools;
