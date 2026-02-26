import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  AnnotationData,
  IterationInfo,
  DomChange,
  ServerMessage,
  IterateState,
} from "@iterate/core";
import { DEFAULT_CONFIG } from "@iterate/core";

// We test DaemonClient's message handling by accessing internal state.
// Since DaemonClient.handleMessage is private, we extract its logic via
// constructing a client, connecting to a mock WS, and injecting messages.
// For simplicity, we'll directly test the state management by importing
// the client and simulating the message flow via a test harness.

import { DaemonClient } from "../connection/daemon-client.js";

// Mock the 'ws' module so DaemonClient doesn't need a real server
vi.mock("ws", () => {
  class MockWebSocket {
    static OPEN = 1;
    readyState = 1;
    handlers: Record<string, Function[]> = {};

    constructor() {
      // Auto-fire "open" on next microtask so connect() resolves
      queueMicrotask(() => {
        for (const handler of this.handlers["open"] ?? []) handler();
      });
    }

    on(event: string, handler: Function) {
      if (!this.handlers[event]) this.handlers[event] = [];
      this.handlers[event]!.push(handler);
    }

    close() {
      this.readyState = 3;
    }

    send(_data: string) {}

    // Test helper: simulate receiving a message
    _receive(msg: ServerMessage) {
      const data = JSON.stringify(msg);
      for (const handler of this.handlers["message"] ?? []) {
        handler(Buffer.from(data));
      }
    }
  }

  return { WebSocket: MockWebSocket };
});

// Helper to get the mock WebSocket instance after connect()
function getWs(client: DaemonClient): any {
  return (client as any).ws;
}

function mockState(): IterateState {
  return {
    config: DEFAULT_CONFIG,
    iterations: {},
    annotations: [],
    domChanges: [],
  };
}

function mockAnnotation(overrides?: Partial<AnnotationData>): AnnotationData {
  return {
    id: "ann-1",
    iteration: "iter-a",
    elements: [
      {
        selector: "div.hero",
        elementName: "div.hero",
        elementPath: "main > div.hero",
        rect: { x: 100, y: 200, width: 300, height: 150 },
        computedStyles: { color: "rgb(0,0,0)" },
        componentName: "HeroSection",
        sourceLocation: "src/Hero.tsx:42",
        nearbyText: "Welcome",
      },
    ],
    comment: "Fix the hero layout",
    timestamp: 1700000000000,
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
    componentName: "Card",
    sourceLocation: "src/Card.tsx:5",
    before: { rect: { x: 0, y: 0, width: 200, height: 100 }, computedStyles: {} },
    after: { rect: { x: 50, y: 50, width: 200, height: 100 }, computedStyles: {} },
    timestamp: 1700000000001,
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

describe("DaemonClient message handling", () => {
  let client: DaemonClient;

  beforeEach(async () => {
    client = new DaemonClient(4000);
    await client.connect();
    // Inject initial state:sync
    const ws = getWs(client);
    ws._receive({ type: "state:sync", payload: mockState() });
  });

  it("tracks state after state:sync", () => {
    const state = client.getState();
    expect(state).not.toBeNull();
    expect(state!.annotations).toEqual([]);
    expect(state!.domChanges).toEqual([]);
  });

  it("tracks annotation:created", () => {
    const ws = getWs(client);
    const ann = mockAnnotation();
    ws._receive({ type: "annotation:created", payload: ann });
    expect(client.getAnnotations()).toHaveLength(1);
    expect(client.getAnnotations()[0]!.id).toBe("ann-1");
  });

  it("tracks annotation:updated", () => {
    const ws = getWs(client);
    const ann = mockAnnotation();
    ws._receive({ type: "annotation:created", payload: ann });
    ws._receive({
      type: "annotation:updated",
      payload: { ...ann, status: "resolved" as const },
    });
    expect(client.getAnnotations()[0]!.status).toBe("resolved");
  });

  it("tracks annotation:deleted", () => {
    const ws = getWs(client);
    ws._receive({ type: "annotation:created", payload: mockAnnotation() });
    expect(client.getAnnotations()).toHaveLength(1);
    ws._receive({ type: "annotation:deleted", payload: { id: "ann-1" } });
    expect(client.getAnnotations()).toHaveLength(0);
  });

  it("tracks dom:changed messages", () => {
    const ws = getWs(client);
    const dc = mockDomChange();
    ws._receive({ type: "dom:changed", payload: dc });
    expect(client.getDomChanges()).toHaveLength(1);
    expect(client.getDomChanges()[0]!.id).toBe("dc-1");
    expect(client.getDomChanges()[0]!.type).toBe("move");
  });

  it("tracks multiple dom:changed messages", () => {
    const ws = getWs(client);
    ws._receive({ type: "dom:changed", payload: mockDomChange({ id: "dc-1" }) });
    ws._receive({ type: "dom:changed", payload: mockDomChange({ id: "dc-2", type: "reorder" }) });
    expect(client.getDomChanges()).toHaveLength(2);
  });

  it("tracks iteration:created", () => {
    const ws = getWs(client);
    const iter = mockIteration();
    ws._receive({ type: "iteration:created", payload: iter });
    expect(Object.keys(client.getIterations())).toHaveLength(1);
    expect(client.getIterations()["iter-a"]!.status).toBe("ready");
  });

  it("tracks iteration:status", () => {
    const ws = getWs(client);
    ws._receive({ type: "iteration:created", payload: mockIteration() });
    ws._receive({ type: "iteration:status", payload: { name: "iter-a", status: "error" } });
    expect(client.getIterations()["iter-a"]!.status).toBe("error");
  });

  it("tracks iteration:removed", () => {
    const ws = getWs(client);
    ws._receive({ type: "iteration:created", payload: mockIteration() });
    expect(Object.keys(client.getIterations())).toHaveLength(1);
    ws._receive({ type: "iteration:removed", payload: { name: "iter-a" } });
    expect(Object.keys(client.getIterations())).toHaveLength(0);
  });

  it("fires batch:submitted listeners", () => {
    const ws = getWs(client);
    const handler = vi.fn();
    client.onBatchSubmitted(handler);

    ws._receive({
      type: "batch:submitted",
      payload: { batchId: "batch-1", annotationCount: 2, domChangeCount: 1 },
    });

    expect(handler).toHaveBeenCalledWith({
      batchId: "batch-1",
      annotationCount: 2,
      domChangeCount: 1,
    });
  });

  it("unsubscribes batch:submitted listener", () => {
    const ws = getWs(client);
    const handler = vi.fn();
    const unsub = client.onBatchSubmitted(handler);
    unsub();

    ws._receive({
      type: "batch:submitted",
      payload: { batchId: "batch-1", annotationCount: 0, domChangeCount: 0 },
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("tracks command:started context on iterations", () => {
    const ws = getWs(client);
    ws._receive({ type: "iteration:created", payload: mockIteration({ name: "alpha" }) });
    ws._receive({
      type: "command:started",
      payload: { commandId: "cmd-1", prompt: "make it blue", iterations: ["alpha"] },
    });
    expect(client.getIterations()["alpha"]!.commandPrompt).toBe("make it blue");
    expect(client.getIterations()["alpha"]!.commandId).toBe("cmd-1");
  });

  it("reports connected status", () => {
    expect(client.connected).toBe(true);
  });
});

describe("DaemonClient waitForState", () => {
  it("resolves immediately if state is already loaded", async () => {
    const client = new DaemonClient(4000);
    await client.connect();
    const ws = getWs(client);
    ws._receive({ type: "state:sync", payload: mockState() });

    const state = await client.waitForState();
    expect(state).not.toBeNull();
  });

  it("resolves when state arrives later", async () => {
    const client = new DaemonClient(4000);
    await client.connect();
    const ws = getWs(client);

    // Start waiting before state arrives
    const statePromise = client.waitForState(5000);

    // State arrives after a tick
    setTimeout(() => {
      ws._receive({ type: "state:sync", payload: mockState() });
    }, 10);

    const state = await statePromise;
    expect(state).not.toBeNull();
  });
});

describe("DaemonClient full batch flow", () => {
  it("accumulates annotations and dom changes from a batch", async () => {
    const client = new DaemonClient(4000);
    await client.connect();
    const ws = getWs(client);
    ws._receive({ type: "state:sync", payload: mockState() });

    // Simulate what the hub does when batch:submit arrives:
    // 1. annotation:created for each annotation
    // 2. dom:changed for each dom change
    // 3. batch:submitted notification

    ws._receive({
      type: "annotation:created",
      payload: mockAnnotation({ id: "batch-ann-1", comment: "Move this card left" }),
    });
    ws._receive({
      type: "annotation:created",
      payload: mockAnnotation({ id: "batch-ann-2", comment: "Make header bigger" }),
    });
    ws._receive({
      type: "dom:changed",
      payload: mockDomChange({ id: "batch-dc-1" }),
    });

    const batchHandler = vi.fn();
    client.onBatchSubmitted(batchHandler);

    ws._receive({
      type: "batch:submitted",
      payload: { batchId: "batch-1", annotationCount: 2, domChangeCount: 1 },
    });

    // Verify all data is in state
    expect(client.getAnnotations()).toHaveLength(2);
    expect(client.getDomChanges()).toHaveLength(1);
    expect(batchHandler).toHaveBeenCalledTimes(1);

    // Verify the data is accessible for MCP tools
    const pending = client.getAnnotations().filter((a) => a.status === "pending");
    expect(pending).toHaveLength(2);
    expect(client.getDomChanges()[0]!.type).toBe("move");
  });
});
