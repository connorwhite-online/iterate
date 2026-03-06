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
 */
export function IterateDevTools({ port = 4000 }: { port?: number }) {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;

    if (!(window as any).__iterate_shell__) {
      (window as any).__iterate_shell__ = {
        activeTool: "browse",
        activeIteration: "__original__",
        daemonPort: port,
      };
    }

    if (!document.getElementById("iterate-overlay-script")) {
      const script = document.createElement("script");
      script.id = "iterate-overlay-script";
      script.src = "/__iterate__/overlay.js";
      document.body.appendChild(script);
    }
  }, [port]);

  return null;
}

export default IterateDevTools;
