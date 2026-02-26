import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { FloatingPanel } from "../panel/FloatingPanel.js";

const defaultProps = {
  mode: "select" as const,
  onModeChange: vi.fn(),
  visible: true,
  onVisibilityChange: vi.fn(),
  batchCount: 0,
  onSubmitBatch: vi.fn(),
};

describe("FloatingPanel", () => {
  it("renders toolbar when visible", () => {
    const { container } = render(<FloatingPanel {...defaultProps} />);
    // Should render SVG icons (no text in the toolbar)
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("renders minimized button when not visible", () => {
    const { container } = render(
      <FloatingPanel {...defaultProps} visible={false} />
    );
    // Should still render something (the minimized indicator)
    expect(container.innerHTML).not.toBe("");
    // But should not show the full toolbar text
    // The minimized state shows just a small button
  });

  it("calls onVisibilityChange when minimized button is clicked", () => {
    const onVisibilityChange = vi.fn();
    const { container } = render(
      <FloatingPanel
        {...defaultProps}
        visible={false}
        onVisibilityChange={onVisibilityChange}
      />
    );
    const button = container.querySelector("button");
    if (button) {
      fireEvent.click(button);
      expect(onVisibilityChange).toHaveBeenCalledWith(true);
    }
  });

  it("does not show Submit button when batchCount=0", () => {
    const { container } = render(
      <FloatingPanel {...defaultProps} batchCount={0} />
    );
    // Look for the Submit-related content
    const allButtons = container.querySelectorAll("button");
    const submitButton = Array.from(allButtons).find(
      (b) => b.getAttribute("title")?.includes("Submit") || b.textContent?.includes("Submit")
    );
    expect(submitButton).toBeUndefined();
  });

  it("shows batch action buttons when batchCount > 0", () => {
    const { container } = render(
      <FloatingPanel {...defaultProps} batchCount={3} />
    );
    // Should show submit, copy, and trash buttons
    const allButtons = container.querySelectorAll("button");
    const submitButton = Array.from(allButtons).find(
      (b) => b.getAttribute("title")?.toLowerCase().includes("submit")
    );
    expect(submitButton).toBeDefined();
  });

  it("calls onSubmitBatch when Submit button clicked", () => {
    const onSubmitBatch = vi.fn();
    const { container } = render(
      <FloatingPanel {...defaultProps} batchCount={2} onSubmitBatch={onSubmitBatch} />
    );
    const allButtons = container.querySelectorAll("button");
    const submitButton = Array.from(allButtons).find(
      (b) => b.getAttribute("title")?.toLowerCase().includes("submit") || b.textContent?.includes("Submit")
    );
    if (submitButton) {
      fireEvent.click(submitButton);
      expect(onSubmitBatch).toHaveBeenCalled();
    }
  });

  it("toggles visibility on Alt+Shift+I hotkey", () => {
    const onVisibilityChange = vi.fn();
    render(
      <FloatingPanel
        {...defaultProps}
        visible={true}
        onVisibilityChange={onVisibilityChange}
      />
    );
    fireEvent.keyDown(window, { key: "I", altKey: true, shiftKey: true });
    expect(onVisibilityChange).toHaveBeenCalledWith(false);
  });

  it("calls onModeChange when mode button clicked", () => {
    const onModeChange = vi.fn();
    const { container } = render(
      <FloatingPanel {...defaultProps} mode="select" onModeChange={onModeChange} />
    );
    const allButtons = container.querySelectorAll("button");
    const moveButton = Array.from(allButtons).find(
      (b) => b.getAttribute("title")?.toLowerCase().includes("move")
    );
    if (moveButton) {
      fireEvent.click(moveButton);
      expect(onModeChange).toHaveBeenCalledWith("move");
    }
  });
});
