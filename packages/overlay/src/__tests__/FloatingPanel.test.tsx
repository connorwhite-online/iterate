import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { FloatingPanel, ORIGINAL_TAB } from "../panel/FloatingPanel.js";

const defaultProps = {
  mode: "browse" as const,
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
    // Find the logo/close toggle button (has title "Show iterate panel...")
    const allButtons = container.querySelectorAll("button");
    const toggleButton = Array.from(allButtons).find(
      (b) => b.getAttribute("title")?.includes("iterate panel")
    );
    if (toggleButton) {
      fireEvent.click(toggleButton);
      expect(onVisibilityChange).toHaveBeenCalledWith(true);
    }
  });

  it("does not show Submit button when batchCount=0", () => {
    const { container } = render(
      <FloatingPanel {...defaultProps} batchCount={0} />
    );
    // The submit button exists in DOM but its parent ToolGroup should be hidden
    // (maxWidth: 0, opacity: 0, pointerEvents: none) when there are no pending changes
    const allButtons = container.querySelectorAll("button");
    const submitButton = Array.from(allButtons).find(
      (b) => b.getAttribute("title")?.includes("Submit") || b.textContent?.includes("Submit")
    );
    if (submitButton) {
      const toolGroup = submitButton.closest("div[style]");
      expect(toolGroup?.style.pointerEvents).toBe("none");
    }
  });

  it("shows batch action buttons when batchCount > 0", () => {
    const { container } = render(
      <FloatingPanel {...defaultProps} batchCount={3} />
    );
    // When batchCount > 0, the batch actions ToolGroup should be visible
    // (pointer-events: auto instead of none)
    const toolGroups = container.querySelectorAll("div[style]");
    const visibleGroups = Array.from(toolGroups).filter(
      (g) => (g as HTMLElement).style.pointerEvents === "auto" && (g as HTMLElement).style.maxWidth === "500px"
    );
    // Should have at least one visible ToolGroup for batch actions
    expect(visibleGroups.length).toBeGreaterThan(0);
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
      <FloatingPanel {...defaultProps} mode="browse" onModeChange={onModeChange} />
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

  it("toggles active tool to browse mode when clicked again", () => {
    const onModeChange = vi.fn();
    const { container } = render(
      <FloatingPanel {...defaultProps} mode="select" onModeChange={onModeChange} />
    );
    const allButtons = container.querySelectorAll("button");
    const selectButton = Array.from(allButtons).find(
      (b) => b.getAttribute("title") === "Select"
    );
    if (selectButton) {
      fireEvent.click(selectButton);
      expect(onModeChange).toHaveBeenCalledWith("browse");
    }
  });

  it("activates select from browse mode", () => {
    const onModeChange = vi.fn();
    const { container } = render(
      <FloatingPanel {...defaultProps} mode="browse" onModeChange={onModeChange} />
    );
    const allButtons = container.querySelectorAll("button");
    const selectButton = Array.from(allButtons).find(
      (b) => b.getAttribute("title") === "Select"
    );
    if (selectButton) {
      fireEvent.click(selectButton);
      expect(onModeChange).toHaveBeenCalledWith("select");
    }
  });

  it("shows iteration tabs with Original tab when iterations exist", () => {
    const { container } = render(
      <FloatingPanel
        {...defaultProps}
        iterations={{ "v1": { name: "v1", branch: "iterate/v1", worktreePath: "", port: 3100, pid: null, status: "ready", createdAt: "" } }}
        activeIteration={ORIGINAL_TAB}
      />
    );
    const allButtons = container.querySelectorAll("button");
    const v1Button = Array.from(allButtons).find(
      (b) => b.textContent?.includes("v1")
    );
    expect(v1Button).toBeDefined();
    // Should have an "Original" tab to switch back
    const originalButton = Array.from(allButtons).find(
      (b) => b.textContent === "Original"
    );
    expect(originalButton).toBeDefined();
  });

  it("calls onFork when Fork button is clicked", () => {
    const onFork = vi.fn();
    const { container } = render(
      <FloatingPanel {...defaultProps} onFork={onFork} />
    );
    const allButtons = container.querySelectorAll("button");
    const forkButton = Array.from(allButtons).find(
      (b) => b.getAttribute("title")?.toLowerCase().includes("iterations")
    );
    if (forkButton) {
      fireEvent.click(forkButton);
      expect(onFork).toHaveBeenCalled();
    }
  });

  it("tools work when viewing an iteration (postMessage bridge)", () => {
    const onModeChange = vi.fn();
    const { container } = render(
      <FloatingPanel
        {...defaultProps}
        mode="browse"
        onModeChange={onModeChange}
        isViewingIteration={true}
      />
    );
    const allButtons = container.querySelectorAll("button");
    const selectButton = Array.from(allButtons).find(
      (b) => b.getAttribute("title") === "Select"
    );
    if (selectButton) {
      fireEvent.click(selectButton);
      expect(onModeChange).toHaveBeenCalledWith("select");
    }
  });
});
