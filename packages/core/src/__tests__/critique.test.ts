import { describe, it, expect } from "vitest";
import { formatCritiquePrompt } from "../format.js";
import { selectPrinciples, DESIGN_PRINCIPLES, getPrinciple } from "../knowledge/index.js";
import type { PageSnapshot, SnapshotNode } from "../types/annotations.js";

function node(overrides?: Partial<SnapshotNode>): SnapshotNode {
  return {
    selector: "button.cta",
    elementName: "button \"Buy\"",
    tagName: "button",
    elementPath: "main > button.cta",
    rect: { x: 10, y: 20, width: 80, height: 32 },
    computedStyles: { height: "32px", "background-color": "rgb(0,0,0)" },
    nearbyText: "Buy",
    componentName: "Cta",
    sourceLocation: "src/Cta.tsx:4",
    depth: 1,
    ...overrides,
  };
}

function snapshot(nodes: SnapshotNode[]): PageSnapshot {
  return {
    url: "http://localhost:3000/",
    viewport: { width: 1280, height: 800 },
    capturedAt: 1,
    nodes,
  };
}

describe("selectPrinciples", () => {
  it("includes interaction/a11y principles when an interactive element is present", () => {
    const selected = selectPrinciples([node()]);
    const ids = selected.map((p) => p.id);
    expect(ids).toContain("a11y-target-size");
    expect(ids).toContain("interaction-fitts");
  });

  it("includes typography principles when text styles are present", () => {
    const selected = selectPrinciples([
      node({ tagName: "p", selector: "p", elementName: "p", computedStyles: { "font-size": "13px", "line-height": "1.2" } }),
    ]);
    expect(selected.map((p) => p.id)).toContain("type-min-body-size");
  });

  it("never returns more than the full corpus", () => {
    const selected = selectPrinciples([node()]);
    expect(selected.length).toBeLessThanOrEqual(DESIGN_PRINCIPLES.length);
  });
});

describe("formatCritiquePrompt", () => {
  it("includes page metadata, the element, and at least one principle with a citation", () => {
    const text = formatCritiquePrompt(snapshot([node()]));
    expect(text).toContain("# Design Critique Request");
    expect(text).toContain("http://localhost:3000/");
    expect(text).toContain("button.cta");
    expect(text).toContain("src/Cta.tsx:4");
    // a cited principle id + source line
    expect(text).toContain("`a11y-target-size`");
    expect(text).toContain("**Source**:");
  });

  it("respects an explicit principle list", () => {
    const p = getPrinciple("color-text-contrast")!;
    const text = formatCritiquePrompt(snapshot([node()]), [p]);
    expect(text).toContain("`color-text-contrast`");
    expect(text).not.toContain("`a11y-target-size`");
  });
});
