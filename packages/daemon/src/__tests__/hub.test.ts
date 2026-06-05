import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocketHub } from "../websocket/hub.js";
import { StateStore } from "../state/store.js";
import { DEFAULT_CONFIG } from "iterate-ui-core";
import type { ClientMessage, ServerMessage } from "iterate-ui-core";

function createHub() {
  const store = new StateStore({ ...DEFAULT_CONFIG });
  const hub = new WebSocketHub(store);
  const sent: ServerMessage[] = [];
  const mockSocket = {
    readyState: 1,
    send: vi.fn((data: string) => sent.push(JSON.parse(data))),
  };
  // Add mock client to the hub's clients set
  (hub as any).clients.add(mockSocket);
  return { hub, store, mockSocket, sent };
}

function sendMessage(hub: WebSocketHub, msg: ClientMessage) {
  (hub as any).handleMessage(msg, {} as any);
}

describe("WebSocketHub", () => {
  let uuidCounter: number;

  beforeEach(() => {
    uuidCounter = 0;
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => `uuid-${++uuidCounter}` as `${string}-${string}-${string}-${string}-${string}`);
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("state broadcasts with appName", () => {
    it("state:sync includes the appName field on iterations", () => {
      const { store } = createHub();
      store.setIteration("v1", {
        name: "v1",
        branch: "iterate/v1",
        worktreePath: "/tmp/v1",
        port: 3100,
        pid: null,
        status: "ready",
        createdAt: "2025-01-01",
        appName: "brand-admin",
      });

      const state = store.getState();
      expect(state.iterations.v1.appName).toBe("brand-admin");
    });

    it("getIterations returns iterations with appName intact", () => {
      const { store } = createHub();
      store.setIteration("a", {
        name: "a",
        branch: "iterate/a",
        worktreePath: "/tmp/a",
        port: 3101,
        pid: null,
        status: "ready",
        createdAt: "2025-01-01",
        appName: "web",
      });
      store.setIteration("b", {
        name: "b",
        branch: "iterate/b",
        worktreePath: "/tmp/b",
        port: 3102,
        pid: null,
        status: "ready",
        createdAt: "2025-01-01",
        appName: "admin",
      });

      const all = store.getIterations();
      expect(all.a.appName).toBe("web");
      expect(all.b.appName).toBe("admin");
    });
  });

  describe("change:create", () => {
    it("stores change with generated id, timestamp, and queued status", () => {
      const { hub, store } = createHub();
      sendMessage(hub, {
        type: "change:create",
        payload: {
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
        } as any,
      });

      const changes = store.getChanges();
      expect(changes).toHaveLength(1);
      expect(changes[0]!.id).toBe("uuid-1");
      expect(changes[0]!.timestamp).toBe(1700000000000);
      expect(changes[0]!.status).toBe("queued");
    });

    it("broadcasts change:created", () => {
      const { hub, sent } = createHub();
      sendMessage(hub, {
        type: "change:create",
        payload: {
          iteration: "iter-a",
          elements: [],
          comment: "test",
        } as any,
      });

      expect(sent).toHaveLength(1);
      expect(sent[0]!.type).toBe("change:created");
    });
  });

  describe("change:delete", () => {
    it("removes change and broadcasts", () => {
      const { hub, store, sent } = createHub();
      store.addChange({
        id: "existing",
        iteration: "iter-a",
        elements: [],
        comment: "test",
        timestamp: 1000,
        status: "queued",
      });

      sendMessage(hub, { type: "change:delete", payload: { id: "existing" } });

      expect(store.getChanges()).toHaveLength(0);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.type).toBe("change:deleted");
    });

    it("does not broadcast if change not found", () => {
      const { hub, sent } = createHub();
      sendMessage(hub, { type: "change:delete", payload: { id: "nonexistent" } });
      expect(sent).toHaveLength(0);
    });
  });

  describe("batch:submit", () => {
    it("creates all changes from batch with queued status", () => {
      const { hub, store } = createHub();
      sendMessage(hub, {
        type: "batch:submit",
        payload: {
          iteration: "iter-a",
          changes: [
            { iteration: "iter-a", elements: [], comment: "a" } as any,
            { iteration: "iter-a", elements: [], comment: "b" } as any,
          ],
          domChanges: [],
        },
      });

      expect(store.getChanges()).toHaveLength(2);
      expect(store.getChanges().every((a) => a.status === "queued")).toBe(true);
    });

    it("stores DOM changes from batch", () => {
      const { hub, store } = createHub();
      const change = {
        id: "dc-1",
        iteration: "iter-a",
        selector: "div",
        type: "move" as const,
        componentName: null,
        sourceLocation: null,
        before: { rect: { x: 0, y: 0, width: 100, height: 50 }, computedStyles: {} },
        after: { rect: { x: 10, y: 10, width: 100, height: 50 }, computedStyles: {} },
        timestamp: 1000,
      };

      sendMessage(hub, {
        type: "batch:submit",
        payload: {
          iteration: "iter-a",
          changes: [],
          domChanges: [change],
        },
      });

      expect(store.getDomChanges()).toHaveLength(1);
    });

    it("broadcasts change:created for each plus batch:submitted", () => {
      const { hub, sent } = createHub();
      sendMessage(hub, {
        type: "batch:submit",
        payload: {
          iteration: "iter-a",
          changes: [
            { iteration: "iter-a", elements: [], comment: "a" } as any,
            { iteration: "iter-a", elements: [], comment: "b" } as any,
          ],
          domChanges: [],
        },
      });

      const types = sent.map((m) => m.type);
      expect(types.filter((t) => t === "change:created")).toHaveLength(2);
      expect(types).toContain("batch:submitted");
    });

    it("broadcasts batch:submitted with correct counts", () => {
      const { hub, sent } = createHub();
      sendMessage(hub, {
        type: "batch:submit",
        payload: {
          iteration: "iter-a",
          changes: [
            { iteration: "iter-a", elements: [], comment: "a" } as any,
            { iteration: "iter-a", elements: [], comment: "b" } as any,
            { iteration: "iter-a", elements: [], comment: "c" } as any,
          ],
          domChanges: [{} as any],
        },
      });

      const batchMsg = sent.find((m) => m.type === "batch:submitted");
      expect(batchMsg).toBeDefined();
      expect((batchMsg as any).payload.changeCount).toBe(3);
      expect((batchMsg as any).payload.domChangeCount).toBe(1);
    });
  });

  describe("dom:move", () => {
    it("creates DomChange with type=move", () => {
      const { hub, store } = createHub();
      sendMessage(hub, {
        type: "dom:move",
        payload: {
          iteration: "iter-a",
          selector: "div.hero",
          from: { x: 0, y: 0, width: 100, height: 50 },
          to: { x: 20, y: 30, width: 100, height: 50 },
        },
      });

      const changes = store.getDomChanges();
      expect(changes).toHaveLength(1);
      expect(changes[0]!.type).toBe("move");
      expect(changes[0]!.before.rect).toEqual({ x: 0, y: 0, width: 100, height: 50 });
      expect(changes[0]!.after.rect).toEqual({ x: 20, y: 30, width: 100, height: 50 });
      expect(changes[0]!.componentName).toBeNull();
    });

    it("broadcasts dom:changed", () => {
      const { hub, sent } = createHub();
      sendMessage(hub, {
        type: "dom:move",
        payload: {
          iteration: "iter-a",
          selector: "div",
          from: { x: 0, y: 0, width: 0, height: 0 },
          to: { x: 1, y: 1, width: 0, height: 0 },
        },
      });

      expect(sent[0]!.type).toBe("dom:changed");
    });
  });

  describe("dom:reorder", () => {
    it("creates DomChange with type=reorder and siblingIndex", () => {
      const { hub, store } = createHub();
      sendMessage(hub, {
        type: "dom:reorder",
        payload: { iteration: "iter-a", selector: "li.item", newIndex: 3 },
      });

      const changes = store.getDomChanges();
      expect(changes).toHaveLength(1);
      expect(changes[0]!.type).toBe("reorder");
      expect(changes[0]!.after.siblingIndex).toBe(3);
    });
  });

  describe("no-op message types", () => {
    it("dom:select does not throw or store changes", () => {
      const { hub, store, sent } = createHub();
      expect(() =>
        sendMessage(hub, {
          type: "dom:select",
          payload: { iteration: "iter-a", selector: "div" },
        })
      ).not.toThrow();
      expect(store.getDomChanges()).toHaveLength(0);
    });
  });

  describe("broadcast filtering", () => {
    it("skips clients with readyState !== 1", () => {
      const store = new StateStore({ ...DEFAULT_CONFIG });
      const hub = new WebSocketHub(store);
      const activeSend = vi.fn();
      const closedSend = vi.fn();
      (hub as any).clients.add({ readyState: 1, send: activeSend });
      (hub as any).clients.add({ readyState: 3, send: closedSend });

      hub.broadcast({ type: "error", payload: { message: "test" } });

      expect(activeSend).toHaveBeenCalled();
      expect(closedSend).not.toHaveBeenCalled();
    });
  });
});
