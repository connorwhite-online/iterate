import { describe, it, expect } from "vitest";
import type { IterationInfo } from "iterate-ui-core";
import { formatIterationList } from "../format.js";

function mock(overrides: Partial<IterationInfo>): IterationInfo {
  return {
    name: "v1",
    branch: "iterate/v1",
    worktreePath: "/tmp/v1",
    port: 3100,
    pid: null,
    status: "ready",
    createdAt: "2025-01-01",
    ...overrides,
  };
}

describe("formatIterationList", () => {
  it("returns a zero-state message when there are no iterations", () => {
    expect(formatIterationList([])).toBe("No active iterations.");
  });

  it("renders a single iteration without appName compactly (legacy / single-app)", () => {
    const out = formatIterationList([mock({ name: "v1", port: 3101 })]);
    expect(out).toContain("**v1**");
    expect(out).toContain("port: 3101");
    expect(out).not.toContain("app:");
  });

  it("includes appName when present (multi-app repo)", () => {
    const out = formatIterationList([mock({ name: "v1", appName: "brand-admin" })]);
    expect(out).toContain("app: brand-admin");
  });

  it("renders a list of multiple iterations with different apps", () => {
    const out = formatIterationList([
      mock({ name: "a", appName: "web", port: 3101 }),
      mock({ name: "b", appName: "admin", port: 3102 }),
    ]);
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("app: web");
    expect(lines[0]).toContain("port: 3101");
    expect(lines[1]).toContain("app: admin");
    expect(lines[1]).toContain("port: 3102");
  });

  it("includes commandPrompt on its own line when set", () => {
    const out = formatIterationList([
      mock({ name: "v1", commandPrompt: "make header pop" }),
    ]);
    expect(out).toContain(`\n  Command: "make header pop"`);
  });

  it("includes commandId inline when set", () => {
    const out = formatIterationList([mock({ name: "v1", commandId: "cmd-123" })]);
    expect(out).toContain("[command: cmd-123]");
  });

  it("status is always rendered", () => {
    const iterations = ["ready", "creating", "error"].map(
      (s, i) => mock({ name: `v${i}`, status: s as IterationInfo["status"] })
    );
    const out = formatIterationList(iterations);
    expect(out).toContain("status: ready");
    expect(out).toContain("status: creating");
    expect(out).toContain("status: error");
  });
});
