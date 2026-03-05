import { describe, it, expect, vi, beforeEach } from "vitest";
import { DaemonClient } from "../connection/daemon-client.js";
import type { ServerMessage, IterateState, Change, IterationInfo } from "iterate-ui-core";
import { DEFAULT_CONFIG } from "iterate-ui-core";

function createClient(): DaemonClient {
  return new DaemonClient(4000);
}

function sendMessage(client: DaemonClient, msg: ServerMessage) {
  (client as any).handleMessage(msg);
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
      componentName: "Card",
      sourceLocation: "src/Card.tsx:10",
    }],
    comment: "Fix this",
    timestamp: 1000,
    status: "queued",
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
    changes: [],
    domChanges: [],
  };
}

describe("DaemonClient", () => {
  describe("before state:sync", () => {
    it("getChanges returns empty array", () => {
      const client = createClient();
      expect(client.getChanges()).toEqual([]);
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
      const state = { ...freshState(), changes: [mockChange()] };
      sendMessage(client, { type: "state:sync", payload: state });
      expect(client.getState()).toEqual(state);
      expect(client.getChanges()).toHaveLength(1);
    });
  });

  describe("change messages", () => {
    let client: DaemonClient;

    beforeEach(() => {
      client = createClient();
      sendMessage(client, { type: "state:sync", payload: freshState() });
    });

    it("change:created appends to changes", () => {
      const chg = mockChange({ id: "new-1" });
      sendMessage(client, { type: "change:created", payload: chg });
      expect(client.getChanges()).toHaveLength(1);
      expect(client.getChanges()[0]!.id).toBe("new-1");
    });

    it("change:updated replaces change by id", () => {
      const chg = mockChange({ id: "x1", comment: "old" });
      sendMessage(client, { type: "change:created", payload: chg });
      sendMessage(client, {
        type: "change:updated",
        payload: mockChange({ id: "x1", comment: "new" }),
      });
      expect(client.getChanges()[0]!.comment).toBe("new");
    });

    it("change:updated ignores unknown id", () => {
      sendMessage(client, {
        type: "change:updated",
        payload: mockChange({ id: "nonexistent" }),
      });
      expect(client.getChanges()).toHaveLength(0);
    });

    it("change:deleted removes by id", () => {
      const chg = mockChange({ id: "x1" });
      sendMessage(client, { type: "change:created", payload: chg });
      sendMessage(client, { type: "change:deleted", payload: { id: "x1" } });
      expect(client.getChanges()).toHaveLength(0);
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
        payload: { batchId: "b1", changeCount: 2, domChangeCount: 1 },
      });
      expect(client.getChanges()).toHaveLength(0);
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
