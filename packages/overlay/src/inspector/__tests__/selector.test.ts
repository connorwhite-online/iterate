import { describe, it, expect } from "vitest";
import {
  generateSelector,
  getElementPath,
  identifyElement,
  getNearbyText,
  getComponentInfo,
} from "../selector.js";

describe("generateSelector", () => {
  it("returns #id for element with id", () => {
    const el = document.createElement("div");
    el.id = "hero";
    document.body.appendChild(el);
    expect(generateSelector(el)).toBe("#hero");
    el.remove();
  });

  it("builds path selector for element without id", () => {
    const container = document.createElement("main");
    const section = document.createElement("section");
    const div = document.createElement("div");
    container.appendChild(section);
    section.appendChild(div);
    document.body.appendChild(container);

    const selector = generateSelector(div);
    expect(selector).toContain("div");
    // Should be some kind of path
    expect(selector.length).toBeGreaterThan(0);

    container.remove();
  });

  it("uses nth-child for disambiguation among siblings", () => {
    const parent = document.createElement("div");
    const child1 = document.createElement("p");
    const child2 = document.createElement("p");
    parent.appendChild(child1);
    parent.appendChild(child2);
    document.body.appendChild(parent);

    const sel1 = generateSelector(child1);
    const sel2 = generateSelector(child2);
    // The two siblings should get different selectors
    expect(sel1).not.toBe(sel2);

    parent.remove();
  });
});

describe("getElementPath", () => {
  it("returns path with ancestor chain", () => {
    const main = document.createElement("main");
    const section = document.createElement("section");
    const div = document.createElement("div");
    main.appendChild(section);
    section.appendChild(div);
    document.body.appendChild(main);

    const path = getElementPath(div);
    expect(path).toContain("main");
    expect(path).toContain("section");
    expect(path).toContain("div");

    main.remove();
  });

  it("includes class names in path", () => {
    const wrapper = document.createElement("div");
    wrapper.className = "container";
    const inner = document.createElement("span");
    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);

    const path = getElementPath(inner);
    expect(path).toContain("div.container");

    wrapper.remove();
  });

  it("handles single-level element", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const path = getElementPath(el);
    expect(path).toContain("div");
    el.remove();
  });
});

describe("identifyElement", () => {
  it("identifies button with aria-label", () => {
    const btn = document.createElement("button");
    btn.setAttribute("aria-label", "Close");
    btn.textContent = "X";
    document.body.appendChild(btn);
    const name = identifyElement(btn);
    expect(name).toContain("Close");
    btn.remove();
  });

  it("identifies button with text content", () => {
    const btn = document.createElement("button");
    btn.textContent = "Submit";
    document.body.appendChild(btn);
    const name = identifyElement(btn);
    expect(name).toContain("Submit");
    btn.remove();
  });

  it("identifies link with text", () => {
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = "Learn more";
    document.body.appendChild(a);
    const name = identifyElement(a);
    expect(name).toContain("Learn more");
    a.remove();
  });

  it("identifies input with type and name", () => {
    const input = document.createElement("input");
    input.type = "email";
    input.name = "userEmail";
    document.body.appendChild(input);
    const name = identifyElement(input);
    expect(name).toContain("email");
    input.remove();
  });

  it("identifies image with alt", () => {
    const img = document.createElement("img");
    img.alt = "Profile photo";
    document.body.appendChild(img);
    const name = identifyElement(img);
    expect(name).toContain("Profile photo");
    img.remove();
  });

  it("identifies heading with text", () => {
    const h2 = document.createElement("h2");
    h2.textContent = "Features";
    document.body.appendChild(h2);
    const name = identifyElement(h2);
    expect(name).toContain("Features");
    h2.remove();
  });

  it("falls back to tag name for generic element", () => {
    const el = document.createElement("section");
    document.body.appendChild(el);
    const name = identifyElement(el);
    expect(name).toContain("section");
    el.remove();
  });
});

describe("getNearbyText", () => {
  it("captures own text and sibling text", () => {
    const parent = document.createElement("div");
    const prev = document.createElement("p");
    prev.textContent = "Previous";
    const current = document.createElement("p");
    current.textContent = "Current";
    const next = document.createElement("p");
    next.textContent = "Next";
    parent.appendChild(prev);
    parent.appendChild(current);
    parent.appendChild(next);
    document.body.appendChild(parent);

    const text = getNearbyText(current);
    expect(text).toContain("Current");

    parent.remove();
  });

  it("handles element with no text", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const text = getNearbyText(el);
    expect(text).toBeDefined();
    el.remove();
  });
});

describe("getComponentInfo", () => {
  it("finds data-iterate-component on parent", () => {
    const parent = document.createElement("div");
    parent.setAttribute("data-iterate-component", "HeroSection");
    parent.setAttribute("data-iterate-source", "src/Hero.tsx:5");
    const child = document.createElement("span");
    parent.appendChild(child);
    document.body.appendChild(parent);

    const info = getComponentInfo(child);
    expect(info.component).toBe("HeroSection");
    expect(info.source).toBe("src/Hero.tsx:5");

    parent.remove();
  });

  it("walks up multiple levels", () => {
    const grandparent = document.createElement("div");
    grandparent.setAttribute("data-iterate-component", "Card");
    grandparent.setAttribute("data-iterate-source", "src/Card.tsx:10");
    const parent = document.createElement("div");
    const child = document.createElement("span");
    grandparent.appendChild(parent);
    parent.appendChild(child);
    document.body.appendChild(grandparent);

    const info = getComponentInfo(child);
    expect(info.component).toBe("Card");
    expect(info.source).toBe("src/Card.tsx:10");

    grandparent.remove();
  });

  it("returns nulls when no attributes found", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);

    const info = getComponentInfo(el);
    expect(info.component).toBeNull();
    expect(info.source).toBeNull();

    el.remove();
  });
});
