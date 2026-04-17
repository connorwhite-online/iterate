import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { saveConfig, writeLockfile } from "iterate-ui-core/node";
import type { IterateConfig } from "iterate-ui-core";
import { runDoctor, checkApp, formatResults, type DoctorCheck, type DoctorStatus } from "../commands/doctor.js";

function makeGitRepo(): string {
  const tmp = mkdtempSync(join(tmpdir(), "iterate-doctor-"));
  execSync("git init -q", { cwd: tmp });
  return tmp;
}

const baseConfig: IterateConfig = {
  apps: [{ name: "web", devCommand: "next dev" }],
  packageManager: "pnpm",
  basePort: 3100,
  daemonPort: 47100,
  maxIterations: 3,
  idleTimeout: 0,
};

let tmp: string;
beforeEach(() => {
  tmp = makeGitRepo();
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("runDoctor — top-level flow", () => {
  it("fails when there is no config", async () => {
    const results = await runDoctor({ cwd: tmp, isPackageManagerInstalled: () => true });
    expectLabel(results, /Loaded \.iterate\/config\.json/, false);
    expectLabel(results, /\.iterate\/config\.json not found/, true, "fail");
  });

  it("fails when config has zero apps registered", async () => {
    saveConfig(tmp, { ...baseConfig, apps: [] });
    const results = await runDoctor({ cwd: tmp, isPackageManagerInstalled: () => true });
    expectLabel(results, /No apps registered/, true, "fail");
  });

  it("passes for a minimal single-app config", async () => {
    // Minimal config: app has no appDir, so checkApp looks for a package.json at repo root.
    writeFileSync(join(tmp, "package.json"), "{}");
    saveConfig(tmp, baseConfig);
    const results = await runDoctor({ cwd: tmp, isPackageManagerInstalled: () => true });
    const failCount = results.filter((r) => r.status === "fail").length;
    expect(failCount).toBe(0);
    expectLabel(results, /Registered apps \(1\): web/, true, "ok");
    expectLabel(results, /appDir resolves/, true, "ok");
    expectLabel(results, /devCommand: next dev/, true, "ok");
    expectLabel(results, /package manager "pnpm" is installed/, true, "ok");
  });

  it("flags a stale lockfile as warn", async () => {
    saveConfig(tmp, baseConfig);
    writeLockfile(tmp, {
      pid: 2147483647, // effectively never-alive PID
      port: 47100,
      cwd: tmp,
      startedAt: "2020-01-01T00:00:00Z",
    });
    const results = await runDoctor({ cwd: tmp, isPackageManagerInstalled: () => true });
    expectLabel(results, /Stale daemon lockfile/, true, "warn");
  });

  it("reports a live daemon lockfile as OK", async () => {
    saveConfig(tmp, baseConfig);
    writeLockfile(tmp, {
      pid: process.pid, // this test process is alive
      port: 47100,
      cwd: tmp,
      startedAt: new Date().toISOString(),
    });
    const results = await runDoctor({ cwd: tmp, isPackageManagerInstalled: () => true });
    expectLabel(
      results,
      new RegExp(`Daemon running on port 47100 \\(pid ${process.pid}\\)`),
      true,
      "ok"
    );
  });

  it("warns when docker-compose.yaml is present at repo root", async () => {
    saveConfig(tmp, baseConfig);
    writeFileSync(join(tmp, "docker-compose.yaml"), "services: {}\n");
    const results = await runDoctor({ cwd: tmp, isPackageManagerInstalled: () => true });
    expectLabel(results, /docker-compose detected/, true, "warn");
  });

  it("warns when docker-compose.yml (yml extension) is present", async () => {
    saveConfig(tmp, baseConfig);
    writeFileSync(join(tmp, "docker-compose.yml"), "services: {}\n");
    const results = await runDoctor({ cwd: tmp, isPackageManagerInstalled: () => true });
    expectLabel(results, /docker-compose detected/, true, "warn");
  });

  it("fails when apps[] contains duplicate names", async () => {
    saveConfig(tmp, {
      ...baseConfig,
      apps: [
        { name: "web", devCommand: "next dev" },
        { name: "web", devCommand: "next dev --turbo" },
      ],
    });
    const results = await runDoctor({ cwd: tmp, isPackageManagerInstalled: () => true });
    expect(
      results.some(
        (r) => r.status === "fail" && r.label.includes('Duplicate app name "web"')
      )
    ).toBe(true);
  });

  it("--app filter narrows to one app and fails if the name is unknown", async () => {
    saveConfig(tmp, {
      ...baseConfig,
      apps: [
        { name: "web", devCommand: "next dev" },
        { name: "admin", devCommand: "vite" },
      ],
    });
    const good = await runDoctor({ cwd: tmp, app: "admin", isPackageManagerInstalled: () => true });
    const appSections = good.filter((r) => r.label.startsWith("— App:"));
    expect(appSections).toHaveLength(1);
    expect(appSections[0].label).toContain("admin");

    const bad = await runDoctor({ cwd: tmp, app: "nope", isPackageManagerInstalled: () => true });
    expectLabel(bad, /No app named "nope" in config/, true, "fail");
  });
});

describe("checkApp — per-app checks", () => {
  it("warns when appDir is an absolute path (breaks worktree isolation)", () => {
    const results: DoctorCheck[] = [];
    checkApp(
      tmp,
      baseConfig,
      { name: "abs", devCommand: "next dev", appDir: "/etc" },
      results,
      () => true
    );
    expect(
      results.some((r) => r.status === "warn" && r.label.includes("is absolute"))
    ).toBe(true);
  });

  it("fails when appDir escapes the repo via ..", () => {
    const results: DoctorCheck[] = [];
    checkApp(
      tmp,
      baseConfig,
      { name: "escape", devCommand: "next dev", appDir: "../../etc" },
      results,
      () => true
    );
    expect(
      results.some((r) => r.status === "fail" && r.label.includes("outside the repo"))
    ).toBe(true);
  });

  it("fails when appDir does not exist", () => {
    saveConfig(tmp, baseConfig);
    const results: DoctorCheck[] = [];
    checkApp(
      tmp,
      baseConfig,
      { name: "web", devCommand: "next dev", appDir: "apps/doesnt-exist" },
      results,
      () => true
    );
    expect(results.some((r) => r.status === "fail" && r.label.includes("does not exist"))).toBe(true);
  });

  it("fails when there is no package.json in the app dir", () => {
    const appDir = join(tmp, "apps", "empty");
    mkdirSync(appDir, { recursive: true });
    saveConfig(tmp, baseConfig);
    const results: DoctorCheck[] = [];
    checkApp(
      tmp,
      baseConfig,
      { name: "empty", devCommand: "next dev", appDir: "apps/empty" },
      results,
      () => true
    );
    expect(
      results.some((r) => r.status === "fail" && r.label.includes("No package.json"))
    ).toBe(true);
  });

  it("does not warn when portEnvVar is not inline but the command uses a known env-loader wrapper", () => {
    // env-cmd, dotenv-cli, doppler run, op run, direnv all pick up vars
    // from process.env without inline references. Warning here would be
    // noise (we'd be asking the user to break their wrapper).
    const results: DoctorCheck[] = [];
    writeFileSync(join(tmp, "package.json"), "{}");
    checkApp(
      tmp,
      baseConfig,
      {
        name: "x",
        devCommand: "env-cmd --dev -- pnpm next dev",
        portEnvVar: "CUSTOM_PORT",
      },
      results,
      () => true
    );
    // "not referenced" warn is suppressed; an "OK (wrapper picks it up)" row appears
    const portRow = results.find((r) => r.label.includes("CUSTOM_PORT"));
    expect(portRow?.status).toBe("ok");
    expect(portRow?.label).toMatch(/wrapper/i);
  });

  it("warns when portEnvVar is not inline and the command has no known wrapper", () => {
    const results: DoctorCheck[] = [];
    writeFileSync(join(tmp, "package.json"), "{}");
    checkApp(
      tmp,
      baseConfig,
      {
        name: "x",
        devCommand: "custom-script.sh dev", // unknown wrapper
        portEnvVar: "CUSTOM_PORT",
      },
      results,
      () => true
    );
    expect(
      results.some(
        (r) => r.status === "warn" && r.label.includes("CUSTOM_PORT") && r.label.includes("not referenced")
      )
    ).toBe(true);
  });

  it("recognizes doppler run as a known wrapper", () => {
    const results: DoctorCheck[] = [];
    writeFileSync(join(tmp, "package.json"), "{}");
    checkApp(
      tmp,
      baseConfig,
      {
        name: "x",
        devCommand: "doppler run -- next dev",
        portEnvVar: "MY_PORT",
      },
      results,
      () => true
    );
    const portRow = results.find((r) => r.label.includes("MY_PORT"));
    expect(portRow?.status).toBe("ok");
  });

  it("warns when devCommand hardcodes a numeric -p port and portEnvVar isn't set", () => {
    const results: DoctorCheck[] = [];
    writeFileSync(join(tmp, "package.json"), "{}");
    checkApp(
      tmp,
      baseConfig,
      { name: "x", devCommand: "next dev -p 3000" },
      results,
      () => true
    );
    expect(
      results.some((r) => r.status === "warn" && r.label.includes("hardcodes a numeric port"))
    ).toBe(true);
  });

  it("warns when devCommand hardcodes a --port=N port", () => {
    const results: DoctorCheck[] = [];
    writeFileSync(join(tmp, "package.json"), "{}");
    checkApp(
      tmp,
      baseConfig,
      { name: "x", devCommand: "vite --port=5000" },
      results,
      () => true
    );
    expect(
      results.some((r) => r.status === "warn" && r.label.includes("hardcodes a numeric port"))
    ).toBe(true);
  });

  it("does NOT warn when portEnvVar is set (wrapper script handles it)", () => {
    const results: DoctorCheck[] = [];
    writeFileSync(join(tmp, "package.json"), "{}");
    checkApp(
      tmp,
      baseConfig,
      {
        name: "x",
        devCommand: "PORT=4000 env-cmd -- next dev",
        portEnvVar: "PORT",
      },
      results,
      () => true
    );
    expect(
      results.some((r) => r.status === "warn" && r.label.includes("hardcodes a numeric port"))
    ).toBe(false);
  });

  it("OKs portEnvVar when referenced as $FOO", () => {
    const results: DoctorCheck[] = [];
    writeFileSync(join(tmp, "package.json"), "{}");
    checkApp(
      tmp,
      baseConfig,
      { name: "x", devCommand: "next dev -p $BRAND_ADMIN_PORT", portEnvVar: "BRAND_ADMIN_PORT" },
      results,
      () => true
    );
    expect(
      results.some(
        (r) => r.status === "ok" && r.label.includes("BRAND_ADMIN_PORT") && r.label.includes("referenced")
      )
    ).toBe(true);
  });

  it("OKs portEnvVar when referenced as ${FOO}", () => {
    const results: DoctorCheck[] = [];
    writeFileSync(join(tmp, "package.json"), "{}");
    checkApp(
      tmp,
      baseConfig,
      { name: "x", devCommand: "next dev -p ${ADMIN_PORT}", portEnvVar: "ADMIN_PORT" },
      results,
      () => true
    );
    expect(
      results.some((r) => r.status === "ok" && r.label.includes("referenced in devCommand"))
    ).toBe(true);
  });

  it("OKs portEnvVar when referenced as %FOO% (Windows style)", () => {
    const results: DoctorCheck[] = [];
    writeFileSync(join(tmp, "package.json"), "{}");
    checkApp(
      tmp,
      baseConfig,
      { name: "x", devCommand: "next dev -p %ADMIN_PORT%", portEnvVar: "ADMIN_PORT" },
      results,
      () => true
    );
    expect(
      results.some((r) => r.status === "ok" && r.label.includes("referenced in devCommand"))
    ).toBe(true);
  });

  it("warns when envFile is missing", () => {
    const results: DoctorCheck[] = [];
    writeFileSync(join(tmp, "package.json"), "{}");
    checkApp(
      tmp,
      baseConfig,
      { name: "x", devCommand: "next dev", envFiles: [".env.development.pre"] },
      results,
      () => true
    );
    expect(
      results.some(
        (r) => r.status === "warn" && r.label.includes("envFile missing: .env.development.pre")
      )
    ).toBe(true);
  });

  it("warns when envFile is present but empty", () => {
    const results: DoctorCheck[] = [];
    writeFileSync(join(tmp, "package.json"), "{}");
    writeFileSync(join(tmp, ".env.dev"), "# just a comment\n\n");
    checkApp(
      tmp,
      baseConfig,
      { name: "x", devCommand: "next dev", envFiles: [".env.dev"] },
      results,
      () => true
    );
    expect(
      results.some((r) => r.status === "warn" && r.label.includes("no keys"))
    ).toBe(true);
  });

  it("reports the key count of parsed envFiles and flags when portEnvVar is present", () => {
    const results: DoctorCheck[] = [];
    writeFileSync(join(tmp, "package.json"), "{}");
    writeFileSync(join(tmp, ".env.dev"), "A=1\nB=2\nMY_PORT=4000\n");
    checkApp(
      tmp,
      baseConfig,
      {
        name: "x",
        devCommand: "next dev -p $MY_PORT",
        portEnvVar: "MY_PORT",
        envFiles: [".env.dev"],
      },
      results,
      () => true
    );
    const envFileRow = results.find((r) => r.label.includes(".env.dev"));
    expect(envFileRow?.status).toBe("ok");
    expect(envFileRow?.label).toMatch(/3 keys/);
    expect(envFileRow?.label).toMatch(/incl\. MY_PORT/);
  });

  it("does NOT warn about missing portEnvVar when it IS present in an envFile", () => {
    const results: DoctorCheck[] = [];
    writeFileSync(join(tmp, "package.json"), "{}");
    writeFileSync(join(tmp, ".env.dev"), "MY_PORT=4000\n");
    delete process.env.MY_PORT;
    checkApp(
      tmp,
      baseConfig,
      {
        name: "x",
        devCommand: "next dev -p $MY_PORT",
        portEnvVar: "MY_PORT",
        envFiles: [".env.dev"],
      },
      results,
      () => true
    );
    expect(
      results.some((r) => r.status === "warn" && r.label.includes("not found in any envFile"))
    ).toBe(false);
  });

  it("warns when portEnvVar isn't in any envFile and not in process.env", () => {
    const results: DoctorCheck[] = [];
    writeFileSync(join(tmp, "package.json"), "{}");
    writeFileSync(join(tmp, ".env.dev"), "OTHER=1\n");
    delete process.env.MY_ELUSIVE_PORT;
    checkApp(
      tmp,
      baseConfig,
      {
        name: "x",
        devCommand: "next dev -p $MY_ELUSIVE_PORT",
        portEnvVar: "MY_ELUSIVE_PORT",
        envFiles: [".env.dev"],
      },
      results,
      () => true
    );
    expect(
      results.some(
        (r) => r.status === "warn" && r.label.includes("MY_ELUSIVE_PORT") && r.label.includes("not found")
      )
    ).toBe(true);
  });

  it("warns when basePath doesn't start with /", () => {
    const results: DoctorCheck[] = [];
    writeFileSync(join(tmp, "package.json"), "{}");
    checkApp(
      tmp,
      baseConfig,
      { name: "x", devCommand: "next dev", basePath: "admin" },
      results,
      () => true
    );
    expect(
      results.some((r) => r.status === "warn" && r.label.includes('basePath "admin"'))
    ).toBe(true);
  });

  it("fails when package manager isn't installed", () => {
    const results: DoctorCheck[] = [];
    writeFileSync(join(tmp, "package.json"), "{}");
    checkApp(
      tmp,
      baseConfig,
      { name: "x", devCommand: "next dev" },
      results,
      () => false // nothing installed
    );
    expect(
      results.some((r) => r.status === "fail" && r.label.includes("not found in PATH"))
    ).toBe(true);
  });

  it("fails with an invalid envFile contents (unreadable)", () => {
    const results: DoctorCheck[] = [];
    writeFileSync(join(tmp, "package.json"), "{}");
    // Create a directory where a file is expected — readFileSync will throw EISDIR.
    mkdirSync(join(tmp, ".env.as-dir"));
    checkApp(
      tmp,
      baseConfig,
      { name: "x", devCommand: "next dev", envFiles: [".env.as-dir"] },
      results,
      () => true
    );
    expect(
      results.some((r) => r.status === "fail" && r.label.includes(".env.as-dir"))
    ).toBe(true);
  });

  it("uses per-app packageManager override instead of the config default", () => {
    const results: DoctorCheck[] = [];
    writeFileSync(join(tmp, "package.json"), "{}");
    const seen: string[] = [];
    checkApp(
      tmp,
      baseConfig,
      { name: "x", devCommand: "next dev", packageManager: "bun" },
      results,
      (pm) => {
        seen.push(pm);
        return true;
      }
    );
    expect(seen).toEqual(["bun"]);
  });

  it("absolute envFile paths are supported", () => {
    const results: DoctorCheck[] = [];
    writeFileSync(join(tmp, "package.json"), "{}");
    const abs = resolve(tmp, "abs.env");
    writeFileSync(abs, "FOO=1\n");
    checkApp(
      tmp,
      baseConfig,
      { name: "x", devCommand: "next dev", envFiles: [abs] },
      results,
      () => true
    );
    const match = results.find((r) => r.label.includes(abs));
    expect(match?.status).toBe("ok");
  });
});

describe("formatResults", () => {
  it("renders an OK state when there are no warns or fails", () => {
    const { output, hasFail, warnCount } = formatResults([
      { status: "ok", label: "A" },
      { status: "ok", label: "B" },
    ]);
    expect(hasFail).toBe(false);
    expect(warnCount).toBe(0);
    expect(output).toContain("All checks passed");
  });

  it("reports warning count when there are only warnings", () => {
    const { output, hasFail, warnCount } = formatResults([
      { status: "ok", label: "A" },
      { status: "warn", label: "W1" },
      { status: "warn", label: "W2" },
    ]);
    expect(hasFail).toBe(false);
    expect(warnCount).toBe(2);
    expect(output).toContain("OK with 2 warning(s)");
  });

  it("reports Failed when any fail is present, regardless of warnings", () => {
    const { output, hasFail } = formatResults([
      { status: "ok", label: "A" },
      { status: "warn", label: "W" },
      { status: "fail", label: "X" },
    ]);
    expect(hasFail).toBe(true);
    expect(output).toContain("Failed");
  });

  it("includes detail lines under their status line", () => {
    const { output } = formatResults([
      { status: "fail", label: "broke", detail: "explain here" },
    ]);
    expect(output).toMatch(/broke[\s\S]*explain here/);
  });
});

function expectLabel(
  results: DoctorCheck[],
  matcher: RegExp,
  shouldExist: boolean,
  status?: DoctorStatus
): void {
  const found = results.find((r) => matcher.test(r.label));
  if (shouldExist) {
    expect(found, `expected a result matching ${matcher}`).toBeDefined();
    if (status) expect(found!.status).toBe(status);
  } else {
    expect(found, `expected no result matching ${matcher}`).toBeUndefined();
  }
}

// Avoid unused-import lints in minimal envs.
void readFileSync;
