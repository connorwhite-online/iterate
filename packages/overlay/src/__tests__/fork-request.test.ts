import { describe, it, expect } from "vitest";
import { buildForkRequest } from "../fork-request.js";

describe("buildForkRequest", () => {
  it("forwards appName from the shell when present", () => {
    const body = buildForkRequest({ appName: "next-16-example" });
    expect(body).toEqual({ command: "iterate", count: 3, appName: "next-16-example" });
  });

  it("omits appName when the shell has none (single-app repo)", () => {
    const body = buildForkRequest({});
    expect(body).toEqual({ command: "iterate", count: 3 });
    expect("appName" in body).toBe(false);
  });

  it("handles null shell (overlay loaded before plugin stamp ran)", () => {
    const body = buildForkRequest(null);
    expect(body).toEqual({ command: "iterate", count: 3 });
    expect("appName" in body).toBe(false);
  });

  it("handles undefined shell", () => {
    const body = buildForkRequest(undefined);
    expect(body).toEqual({ command: "iterate", count: 3 });
  });

  it("honors a custom count", () => {
    const body = buildForkRequest({ appName: "docs" }, 5);
    expect(body).toEqual({ command: "iterate", count: 5, appName: "docs" });
  });

  it("treats empty-string appName as no appName", () => {
    const body = buildForkRequest({ appName: "" });
    // Empty string is falsy; we don't forward it to the daemon.
    expect("appName" in body).toBe(false);
  });
});
