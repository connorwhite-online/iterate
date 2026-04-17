import { describe, it, expect } from "vitest";
import {
  resolveBasePath,
  injectOverlayScript,
  resolveIterationFromReferer,
} from "../proxy/router.js";
import { StateStore } from "../state/store.js";
import { DEFAULT_CONFIG, type IterateConfig, type IterationInfo } from "iterate-ui-core";
import type { FastifyRequest } from "fastify";

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

describe("resolveIterationFromReferer", () => {
  function fakeRequest(referer?: string): FastifyRequest {
    return { headers: referer ? { referer } : {} } as unknown as FastifyRequest;
  }

  function storeWith(iterationName: string, status: IterationInfo["status"] = "ready"): StateStore {
    const store = new StateStore({ ...DEFAULT_CONFIG });
    store.setIteration(iterationName, {
      name: iterationName,
      branch: `iterate/${iterationName}`,
      worktreePath: `/tmp/${iterationName}`,
      port: 3100,
      pid: 1234,
      status,
      createdAt: new Date().toISOString(),
    });
    return store;
  }

  it("returns null when Referer header is missing", () => {
    const store = storeWith("v1");
    expect(resolveIterationFromReferer(fakeRequest(), store)).toBeNull();
  });

  it("extracts the first path segment and looks up the iteration", () => {
    const store = storeWith("v1-cards");
    const res = resolveIterationFromReferer(
      fakeRequest("http://localhost:47100/v1-cards/"),
      store
    );
    expect(res?.name).toBe("v1-cards");
  });

  it("returns null if the referring iteration isn't 'ready'", () => {
    const store = storeWith("v1", "installing");
    expect(
      resolveIterationFromReferer(
        fakeRequest("http://localhost:47100/v1/some-page"),
        store
      )
    ).toBeNull();
  });

  it("returns null when the first segment doesn't match any iteration", () => {
    const store = storeWith("v1");
    expect(
      resolveIterationFromReferer(
        fakeRequest("http://localhost:47100/nonexistent/x"),
        store
      )
    ).toBeNull();
  });

  it("returns null when pathname is '/'", () => {
    const store = storeWith("v1");
    expect(
      resolveIterationFromReferer(fakeRequest("http://localhost:47100/"), store)
    ).toBeNull();
  });

  it("returns null on malformed URL without crashing", () => {
    const store = storeWith("v1");
    expect(
      resolveIterationFromReferer(fakeRequest("not a url"), store)
    ).toBeNull();
  });

  it("handles nested paths (only the first segment matters)", () => {
    const store = storeWith("v1");
    const res = resolveIterationFromReferer(
      fakeRequest("http://localhost:47100/v1/nested/deep/path?a=1"),
      store
    );
    expect(res?.name).toBe("v1");
  });
});
