import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { transformSync } from "@babel/core";
import iterateBabelPlugin from "../index.js";

function transform(code: string, opts?: { filename?: string; root?: string }) {
  const result = transformSync(code, {
    plugins: [[iterateBabelPlugin, { root: opts?.root ?? "/project" }]],
    presets: [["@babel/preset-react", { runtime: "automatic" }]],
    filename: opts?.filename ?? "/project/src/App.tsx",
    configFile: false,
    babelrc: false,
  });
  return result?.code ?? "";
}

describe("iterate babel plugin", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe("component detection", () => {
    it("injects data-iterate-component on a function declaration", () => {
      const code = `function HeroSection() { return <div>Hello</div> }`;
      const output = transform(code);
      expect(output).toContain('"data-iterate-component": "HeroSection"');
    });

    it("injects on arrow function assigned to const", () => {
      const code = `const Card = () => <div>Card</div>;`;
      const output = transform(code);
      expect(output).toContain('"data-iterate-component": "Card"');
    });

    it("injects on named function expression assigned to const", () => {
      const code = `const Card = function Card() { return <div>Card</div> };`;
      const output = transform(code);
      expect(output).toContain('"data-iterate-component": "Card"');
    });

    it("skips non-PascalCase functions", () => {
      const code = `function helper() { return <div /> }`;
      const output = transform(code);
      expect(output).not.toContain("data-iterate-component");
    });

    it("skips anonymous default exports", () => {
      const code = `export default function() { return <div /> }`;
      const output = transform(code);
      expect(output).not.toContain("data-iterate-component");
    });

    it("handles named export function", () => {
      const code = `export function Hero() { return <div /> }`;
      const output = transform(code);
      expect(output).toContain('"data-iterate-component": "Hero"');
    });
  });

  describe("source location", () => {
    it("injects data-iterate-source with relative path", () => {
      const code = `function Hero() { return <div /> }`;
      const output = transform(code, {
        filename: "/project/src/components/Hero.tsx",
        root: "/project",
      });
      expect(output).toContain("data-iterate-source");
      expect(output).toContain("src/components/Hero.tsx:");
    });

    it("respects root option for relative path", () => {
      const code = `function Hero() { return <div /> }`;
      const output = transform(code, {
        filename: "/workspace/app/src/Hero.tsx",
        root: "/workspace/app",
      });
      expect(output).toContain("src/Hero.tsx:");
    });
  });

  describe("JSX handling", () => {
    it("handles arrow function with expression body", () => {
      const code = `const Banner = () => <section>Hi</section>;`;
      const output = transform(code);
      expect(output).toContain('"data-iterate-component": "Banner"');
    });

    it("handles block body with explicit return", () => {
      const code = `function Page() { const x = 1; return <main>Content</main>; }`;
      const output = transform(code);
      expect(output).toContain('"data-iterate-component": "Page"');
    });

    it("handles fragment return — injects on first child element", () => {
      const code = `function List() { return <><div>A</div><div>B</div></>; }`;
      const output = transform(code);
      expect(output).toContain('"data-iterate-component": "List"');
    });

    it("handles ternary — injects on both branches", () => {
      const code = `function Toggle({ on }) { return on ? <div>On</div> : <span>Off</span>; }`;
      const output = transform(code);
      // Both branches should get the component attribute
      const matches = output.match(/data-iterate-component/g);
      expect(matches?.length).toBeGreaterThanOrEqual(2);
    });

    it("does not inject on nested child elements", () => {
      const code = `function Card() { return <div><span>text</span></div>; }`;
      const output = transform(code);
      // Only the root div gets the attribute, not the inner span
      const matches = output.match(/data-iterate-component/g);
      expect(matches?.length).toBe(1);
    });

    it("handles component returning null gracefully", () => {
      const code = `function Empty() { return null; }`;
      const output = transform(code);
      expect(output).not.toContain("data-iterate-component");
    });
  });

  describe("idempotency", () => {
    it("skips if data-iterate-component already present", () => {
      const code = `function Card() { return <div data-iterate-component="Card">Hi</div>; }`;
      const output = transform(code);
      const matches = output.match(/data-iterate-component/g);
      expect(matches?.length).toBe(1);
    });

    it("skips if data-iterate-source already present", () => {
      const code = `function Card() { return <div data-iterate-source="x.tsx:1">Hi</div>; }`;
      const output = transform(code);
      const sourceMatches = output.match(/data-iterate-source/g);
      expect(sourceMatches?.length).toBe(1);
    });
  });

  describe("production mode", () => {
    it("no-ops when NODE_ENV=production", () => {
      process.env.NODE_ENV = "production";
      // Need to re-import/re-call the plugin factory since it checks at call time
      const result = transformSync(
        `function Hero() { return <div>Hello</div> }`,
        {
          plugins: [[iterateBabelPlugin, { root: "/project" }]],
          presets: [["@babel/preset-react", { runtime: "automatic" }]],
          filename: "/project/src/App.tsx",
          configFile: false,
          babelrc: false,
        }
      );
      expect(result?.code).not.toContain("data-iterate-component");
    });
  });

  describe("nested functions", () => {
    it("does not cross into nested function returns", () => {
      const code = `
        function Outer() {
          function Inner() { return <span>inner</span>; }
          return <div>outer</div>;
        }
      `;
      const output = transform(code);
      // Should inject "Outer" on the div and "Inner" on the span — 2 separate injections
      expect(output).toContain('"data-iterate-component": "Outer"');
      expect(output).toContain('"data-iterate-component": "Inner"');
    });
  });
});
