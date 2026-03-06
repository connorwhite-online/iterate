"use client";

import Script from "next/script";

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
  if (process.env.NODE_ENV === "production") return null;

  const iterationName = process.env.ITERATE_ITERATION_NAME ?? "__original__";
  const initScript = `
    if(!window.__iterate_shell__){
      window.__iterate_shell__={activeTool:"browse",activeIteration:${JSON.stringify(iterationName)},daemonPort:${port}};
    }
  `;

  return (
    <>
      <Script id="iterate-init" strategy="beforeInteractive">
        {initScript}
      </Script>
      <Script
        src="/__iterate__/overlay.js"
        strategy="afterInteractive"
      />
    </>
  );
}

export default IterateDevTools;
