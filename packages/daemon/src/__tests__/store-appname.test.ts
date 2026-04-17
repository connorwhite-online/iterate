import { describe, it, expect } from "vitest";
import { StateStore } from "../state/store.js";
import { DEFAULT_CONFIG, type IterationInfo } from "iterate-ui-core";

/**
 * These tests cover the new `appName` field on IterationInfo — specifically
 * that the store preserves it through set/get/remove round-trips without
 * any special-casing, and that legacy iterations (without an appName) coexist
 * with new ones (with one).
 */

function mockIter(overrides: Partial<IterationInfo> = {}): IterationInfo {
  return {
    name: "iter",
    branch: "iterate/iter",
    worktreePath: "/tmp/x",
    port: 3100,
    pid: null,
    status: "ready",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("StateStore — appName field", () => {
  it("round-trips appName through set/get", () => {
    const store = new StateStore({ ...DEFAULT_CONFIG });
    const info = mockIter({ name: "v1", appName: "brand-admin" });
    store.setIteration("v1", info);
    expect(store.getIteration("v1")?.appName).toBe("brand-admin");
  });

  it("preserves appName when the same iteration is updated", () => {
    const store = new StateStore({ ...DEFAULT_CONFIG });
    store.setIteration("v1", mockIter({ name: "v1", appName: "brand-admin", status: "creating" }));
    const existing = store.getIteration("v1")!;
    existing.status = "ready";
    existing.port = 3101;
    store.setIteration("v1", existing);
    expect(store.getIteration("v1")?.appName).toBe("brand-admin");
    expect(store.getIteration("v1")?.port).toBe(3101);
  });

  it("allows iterations with and without appName to coexist", () => {
    const store = new StateStore({ ...DEFAULT_CONFIG });
    store.setIteration("legacy", mockIter({ name: "legacy" })); // no appName
    store.setIteration("modern", mockIter({ name: "modern", appName: "web" }));
    expect(store.getIteration("legacy")?.appName).toBeUndefined();
    expect(store.getIteration("modern")?.appName).toBe("web");
  });

  it("different iterations can target different apps", () => {
    const store = new StateStore({ ...DEFAULT_CONFIG });
    store.setIteration("a", mockIter({ name: "a", appName: "brand-admin" }));
    store.setIteration("b", mockIter({ name: "b", appName: "world-v3" }));
    const all = store.getIterations();
    expect(Object.keys(all)).toHaveLength(2);
    expect(all.a.appName).toBe("brand-admin");
    expect(all.b.appName).toBe("world-v3");
  });

  it("appName survives removal and re-add under the same name", () => {
    const store = new StateStore({ ...DEFAULT_CONFIG });
    store.setIteration("v1", mockIter({ name: "v1", appName: "admin" }));
    store.removeIteration("v1");
    expect(store.getIteration("v1")).toBeUndefined();
    store.setIteration("v1", mockIter({ name: "v1", appName: "web" }));
    expect(store.getIteration("v1")?.appName).toBe("web");
  });

  it("iteration:status updates via setIteration preserve appName", () => {
    const store = new StateStore({ ...DEFAULT_CONFIG });
    store.setIteration("v1", mockIter({ name: "v1", appName: "admin", status: "creating" }));
    // simulate the daemon pipeline mutating in-place and re-setting
    const it = store.getIteration("v1")!;
    it.status = "installing";
    store.setIteration("v1", it);
    it.status = "starting";
    store.setIteration("v1", it);
    it.status = "ready";
    store.setIteration("v1", it);
    expect(store.getIteration("v1")?.appName).toBe("admin");
    expect(store.getIteration("v1")?.status).toBe("ready");
  });
});
