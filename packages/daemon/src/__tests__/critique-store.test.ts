import { describe, it, expect, beforeEach } from "vitest";
import { StateStore } from "../state/store.js";
import { DEFAULT_CONFIG } from "iterate-ui-core";
import type { CritiqueRequest, CritiqueFinding, SnapshotNode } from "iterate-ui-core";

function createStore() {
  return new StateStore({ ...DEFAULT_CONFIG });
}

function mockNode(): SnapshotNode {
  return {
    selector: "button.cta",
    elementName: "button",
    tagName: "button",
    elementPath: "main > button",
    rect: { x: 0, y: 0, width: 80, height: 32 },
    computedStyles: {},
    componentName: null,
    sourceLocation: null,
    depth: 1,
  };
}

function mockRequest(overrides?: Partial<CritiqueRequest>): CritiqueRequest {
  return {
    id: "req-1",
    iteration: "iter-a",
    url: "http://localhost:3000/",
    snapshot: { url: "http://localhost:3000/", viewport: { width: 1, height: 1 }, capturedAt: 1, nodes: [mockNode()] },
    status: "pending",
    timestamp: 1000,
    ...overrides,
  };
}

function mockFinding(overrides?: Partial<CritiqueFinding>): CritiqueFinding {
  return {
    id: "find-1",
    iteration: "iter-a",
    requestId: "req-1",
    principleId: "a11y-target-size",
    principleTitle: "Adequate touch target size",
    category: "a11y",
    severity: "high",
    element: mockNode(),
    rationale: "32px < 44px",
    recommendation: "Increase height",
    status: "open",
    ...overrides,
  };
}

describe("StateStore — critique", () => {
  let store: StateStore;
  beforeEach(() => {
    store = createStore();
  });

  it("initializes empty critique arrays", () => {
    expect(store.getCritiqueRequests()).toEqual([]);
    expect(store.getCritiqueFindings()).toEqual([]);
  });

  it("adds and reads requests, filtering pending", () => {
    store.addCritiqueRequest(mockRequest());
    store.addCritiqueRequest(mockRequest({ id: "req-2", status: "complete" }));
    expect(store.getCritiqueRequests()).toHaveLength(2);
    expect(store.getPendingCritiqueRequests()).toHaveLength(1);
    expect(store.getCritiqueRequest("req-1")?.status).toBe("pending");
  });

  it("updates request status", () => {
    store.addCritiqueRequest(mockRequest());
    store.updateCritiqueRequest("req-1", { status: "in-progress" });
    expect(store.getCritiqueRequest("req-1")?.status).toBe("in-progress");
  });

  it("adds, updates and removes findings", () => {
    store.addCritiqueFinding(mockFinding());
    store.updateCritiqueFinding("find-1", { status: "applied" });
    expect(store.getCritiqueFinding("find-1")?.status).toBe("applied");
    expect(store.removeCritiqueFinding("find-1")).toBe(true);
    expect(store.getCritiqueFindings()).toHaveLength(0);
  });

  it("purges critique data when an iteration's data is removed", () => {
    store.addCritiqueRequest(mockRequest());
    store.addCritiqueRequest(mockRequest({ id: "req-b", iteration: "iter-b" }));
    store.addCritiqueFinding(mockFinding());
    store.addCritiqueFinding(mockFinding({ id: "find-b", iteration: "iter-b" }));

    const removed = store.removeIterationData("iter-a");
    expect(removed.critiqueRequestIds).toEqual(["req-1"]);
    expect(removed.critiqueFindingIds).toEqual(["find-1"]);
    expect(store.getCritiqueRequests().map((r) => r.id)).toEqual(["req-b"]);
    expect(store.getCritiqueFindings().map((f) => f.id)).toEqual(["find-b"]);
  });
});
