import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONFIG,
  normalizeConfig,
  getApp,
  findApp,
  getDefaultApp,
  type IterateConfig,
} from "../types/config.js";

describe("normalizeConfig", () => {
  it("returns a config with an apps array when the raw config already has one", () => {
    const raw = {
      apps: [{ name: "web", devCommand: "next dev" }],
      packageManager: "pnpm" as const,
      basePort: 3100,
      daemonPort: 47100,
      maxIterations: 3,
      idleTimeout: 0,
    };
    const out = normalizeConfig(raw);
    expect(out.apps).toHaveLength(1);
    expect(out.apps[0].name).toBe("web");
    expect(out.packageManager).toBe("pnpm");
  });

  it("migrates a legacy flat config (devCommand at top level) into apps[]", () => {
    const raw = {
      devCommand: "pnpm run dev",
      appDir: "apps/web",
      packageManager: "pnpm" as const,
      basePort: 3100,
      daemonPort: 4000,
      maxIterations: 3,
      idleTimeout: 0,
    };
    const out = normalizeConfig(raw);
    expect(out.apps).toHaveLength(1);
    expect(out.apps[0]).toEqual({
      name: "app",
      devCommand: "pnpm run dev",
      appDir: "apps/web",
    });
  });

  it("preserves the original legacy fields so re-saving round-trips if needed", () => {
    const raw = { devCommand: "vite", packageManager: "npm" as const };
    const out = normalizeConfig(raw);
    expect(out.devCommand).toBe("vite");
    expect(out.apps[0].devCommand).toBe("vite");
  });

  it("fills in defaults when the raw config is empty", () => {
    const out = normalizeConfig({});
    expect(out.apps).toEqual([]);
    expect(out.basePort).toBe(DEFAULT_CONFIG.basePort);
    expect(out.daemonPort).toBe(DEFAULT_CONFIG.daemonPort);
    expect(out.maxIterations).toBe(DEFAULT_CONFIG.maxIterations);
  });

  it("prefers apps[] over legacy fields when both are present", () => {
    const raw = {
      devCommand: "LEGACY",
      apps: [{ name: "modern", devCommand: "next dev" }],
    };
    const out = normalizeConfig(raw);
    expect(out.apps).toHaveLength(1);
    expect(out.apps[0].name).toBe("modern");
  });

  it("does not mutate the input", () => {
    const raw = { devCommand: "next" };
    const snapshot = JSON.stringify(raw);
    normalizeConfig(raw);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });
});

describe("getApp / findApp / getDefaultApp", () => {
  const cfg: IterateConfig = {
    apps: [
      { name: "admin", devCommand: "next dev" },
      { name: "web", devCommand: "vite" },
    ],
    packageManager: "pnpm",
    basePort: 3100,
    daemonPort: 47100,
    maxIterations: 3,
    idleTimeout: 0,
  };

  it("getApp returns the matching entry", () => {
    expect(getApp(cfg, "admin").devCommand).toBe("next dev");
  });

  it("getApp throws for a missing app", () => {
    expect(() => getApp(cfg, "nope")).toThrow(/not found/);
  });

  it("findApp returns undefined instead of throwing", () => {
    expect(findApp(cfg, "nope")).toBeUndefined();
    expect(findApp(cfg, "web")?.name).toBe("web");
  });

  it("getDefaultApp returns the only app when there's exactly one", () => {
    const one: IterateConfig = { ...cfg, apps: [cfg.apps[0]] };
    expect(getDefaultApp(one)?.name).toBe("admin");
  });

  it("getDefaultApp returns undefined when there are multiple apps", () => {
    expect(getDefaultApp(cfg)).toBeUndefined();
  });

  it("getDefaultApp returns undefined when no apps are configured", () => {
    expect(getDefaultApp({ ...cfg, apps: [] })).toBeUndefined();
  });
});
