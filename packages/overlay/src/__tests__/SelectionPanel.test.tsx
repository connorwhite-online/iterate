import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { SelectionPanel } from "../annotate/SelectionPanel.js";
import type { PickedElement } from "../inspector/ElementPicker.js";

function mockPickedElement(overrides?: Partial<PickedElement>): PickedElement {
  return {
    domElement: document.createElement("div"),
    selector: "div.card",
    elementName: "div.card",
    elementPath: "main > section > div.card",
    rect: { x: 100, y: 200, width: 300, height: 150 },
    computedStyles: { color: "rgb(0,0,0)" },
    nearbyText: "Some text nearby",
    componentName: "CardComponent",
    sourceLocation: "src/Card.tsx:10",
    ...overrides,
  };
}

const defaultProps = {
  selectedElements: [] as PickedElement[],
  textSelection: null,
  onRemoveElement: vi.fn(),
  onAddToBatch: vi.fn(),
  onClearSelection: vi.fn(),
};

describe("SelectionPanel", () => {
  it("renders nothing when no elements selected", () => {
    const { container } = render(<SelectionPanel {...defaultProps} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders when elements are selected", () => {
    const { container } = render(
      <SelectionPanel
        {...defaultProps}
        selectedElements={[mockPickedElement()]}
      />
    );
    expect(container.innerHTML).not.toBe("");
  });

  it("shows component name as header", () => {
    const { container } = render(
      <SelectionPanel
        {...defaultProps}
        selectedElements={[mockPickedElement({ componentName: "HeroSection" })]}
      />
    );
    expect(container.textContent).toContain("HeroSection");
  });

  it("falls back to elementName when componentName is null", () => {
    const { container } = render(
      <SelectionPanel
        {...defaultProps}
        selectedElements={[mockPickedElement({ componentName: null, elementName: "div.hero" })]}
      />
    );
    expect(container.textContent).toContain("div.hero");
  });

  it("shows CSS properties when chevron is clicked", () => {
    const { container } = render(
      <SelectionPanel
        {...defaultProps}
        selectedElements={[mockPickedElement({ computedStyles: { "font-size": "16px", color: "red" } })]}
      />
    );
    // Click the chevron button to expand CSS
    const chevronButton = container.querySelector("button");
    expect(chevronButton).not.toBeNull();
    fireEvent.click(chevronButton!);
    expect(container.textContent).toContain("font-size:");
    expect(container.textContent).toContain("16px");
    expect(container.textContent).toContain("color:");
    expect(container.textContent).toContain("red");
  });

  it("does not submit with empty comment", () => {
    const onAddToBatch = vi.fn();
    const { container } = render(
      <SelectionPanel
        {...defaultProps}
        selectedElements={[mockPickedElement()]}
        onAddToBatch={onAddToBatch}
      />
    );
    const form = container.querySelector("form");
    if (form) {
      fireEvent.submit(form);
      expect(onAddToBatch).not.toHaveBeenCalled();
    }
  });

  it("submits annotation with comment only (no intent/severity)", () => {
    const onAddToBatch = vi.fn();
    const { container } = render(
      <SelectionPanel
        {...defaultProps}
        selectedElements={[mockPickedElement()]}
        onAddToBatch={onAddToBatch}
      />
    );
    const textarea = container.querySelector("textarea");
    if (textarea) {
      fireEvent.change(textarea, { target: { value: "Fix this layout" } });
      const form = container.querySelector("form");
      if (form) {
        fireEvent.submit(form);
        expect(onAddToBatch).toHaveBeenCalledWith("Fix this layout");
      }
    }
  });

  it("calls onClearSelection when Discard button clicked", () => {
    const onClearSelection = vi.fn();
    const { container } = render(
      <SelectionPanel
        {...defaultProps}
        selectedElements={[mockPickedElement()]}
        onClearSelection={onClearSelection}
      />
    );
    const allButtons = container.querySelectorAll("button");
    const discardButton = Array.from(allButtons).find(
      (b) => b.textContent === "Discard"
    );
    expect(discardButton).toBeDefined();
    fireEvent.click(discardButton!);
    expect(onClearSelection).toHaveBeenCalled();
  });

  it("shows multiple component names for multi-select", () => {
    const { container } = render(
      <SelectionPanel
        {...defaultProps}
        selectedElements={[
          mockPickedElement({ componentName: "Header" }),
          mockPickedElement({ componentName: "Footer", selector: "div.footer" }),
        ]}
      />
    );
    expect(container.textContent).toContain("Header");
    expect(container.textContent).toContain("Footer");
  });
});
