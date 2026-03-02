import { describe, it, expect, vi, beforeEach } from "vitest";
import { StateStore } from "../state/store.js";
import { DEFAULT_CONFIG } from "iterate-ui-core";
import type { AnnotationData, IterationInfo, DomChange } from "iterate-ui-core";

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

function mockAnnotation(overrides?: Partial<AnnotationData>): AnnotationData {
  return {
    id: "ann-1",
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
    status: "pending",
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
      expect(state).toHaveProperty("annotations");
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

  describe("annotations", () => {
    it("getAnnotations returns empty array initially", () => {
      expect(store.getAnnotations()).toEqual([]);
    });

    it("addAnnotation + getAnnotation retrieves by id", () => {
      const ann = mockAnnotation({ id: "x1" });
      store.addAnnotation(ann);
      expect(store.getAnnotation("x1")).toEqual(ann);
    });

    it("getAnnotation returns undefined for nonexistent id", () => {
      expect(store.getAnnotation("nope")).toBeUndefined();
    });

    it("getPendingAnnotations filters by status", () => {
      store.addAnnotation(mockAnnotation({ id: "a1", status: "pending" }));
      store.addAnnotation(mockAnnotation({ id: "a2", status: "resolved" }));
      store.addAnnotation(mockAnnotation({ id: "a3", status: "pending" }));
      const pending = store.getPendingAnnotations();
      expect(pending).toHaveLength(2);
      expect(pending.map((a) => a.id)).toEqual(["a1", "a3"]);
    });

    it("updateAnnotation applies partial updates", () => {
      store.addAnnotation(mockAnnotation({ id: "a1", comment: "old" }));
      const result = store.updateAnnotation("a1", { comment: "new", status: "resolved" });
      expect(result?.comment).toBe("new");
      expect(result?.status).toBe("resolved");
      expect(result?.id).toBe("a1");
    });

    it("updateAnnotation returns null for nonexistent id", () => {
      expect(store.updateAnnotation("nope", { comment: "x" })).toBeNull();
    });

    it("removeAnnotation returns true and deletes", () => {
      store.addAnnotation(mockAnnotation({ id: "a1" }));
      expect(store.removeAnnotation("a1")).toBe(true);
      expect(store.getAnnotation("a1")).toBeUndefined();
    });

    it("removeAnnotation returns false for nonexistent id", () => {
      expect(store.removeAnnotation("nope")).toBe(false);
    });

    it("handles multiple annotations", () => {
      for (let i = 0; i < 5; i++) {
        store.addAnnotation(mockAnnotation({ id: `a${i}` }));
      }
      expect(store.getAnnotations()).toHaveLength(5);
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

    it("getLatestCommand returns most recently created", () => {
      vi.spyOn(Date, "now")
        .mockReturnValueOnce(1000)
        .mockReturnValueOnce(3000)
        .mockReturnValueOnce(2000);
      store.setCommandContext("cmd-1", "first", []);
      store.setCommandContext("cmd-2", "second", []);
      store.setCommandContext("cmd-3", "third", []);
      expect(store.getLatestCommand()?.commandId).toBe("cmd-2");
      vi.restoreAllMocks();
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
      store.addAnnotation(mockAnnotation());
      store.addDomChange(mockDomChange());

      const state = store.getState();
      expect(Object.keys(state.iterations)).toHaveLength(1);
      expect(state.annotations).toHaveLength(1);
      expect(state.domChanges).toHaveLength(1);
    });
  });
});
