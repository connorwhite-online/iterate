import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { CursorIcon, MoveIcon, SendIcon, CloseIcon, LogoIcon, TrashIcon, CopyIcon } from "../panel/icons.js";

describe("icon components", () => {
  it("CursorIcon renders an SVG", () => {
    const { container } = render(<CursorIcon />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("MoveIcon renders an SVG", () => {
    const { container } = render(<MoveIcon />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("SendIcon renders an SVG", () => {
    const { container } = render(<SendIcon />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("CloseIcon renders an SVG", () => {
    const { container } = render(<CloseIcon />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("LogoIcon renders an SVG", () => {
    const { container } = render(<LogoIcon />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("TrashIcon renders an SVG", () => {
    const { container } = render(<TrashIcon />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("CopyIcon renders an SVG", () => {
    const { container } = render(<CopyIcon />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("accepts custom size prop", () => {
    const { container } = render(<CursorIcon size={24} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("24");
    expect(svg?.getAttribute("height")).toBe("24");
  });

  it("accepts custom color prop", () => {
    const { container } = render(<CursorIcon color="red" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });
});
