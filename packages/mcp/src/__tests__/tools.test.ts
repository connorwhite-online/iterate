import { describe, it, expect, vi } from "vitest";
import { getAnnotationTools } from "../tools/annotations.js";
import { getIterationTools } from "../tools/iterations.js";
import type { AnnotationData, IterationInfo, IterateState, DomChange } from "@iterate/core";
import { DEFAULT_CONFIG } from "@iterate/core";

function mockAnnotation(overrides?: Partial<AnnotationData>): AnnotationData {
  return {
    id: "ann-1",
    iteration: "iter-a",
    elements: [{
      selector: "div.hero",
      elementName: "div.hero",
      elementPath: "main > div.hero",
      rect: { x: 100, y: 200, width: 300, height: 150 },
      computedStyles: { color: "rgb(0,0,0)", fontSize: "16px" },
      componentName: "HeroSection",
      sourceLocation: "src/Hero.tsx:42",
      nearbyText: "Welcome to our site",
    }],
    comment: "Fix the hero layout",
    timestamp: 1700000000000,
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

function mockClient(opts: {
  annotations?: AnnotationData[];
  iterations?: Record<string, IterationInfo>;
  state?: IterateState;
} = {}) {
  return {
    getAnnotations: vi.fn(() => opts.annotations ?? []),
    getIterations: vi.fn(() => opts.iterations ?? {}),
    getState: vi.fn(() => opts.state ?? null),
    callApi: vi.fn(async () => ({ ok: true })),
  } as any;
}

describe("annotation tools (legacy formatters)", () => {
  describe("iterate_list_annotations", () => {
    it("returns 'No annotations found.' when empty", async () => {
      const client = mockClient({ annotations: [] });
      const tools = getAnnotationTools(client);
      const listTool = tools.find((t) => t.name === "iterate_list_annotations")!;
      const result = await listTool.handler({});
      expect(result.content[0].text).toBe("No annotations found.");
    });

    it("formats annotations with component names", async () => {
      const client = mockClient({ annotations: [mockAnnotation()] });
      const tools = getAnnotationTools(client);
      const listTool = tools.find((t) => t.name === "iterate_list_annotations")!;
      const result = await listTool.handler({});
      const text = result.content[0].text;
      expect(text).toContain("<HeroSection>");
      expect(text).toContain("src/Hero.tsx:42");
      expect(text).toContain("Fix the hero layout");
    });

    it("filters by iteration", async () => {
      const annotations = [
        mockAnnotation({ id: "a1", iteration: "iter-a" }),
        mockAnnotation({ id: "a2", iteration: "iter-b" }),
      ];
      const client = mockClient({ annotations });
      const tools = getAnnotationTools(client);
      const listTool = tools.find((t) => t.name === "iterate_list_annotations")!;
      const result = await listTool.handler({ iteration: "iter-a" });
      const text = result.content[0].text;
      expect(text).toContain("iter-a");
      expect(text).not.toContain("iter-b");
    });

    it("filters by status", async () => {
      const annotations = [
        mockAnnotation({ id: "a1", status: "pending" }),
        mockAnnotation({ id: "a2", status: "resolved" }),
      ];
      const client = mockClient({ annotations });
      const tools = getAnnotationTools(client);
      const listTool = tools.find((t) => t.name === "iterate_list_annotations")!;
      const result = await listTool.handler({ status: "pending" });
      const text = result.content[0].text;
      expect(text).toContain("a1");
      expect(text).not.toContain("a2");
    });

    it("includes text selection when present", async () => {
      const ann = mockAnnotation({
        textSelection: {
          text: "Selected text content here",
          containingElement: mockAnnotation().elements[0]!,
          startOffset: 0,
          endOffset: 25,
        },
      });
      const client = mockClient({ annotations: [ann] });
      const tools = getAnnotationTools(client);
      const listTool = tools.find((t) => t.name === "iterate_list_annotations")!;
      const result = await listTool.handler({});
      expect(result.content[0].text).toContain("Selected text content here");
    });
  });

  describe("iterate_get_dom_context", () => {
    it("returns 'not found' for unknown annotation ID", async () => {
      const client = mockClient({ annotations: [] });
      const tools = getAnnotationTools(client);
      const domTool = tools.find((t) => t.name === "iterate_get_dom_context")!;
      const result = await domTool.handler({ annotationId: "nonexistent" });
      expect(result.content[0].text).toContain("not found");
    });

    it("formats full element details", async () => {
      const client = mockClient({ annotations: [mockAnnotation({ id: "ann-1" })] });
      const tools = getAnnotationTools(client);
      const domTool = tools.find((t) => t.name === "iterate_get_dom_context")!;
      const result = await domTool.handler({ annotationId: "ann-1" });
      const text = result.content[0].text;
      expect(text).toContain("<HeroSection>");
      expect(text).toContain("src/Hero.tsx:42");
      expect(text).toContain("div.hero");
      expect(text).toContain("main > div.hero");
    });
  });
});

describe("iteration tools (legacy formatters)", () => {
  describe("iterate_list_iterations", () => {
    it("returns message when no iterations", async () => {
      const client = mockClient({ iterations: {} });
      const tools = getIterationTools(client);
      const listTool = tools.find((t) => t.name === "iterate_list_iterations")!;
      const result = await listTool.handler();
      expect(result.content[0].text).toContain("No active iterations");
    });

    it("formats iteration info", async () => {
      const iterations = {
        "test": mockIteration({ name: "test", port: 3101, status: "ready" }),
      };
      const client = mockClient({ iterations });
      const tools = getIterationTools(client);
      const listTool = tools.find((t) => t.name === "iterate_list_iterations")!;
      const result = await listTool.handler();
      const text = result.content[0].text;
      expect(text).toContain("test");
      expect(text).toContain("3101");
      expect(text).toContain("ready");
    });

    it("includes commandPrompt when present", async () => {
      const iterations = {
        "test": mockIteration({ name: "test", commandPrompt: "make a hero section" }),
      };
      const client = mockClient({ iterations });
      const tools = getIterationTools(client);
      const listTool = tools.find((t) => t.name === "iterate_list_iterations")!;
      const result = await listTool.handler();
      expect(result.content[0].text).toContain("make a hero section");
    });
  });

  describe("iterate_create_iteration", () => {
    it("calls callApi with correct arguments", async () => {
      const client = mockClient();
      const tools = getIterationTools(client);
      const createTool = tools.find((t) => t.name === "iterate_create_iteration")!;
      await createTool.handler({ name: "new-iter", baseBranch: "main" });
      expect(client.callApi).toHaveBeenCalledWith("POST", "/api/iterations", {
        name: "new-iter",
        baseBranch: "main",
      });
    });
  });
});
