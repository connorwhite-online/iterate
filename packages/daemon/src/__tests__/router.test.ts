import { describe, it, expect } from "vitest";
import { resolveBasePath, injectOverlayScript } from "../proxy/router.js";
import type { IterateConfig, IterationInfo } from "iterate-ui-core";

const cfgWithTwoApps: IterateConfig = {
  apps: [
    { name: "admin", devCommand: "next dev", basePath: "/admin" },
    { name: "web", devCommand: "vite" },
  ],
  packageManager: "pnpm",
  basePort: 3100,
  daemonPort: 47100,
  maxIterations: 3,
  idleTimeout: 0,
};

const iter = (partial: Partial<IterationInfo>): IterationInfo => ({
  name: "test",
  branch: "iterate/test",
  worktreePath: "/tmp/wt",
  port: 3100,
  pid: null,
  status: "ready",
  createdAt: new Date().toISOString(),
  ...partial,
});

describe("resolveBasePath", () => {
  it("returns the app's basePath when iteration targets it by name", () => {
    expect(resolveBasePath(cfgWithTwoApps, iter({ appName: "admin" }))).toBe("/admin");
  });

  it("returns empty string when the targeted app has no basePath", () => {
    expect(resolveBasePath(cfgWithTwoApps, iter({ appName: "web" }))).toBe("");
  });

  it("returns empty string when the appName is not in config", () => {
    expect(resolveBasePath(cfgWithTwoApps, iter({ appName: "unknown" }))).toBe("");
  });

  it("falls back to the sole app's basePath when iteration has no appName (legacy)", () => {
    const soleApp: IterateConfig = { ...cfgWithTwoApps, apps: [cfgWithTwoApps.apps[0]] };
    expect(resolveBasePath(soleApp, iter({}))).toBe("/admin");
  });

  it("returns empty string when no appName and multiple apps configured (ambiguous)", () => {
    expect(resolveBasePath(cfgWithTwoApps, iter({}))).toBe("");
  });
});

describe("injectOverlayScript", () => {
  const html = "<html><head><title>hi</title></head><body>page</body></html>";

  it("injects the overlay before </head> with daemonPort and iterationName", () => {
    const out = injectOverlayScript(html, 47100, "v1", "");
    expect(out).toContain("__iterate_shell__");
    expect(out).toContain(`"v1"`);
    expect(out).toContain("47100");
    expect(out).toContain("/__iterate__/overlay.js");
  });

  it("prefixes the overlay src with basePath when provided", () => {
    const out = injectOverlayScript(html, 47100, "v1", "/admin");
    expect(out).toContain('"/admin/__iterate__/overlay.js"');
    expect(out).toContain('basePath:"/admin"');
  });

  it("strips trailing slashes from basePath", () => {
    const out = injectOverlayScript(html, 47100, "v1", "/admin/");
    expect(out).toContain('"/admin/__iterate__/overlay.js"');
    expect(out).not.toContain('"/admin//__iterate__');
  });

  it("falls back to </body> injection when </head> is missing", () => {
    const noHead = "<html><body>page</body></html>";
    const out = injectOverlayScript(noHead, 47100, "v1", "");
    expect(out).toMatch(/<\/script>\s*<\/body>/);
  });

  it("appends to end when neither </head> nor </body> is present", () => {
    const bare = "<div>just html</div>";
    const out = injectOverlayScript(bare, 47100, "v1", "");
    expect(out.startsWith(bare)).toBe(true);
    expect(out).toContain("__iterate_shell__");
  });

  it("skips injection when overlay is already present (shell variable)", () => {
    const withShell = "<html><head></head><body>__iterate_shell__</body></html>";
    const out = injectOverlayScript(withShell, 47100, "v1", "");
    expect(out).toBe(withShell);
  });

  it("skips injection when overlay is already present (root div)", () => {
    const withRoot = '<html><head></head><body><div id="__iterate-overlay-root__"></div></body></html>';
    const out = injectOverlayScript(withRoot, 47100, "v1", "");
    expect(out).toBe(withRoot);
  });

  it("safely JSON-encodes the iteration name (no injection risk)", () => {
    const nastyName = `v1"/><script>alert(1)</script>`;
    const out = injectOverlayScript(html, 47100, nastyName, "");
    // The unsafe chars should be escaped, not present literally in the overlay tag
    expect(out).not.toContain(`activeIteration:"v1"/><script>`);
  });
});
