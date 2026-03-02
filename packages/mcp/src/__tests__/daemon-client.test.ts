import { describe, it, expect, vi, beforeEach } from "vitest";
import { DaemonClient } from "../connection/daemon-client.js";
import type { ServerMessage, IterateState, AnnotationData, IterationInfo } from "iterate-ui-core";
import { DEFAULT_CONFIG } from "iterate-ui-core";

function createClient(): DaemonClient {
  return new DaemonClient(4000);
}

function sendMessage(client: DaemonClient, msg: ServerMessage) {
  (client as any).handleMessage(msg);
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
      componentName: "Card",
      sourceLocation: "src/Card.tsx:10",
    }],
    comment: "Fix this",
    timestamp: 1000,
    status: "pending",
    ...overrides,
  };
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

function freshState(): IterateState {
  return {
    config: { ...DEFAULT_CONFIG },
    iterations: {},
    annotations: [],
    domChanges: [],
  };
}

describe("DaemonClient", () => {
  describe("before state:sync", () => {
    it("getAnnotations returns empty array", () => {
      const client = createClient();
      expect(client.getAnnotations()).toEqual([]);
    });

    it("getIterations returns empty object", () => {
      const client = createClient();
      expect(client.getIterations()).toEqual({});
    });

    it("getState returns null", () => {
      const client = createClient();
      expect(client.getState()).toBeNull();
    });
  });

  describe("state:sync", () => {
    it("sets the full state", () => {
      const client = createClient();
      const state = { ...freshState(), annotations: [mockAnnotation()] };
      sendMessage(client, { type: "state:sync", payload: state });
      expect(client.getState()).toEqual(state);
      expect(client.getAnnotations()).toHaveLength(1);
    });
  });

  describe("annotation messages", () => {
    let client: DaemonClient;

    beforeEach(() => {
      client = createClient();
      sendMessage(client, { type: "state:sync", payload: freshState() });
    });

    it("annotation:created appends to annotations", () => {
      const ann = mockAnnotation({ id: "new-1" });
      sendMessage(client, { type: "annotation:created", payload: ann });
      expect(client.getAnnotations()).toHaveLength(1);
      expect(client.getAnnotations()[0]!.id).toBe("new-1");
    });

    it("annotation:updated replaces annotation by id", () => {
      const ann = mockAnnotation({ id: "x1", comment: "old" });
      sendMessage(client, { type: "annotation:created", payload: ann });
      sendMessage(client, {
        type: "annotation:updated",
        payload: mockAnnotation({ id: "x1", comment: "new" }),
      });
      expect(client.getAnnotations()[0]!.comment).toBe("new");
    });

    it("annotation:updated ignores unknown id", () => {
      sendMessage(client, {
        type: "annotation:updated",
        payload: mockAnnotation({ id: "nonexistent" }),
      });
      expect(client.getAnnotations()).toHaveLength(0);
    });

    it("annotation:deleted removes by id", () => {
      const ann = mockAnnotation({ id: "x1" });
      sendMessage(client, { type: "annotation:created", payload: ann });
      sendMessage(client, { type: "annotation:deleted", payload: { id: "x1" } });
      expect(client.getAnnotations()).toHaveLength(0);
    });
  });

  describe("iteration messages", () => {
    let client: DaemonClient;

    beforeEach(() => {
      client = createClient();
      sendMessage(client, { type: "state:sync", payload: freshState() });
    });

    it("iteration:created adds to state", () => {
      const iter = mockIteration({ name: "test" });
      sendMessage(client, { type: "iteration:created", payload: iter });
      expect(client.getIterations()["test"]).toBeDefined();
    });

    it("iteration:removed deletes from state", () => {
      const iter = mockIteration({ name: "test" });
      sendMessage(client, { type: "iteration:created", payload: iter });
      sendMessage(client, { type: "iteration:removed", payload: { name: "test" } });
      expect(client.getIterations()["test"]).toBeUndefined();
    });

    it("iteration:status updates status field", () => {
      const iter = mockIteration({ name: "test", status: "creating" });
      sendMessage(client, { type: "iteration:created", payload: iter });
      sendMessage(client, {
        type: "iteration:status",
        payload: { name: "test", status: "ready" },
      });
      expect(client.getIterations()["test"]!.status).toBe("ready");
    });

    it("iteration:status ignores unknown name", () => {
      expect(() =>
        sendMessage(client, {
          type: "iteration:status",
          payload: { name: "nope", status: "ready" },
        })
      ).not.toThrow();
    });
  });

  describe("batch:submitted", () => {
    it("does not change state (notification only)", () => {
      const client = createClient();
      sendMessage(client, { type: "state:sync", payload: freshState() });
      sendMessage(client, {
        type: "batch:submitted",
        payload: { batchId: "b1", annotationCount: 2, domChangeCount: 1 },
      });
      expect(client.getAnnotations()).toHaveLength(0);
    });
  });

  describe("command:started", () => {
    it("sets commandPrompt and commandId on matching iterations", () => {
      const client = createClient();
      const state = {
        ...freshState(),
        iterations: { "iter-1": mockIteration({ name: "iter-1" }) },
      };
      sendMessage(client, { type: "state:sync", payload: state });
      sendMessage(client, {
        type: "command:started",
        payload: { commandId: "cmd-1", prompt: "hero variations", iterations: ["iter-1"] },
      });

      expect(client.getIterations()["iter-1"]!.commandPrompt).toBe("hero variations");
      expect(client.getIterations()["iter-1"]!.commandId).toBe("cmd-1");
    });

    it("ignores iterations not in state", () => {
      const client = createClient();
      sendMessage(client, { type: "state:sync", payload: freshState() });
      expect(() =>
        sendMessage(client, {
          type: "command:started",
          payload: { commandId: "cmd-1", prompt: "test", iterations: ["nonexistent"] },
        })
      ).not.toThrow();
    });
  });

  describe("state listeners", () => {
    it("notifies listeners on message", () => {
      const client = createClient();
      const spy = vi.fn();
      (client as any).stateListeners.add(spy);

      sendMessage(client, { type: "state:sync", payload: freshState() });
      expect(spy).toHaveBeenCalled();
    });
  });
});
