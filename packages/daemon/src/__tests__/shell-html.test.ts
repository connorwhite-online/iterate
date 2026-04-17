import { describe, it, expect } from "vitest";
import { getShellHTML } from "../index.js";

/**
 * Regression tests for the inline <script> in the daemon's control-shell HTML.
 *
 * The shell HTML is a template-literal string that includes a big inline
 * script. It's easy to accidentally break the emitted JS by writing escape
 * sequences that the TS template literal interprets (e.g. `\n` becomes a
 * real newline in the output, turning `'x'.join('\n')` into an unterminated
 * string in the served JS). These tests lock that down.
 */

function extractInlineScript(html: string): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("No inline <script> found in shell HTML");
  return match[1]!;
}

describe("getShellHTML — inline script", () => {
  it("parses as valid JavaScript", () => {
    const script = extractInlineScript(getShellHTML());
    // Function constructor throws SyntaxError for invalid JS. Using that
    // rather than eval so we don't execute the DOM-coupled code.
    expect(() => new Function(script)).not.toThrow();
  });

  it("contains the render and connect entry points", () => {
    const script = extractInlineScript(getShellHTML());
    expect(script).toMatch(/function renderTabs/);
    expect(script).toMatch(/function render\(/);
    expect(script).toMatch(/function connect\(/);
    expect(script).toMatch(/connect\(\)/);
  });

  it("references the core shell DOM ids", () => {
    const html = getShellHTML();
    expect(html).toMatch(/id="tab-bar"/);
    expect(html).toMatch(/id="command-input"/);
    expect(html).toMatch(/id="viewport"/);
    expect(html).toMatch(/id="status-text"/);
  });

  it("defines the tab-close UI element hooks", () => {
    const script = extractInlineScript(getShellHTML());
    // The close button calls DELETE /api/iterations/<name> — if this
    // regresses, the shell UI loses its remove-iteration affordance.
    expect(script).toMatch(/tab-close/);
    expect(script).toMatch(/DELETE/);
    expect(script).toMatch(/\/api\/iterations\//);
  });

  it("references the configured API endpoints used by the shell", () => {
    const script = extractInlineScript(getShellHTML());
    // Shell calls:
    //   POST /api/command  (new /iterate prompt)
    //   POST /api/iterations/pick  (Pick this iteration button)
    //   DELETE /api/iterations/<name>  (tab close button)
    expect(script).toMatch(/\/api\/command/);
    expect(script).toMatch(/\/api\/iterations\/pick/);
  });

  it("sets window.__iterate_shell__ for the overlay to hook into", () => {
    const script = extractInlineScript(getShellHTML());
    expect(script).toMatch(/window\.__iterate_shell__/);
  });
});
