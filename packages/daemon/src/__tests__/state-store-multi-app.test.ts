import { describe, it, expect } from "vitest";
import { StateStore } from "../state/store.js";
import { DEFAULT_CONFIG, type IterationInfo } from "iterate-ui-core";

/**
 * Tests covering the interaction between multi-app iterations and the rest
 * of the store's state (changes, dom changes, command context). Making sure
 * nothing in the legacy single-app code path was inadvertently keying on
 * iteration name + app name combinations that break when two apps coexist.
 */

function mockIter(n: string, appName?: string): IterationInfo {
  return {
    name: n,
    branch: `iterate/${n}`,
    worktreePath: `/tmp/${n}`,
    port: 3100,
    pid: null,
    status: "ready",
    createdAt: new Date().toISOString(),
    ...(appName ? { appName } : {}),
  };
}

describe("StateStore — multi-app interactions", () => {
  it("changes are keyed by iteration name regardless of app", () => {
    const store = new StateStore({ ...DEFAULT_CONFIG });
    store.setIteration("a", mockIter("a", "web"));
    store.setIteration("b", mockIter("b", "admin"));
    store.addChange({
      id: "chg-1",
      iteration: "a",
      elements: [],
      comment: "change for a",
      timestamp: 1000,
      status: "queued",
    });
    store.addChange({
      id: "chg-2",
      iteration: "b",
      elements: [],
      comment: "change for b",
      timestamp: 1001,
      status: "queued",
    });

    expect(store.getChanges()).toHaveLength(2);

    // Removing iteration "a" cleans up its changes
    const removed = store.removeIterationData("a");
    expect(removed.changeIds).toEqual(["chg-1"]);
    // The "b" change is untouched
    expect(store.getChanges().map((c) => c.id)).toEqual(["chg-2"]);
  });

  it("dom changes are keyed by iteration name regardless of app", () => {
    const store = new StateStore({ ...DEFAULT_CONFIG });
    store.setIteration("a", mockIter("a", "web"));
    store.setIteration("b", mockIter("b", "admin"));
    store.addDomChange({
      id: "dc-1",
      iteration: "a",
      selector: "div",
      type: "move",
      componentName: null,
      sourceLocation: null,
      parentSelector: null,
      targetParentSelector: null,
      before: { rect: { x: 0, y: 0, width: 0, height: 0 } },
      after: { rect: { x: 10, y: 10, width: 0, height: 0 } },
    } as any);
    store.addDomChange({
      id: "dc-2",
      iteration: "b",
      selector: "div",
      type: "move",
      componentName: null,
      sourceLocation: null,
      parentSelector: null,
      targetParentSelector: null,
      before: { rect: { x: 0, y: 0, width: 0, height: 0 } },
      after: { rect: { x: 20, y: 20, width: 0, height: 0 } },
    } as any);

    expect(store.getDomChanges()).toHaveLength(2);
    const removed = store.removeIterationData("a");
    expect(removed.domChangeIds).toEqual(["dc-1"]);
    expect(store.getDomChanges().map((d) => d.id)).toEqual(["dc-2"]);
  });

  it("removeIterationData returns empty arrays for an iteration with no changes", () => {
    const store = new StateStore({ ...DEFAULT_CONFIG });
    store.setIteration("clean", mockIter("clean", "web"));
    const out = store.removeIterationData("clean");
    expect(out.changeIds).toEqual([]);
    expect(out.domChangeIds).toEqual([]);
  });

  it("two iterations for the same app coexist and track separately", () => {
    const store = new StateStore({ ...DEFAULT_CONFIG });
    store.setIteration("v1", mockIter("v1", "web"));
    store.setIteration("v2", mockIter("v2", "web"));
    expect(Object.keys(store.getIterations())).toEqual(["v1", "v2"]);
    expect(store.getIteration("v1")?.appName).toBe("web");
    expect(store.getIteration("v2")?.appName).toBe("web");
  });

  it("command context doesn't care which app the iterations target", () => {
    const store = new StateStore({ ...DEFAULT_CONFIG });
    store.setIteration("a", mockIter("a", "web"));
    store.setIteration("b", mockIter("b", "admin"));
    store.setCommandContext("cmd-1", "make it pretty", ["a", "b"]);
    const ctx = store.getCommandContext("cmd-1");
    expect(ctx?.iterations).toEqual(["a", "b"]);
  });
});
