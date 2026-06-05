import { describe, it, expect } from "vitest";
import { buildForkRequest, filterIterationsForApp } from "../fork-request.js";

describe("buildForkRequest", () => {
  it("forwards appName from the shell when present", () => {
    const body = buildForkRequest({ appName: "next-16-example" });
    expect(body).toEqual({ command: "iterate", count: 3, appName: "next-16-example" });
  });

  it("omits appName when the shell has none (single-app repo)", () => {
    const body = buildForkRequest({});
    expect(body).toEqual({ command: "iterate", count: 3 });
    expect("appName" in body).toBe(false);
  });

  it("handles null shell (overlay loaded before plugin stamp ran)", () => {
    const body = buildForkRequest(null);
    expect(body).toEqual({ command: "iterate", count: 3 });
    expect("appName" in body).toBe(false);
  });

  it("handles undefined shell", () => {
    const body = buildForkRequest(undefined);
    expect(body).toEqual({ command: "iterate", count: 3 });
  });

  it("honors a custom count", () => {
    const body = buildForkRequest({ appName: "docs" }, 5);
    expect(body).toEqual({ command: "iterate", count: 5, appName: "docs" });
  });

  it("treats empty-string appName as no appName", () => {
    const body = buildForkRequest({ appName: "" });
    // Empty string is falsy; we don't forward it to the daemon.
    expect("appName" in body).toBe(false);
  });
});

describe("filterIterationsForApp", () => {
  const a: { appName?: string; status: string } = { appName: "web", status: "ready" };
  const b: { appName?: string; status: string } = { appName: "admin", status: "ready" };
  const c: { appName?: string; status: string } = { status: "ready" }; // legacy, no appName
  const all = { a, b, c };

  it("only returns iterations matching the current app", () => {
    const out = filterIterationsForApp(all, {
      isDaemonShell: false,
      currentAppName: "web",
    });
    expect(Object.keys(out).sort()).toEqual(["a", "c"]); // web + legacy
    expect(out).not.toHaveProperty("b");
  });

  it("returns all iterations on the daemon shell (cross-app admin view)", () => {
    const out = filterIterationsForApp(all, {
      isDaemonShell: true,
      currentAppName: "web",
    });
    expect(Object.keys(out).sort()).toEqual(["a", "b", "c"]);
  });

  it("returns all iterations when current app is unknown (single-app repo or no plugin appName)", () => {
    const out = filterIterationsForApp(all, {
      isDaemonShell: false,
      currentAppName: undefined,
    });
    expect(Object.keys(out).sort()).toEqual(["a", "b", "c"]);
  });

  it("includes legacy iterations (no appName) in any app's view", () => {
    const out = filterIterationsForApp({ legacy: c }, {
      isDaemonShell: false,
      currentAppName: "web",
    });
    expect(out).toHaveProperty("legacy");
  });

  it("returns an empty map when no iterations match", () => {
    const out = filterIterationsForApp({ b }, {
      isDaemonShell: false,
      currentAppName: "web",
    });
    expect(Object.keys(out)).toEqual([]);
  });

  it("does not mutate the input", () => {
    const snapshot = JSON.stringify(all);
    filterIterationsForApp(all, { isDaemonShell: false, currentAppName: "web" });
    expect(JSON.stringify(all)).toBe(snapshot);
  });
});
