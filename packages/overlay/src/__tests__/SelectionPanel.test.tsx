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

  it("shows component names for selected elements", () => {
    const { container } = render(
      <SelectionPanel
        {...defaultProps}
        selectedElements={[mockPickedElement({ componentName: "HeroSection" })]}
      />
    );
    expect(container.textContent).toContain("HeroSection");
  });

  it("shows source locations for selected elements", () => {
    const { container } = render(
      <SelectionPanel
        {...defaultProps}
        selectedElements={[mockPickedElement({ sourceLocation: "src/Hero.tsx:42" })]}
      />
    );
    expect(container.textContent).toContain("src/Hero.tsx:42");
  });

  it("calls onRemoveElement when remove button clicked", () => {
    const onRemoveElement = vi.fn();
    const { container } = render(
      <SelectionPanel
        {...defaultProps}
        selectedElements={[mockPickedElement(), mockPickedElement({ selector: "div.other" })]}
        onRemoveElement={onRemoveElement}
      />
    );
    // Find element remove buttons (×) — skip the first × which is the header close button
    const allButtons = container.querySelectorAll("button");
    const xButtons = Array.from(allButtons).filter((b) => b.textContent === "×");
    // xButtons[0] is the header close button, xButtons[1+] are element remove buttons
    expect(xButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(xButtons[1]!);
    expect(onRemoveElement).toHaveBeenCalled();
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

  it("submits annotation with comment", () => {
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
        expect(onAddToBatch).toHaveBeenCalledWith("Fix this layout", expect.any(String), expect.any(String));
      }
    }
  });

  it("shows element count", () => {
    const { container } = render(
      <SelectionPanel
        {...defaultProps}
        selectedElements={[mockPickedElement(), mockPickedElement({ selector: "div.other" })]}
      />
    );
    expect(container.textContent).toContain("2");
  });
});
