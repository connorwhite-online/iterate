import { describe, it, expect, vi, beforeEach } from "vitest";
import { StateStore } from "../state/store.js";
import { DEFAULT_CONFIG } from "iterate-ui-core";
import type { Change, IterationInfo, DomChange } from "iterate-ui-core";

function createStore() {
  return new StateStore({ ...DEFAULT_CONFIG });
}

function mockIteration(overrides?: Partial<IterationInfo>): IterationInfo {
  return {
    name: "iter-a",
    branch: "iterate/iter-a",
    worktreePath: "/tmp/iter-a",
    port: 3100,
    pid: null,
    status: "ready",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockChange(overrides?: Partial<Change>): Change {
  return {
    id: "chg-1",
    iteration: "iter-a",
    elements: [{
      selector: "div.card",
      elementName: "div.card",
      elementPath: "main > div.card",
      rect: { x: 0, y: 0, width: 100, height: 50 },
      computedStyles: {},
      componentName: null,
      sourceLocation: null,
    }],
    comment: "Fix this",
    timestamp: 1000,
    status: "queued",
    ...overrides,
  };
}

function mockDomChange(overrides?: Partial<DomChange>): DomChange {
  return {
    id: "dc-1",
    iteration: "iter-a",
    selector: "div.card",
    type: "move",
    componentName: null,
    sourceLocation: null,
    before: { rect: { x: 0, y: 0, width: 100, height: 50 }, computedStyles: {} },
    after: { rect: { x: 10, y: 10, width: 100, height: 50 }, computedStyles: {} },
    timestamp: 1000,
    ...overrides,
  };
}

describe("StateStore", () => {
  let store: StateStore;

  beforeEach(() => {
    store = createStore();
  });

  describe("state", () => {
    it("getState returns full state object", () => {
      const state = store.getState();
      expect(state).toHaveProperty("config");
      expect(state).toHaveProperty("iterations");
      expect(state).toHaveProperty("changes");
      expect(state).toHaveProperty("domChanges");
    });

    it("getConfig returns the config passed to constructor", () => {
      expect(store.getConfig()).toEqual({ ...DEFAULT_CONFIG });
    });
  });

  describe("iterations", () => {
    it("getIterations returns empty object initially", () => {
      expect(store.getIterations()).toEqual({});
    });

    it("setIteration stores and getIteration retrieves it", () => {
      const iter = mockIteration({ name: "test" });
      store.setIteration("test", iter);
      expect(store.getIteration("test")).toEqual(iter);
    });

    it("getIteration returns undefined for nonexistent", () => {
      expect(store.getIteration("nope")).toBeUndefined();
    });

    it("removeIteration deletes the entry", () => {
      store.setIteration("test", mockIteration({ name: "test" }));
      store.removeIteration("test");
      expect(store.getIteration("test")).toBeUndefined();
    });

    it("getIterations returns all stored iterations", () => {
      store.setIteration("a", mockIteration({ name: "a" }));
      store.setIteration("b", mockIteration({ name: "b" }));
      store.setIteration("c", mockIteration({ name: "c" }));
      expect(Object.keys(store.getIterations())).toHaveLength(3);
    });
  });

  describe("changes", () => {
    it("getChanges returns empty array initially", () => {
      expect(store.getChanges()).toEqual([]);
    });

    it("addChange + getChange retrieves by id", () => {
      const chg = mockChange({ id: "x1" });
      store.addChange(chg);
      expect(store.getChange("x1")).toEqual(chg);
    });

    it("getChange returns undefined for nonexistent id", () => {
      expect(store.getChange("nope")).toBeUndefined();
    });

    it("getPendingChanges filters by status", () => {
      store.addChange(mockChange({ id: "a1", status: "queued" }));
      store.addChange(mockChange({ id: "a2", status: "implemented" }));
      store.addChange(mockChange({ id: "a3", status: "queued" }));
      const pending = store.getPendingChanges();
      expect(pending).toHaveLength(2);
      expect(pending.map((a) => a.id)).toEqual(["a1", "a3"]);
    });

    it("updateChange applies partial updates", () => {
      store.addChange(mockChange({ id: "a1", comment: "old" }));
      const result = store.updateChange("a1", { comment: "new", status: "implemented" });
      expect(result?.comment).toBe("new");
      expect(result?.status).toBe("implemented");
      expect(result?.id).toBe("a1");
    });

    it("updateChange returns null for nonexistent id", () => {
      expect(store.updateChange("nope", { comment: "x" })).toBeNull();
    });

    it("removeChange returns true and deletes", () => {
      store.addChange(mockChange({ id: "a1" }));
      expect(store.removeChange("a1")).toBe(true);
      expect(store.getChange("a1")).toBeUndefined();
    });

    it("removeChange returns false for nonexistent id", () => {
      expect(store.removeChange("nope")).toBe(false);
    });

    it("handles multiple changes", () => {
      for (let i = 0; i < 5; i++) {
        store.addChange(mockChange({ id: `a${i}` }));
      }
      expect(store.getChanges()).toHaveLength(5);
    });
  });

  describe("DOM changes", () => {
    it("getDomChanges returns empty array initially", () => {
      expect(store.getDomChanges()).toEqual([]);
    });

    it("addDomChange pushes to list", () => {
      store.addDomChange(mockDomChange());
      expect(store.getDomChanges()).toHaveLength(1);
    });

    it("clearDomChanges empties the list", () => {
      store.addDomChange(mockDomChange({ id: "dc-1" }));
      store.addDomChange(mockDomChange({ id: "dc-2" }));
      store.addDomChange(mockDomChange({ id: "dc-3" }));
      store.clearDomChanges();
      expect(store.getDomChanges()).toEqual([]);
    });
  });

  describe("commands", () => {
    it("getAllCommands returns empty array initially", () => {
      expect(store.getAllCommands()).toEqual([]);
    });

    it("setCommandContext + getCommandContext retrieves by ID", () => {
      store.setCommandContext("cmd-1", "make a hero", ["iter-1", "iter-2"]);
      const cmd = store.getCommandContext("cmd-1");
      expect(cmd?.commandId).toBe("cmd-1");
      expect(cmd?.prompt).toBe("make a hero");
      expect(cmd?.iterations).toEqual(["iter-1", "iter-2"]);
      expect(cmd?.createdAt).toBeGreaterThan(0);
    });

    it("getCommandContext returns undefined for nonexistent id", () => {
      expect(store.getCommandContext("nope")).toBeUndefined();
    });

    it("getLatestCommand returns the most recently inserted", () => {
      // Map preserves insertion order; the last setCommandContext wins
      // regardless of Date.now ordering. This makes ties deterministic
      // when multiple /iterate commands fire in the same millisecond.
      store.setCommandContext("cmd-1", "first", []);
      store.setCommandContext("cmd-2", "second", []);
      store.setCommandContext("cmd-3", "third", []);
      expect(store.getLatestCommand()?.commandId).toBe("cmd-3");
    });

    it("getLatestCommand returns undefined when empty", () => {
      expect(store.getLatestCommand()).toBeUndefined();
    });

    it("getAllCommands returns all stored commands", () => {
      store.setCommandContext("cmd-1", "first", []);
      store.setCommandContext("cmd-2", "second", []);
      store.setCommandContext("cmd-3", "third", []);
      expect(store.getAllCommands()).toHaveLength(3);
    });
  });

  describe("state mutations reflect in getState", () => {
    it("mutations are visible through getState", () => {
      store.setIteration("test", mockIteration());
      store.addChange(mockChange());
      store.addDomChange(mockDomChange());

      const state = store.getState();
      expect(Object.keys(state.iterations)).toHaveLength(1);
      expect(state.changes).toHaveLength(1);
      expect(state.domChanges).toHaveLength(1);
    });
  });
});
