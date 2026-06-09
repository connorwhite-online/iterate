import type { PluginObj, types as t } from "@babel/core";

// HTML and SVG intrinsics that accept data-* attributes.
// Lowercase JSX names NOT in this set are treated as R3F/Three.js primitives
// and are skipped to prevent TypeError crashes when R3F forwards unknown props.
const HTML_TAGS = new Set([
  // HTML block/flow
  "address", "article", "aside", "blockquote", "caption", "col", "colgroup",
  "data", "dd", "details", "dialog", "div", "dl", "dt", "fieldset",
  "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5",
  "h6", "header", "hgroup", "hr", "li", "main", "nav", "ol", "p", "pre",
  "search", "section", "summary", "table", "tbody", "td", "tfoot", "th",
  "thead", "tr", "ul",
  // HTML inline/phrasing
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "del", "dfn", "em",
  "i", "ins", "kbd", "mark", "q", "rp", "rt", "ruby", "s", "samp", "small",
  "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
  // HTML embedded/media
  "area", "audio", "canvas", "embed", "iframe", "img", "map", "object",
  "picture", "source", "track", "video",
  // HTML form
  "button", "datalist", "input", "label", "legend", "meter", "optgroup",
  "option", "output", "progress", "select", "textarea",
  // HTML document/metadata
  "base", "body", "head", "html", "link", "meta", "noscript", "script",
  "slot", "style", "template", "title",
  // SVG
  "animate", "animateMotion", "animateTransform", "circle", "clipPath",
  "defs", "desc", "ellipse", "feBlend", "feColorMatrix", "feComponentTransfer",
  "feComposite", "feConvolveMatrix", "feDiffuseLighting", "feDisplacementMap",
  "feDropShadow", "feFlood", "feFuncA", "feFuncB", "feFuncG", "feFuncR",
  "feGaussianBlur", "feImage", "feMerge", "feMergeNode", "feMorphology",
  "feOffset", "fePointLight", "feSpecularLighting", "feSpotLight", "feTile",
  "feTurbulence", "filter", "foreignObject", "g", "image", "line",
  "linearGradient", "marker", "mask", "metadata", "mpath", "path", "pattern",
  "polygon", "polyline", "radialGradient", "rect", "set", "stop", "svg",
  "switch", "symbol", "text", "textPath", "tspan", "use", "view",
]);

interface PluginState {
  filename?: string;
  opts?: {
    /** Project root to compute relative paths from (defaults to cwd) */
    root?: string;
  };
}

/**
 * Babel plugin for iterate.
 *
 * Injects two data attributes onto the root JSX element returned by each
 * React component during development:
 *
 * - `data-iterate-component` — The component's display name (e.g. "HeroSection")
 * - `data-iterate-source` — Relative file path and line (e.g. "src/Hero.tsx:42")
 *
 * Only targets user-defined components (PascalCase function/class names).
 * Skips if the attributes are already present.
 * No-ops in production (NODE_ENV === "production").
 */
export default function iterateBabelPlugin(
  { types: t }: { types: typeof import("@babel/core").types }
): PluginObj<PluginState> {
  // Skip in production
  if (process.env.NODE_ENV === "production") {
    return { name: "iterate", visitor: {} };
  }

  return {
    name: "iterate",
    visitor: {
      /**
       * For each function declaration/expression/arrow that looks like a
       * React component (PascalCase name, returns JSX), inject attributes
       * onto the first JSX element in the return statement.
       */
      "FunctionDeclaration|FunctionExpression|ArrowFunctionExpression"(
        path,
        state
      ) {
        const componentName = getComponentName(path, t);
        if (!componentName) return;

        // Only target PascalCase names (user components, not hooks/utils)
        if (!/^[A-Z]/.test(componentName)) return;

        const sourceLocation = getSourceLocation(path, state);

        // Find all JSX return points and inject attributes
        const returnedJSX = findReturnedJSXElements(path, t);
        for (const jsxPath of returnedJSX) {
          injectAttributes(jsxPath, t, componentName, sourceLocation);
        }
      },
    },
  };
}

/**
 * Extract the component name from a function path.
 */
function getComponentName(
  path: any,
  t: typeof import("@babel/core").types
): string | null {
  // function HeroSection() {}
  if (t.isFunctionDeclaration(path.node) && path.node.id) {
    return path.node.id.name;
  }

  // const HeroSection = () => {} or const HeroSection = function() {}
  if (t.isVariableDeclarator(path.parent) && t.isIdentifier(path.parent.id)) {
    return path.parent.id.name;
  }

  // { HeroSection: () => {} } — named property in object
  if (t.isObjectProperty(path.parent) && t.isIdentifier(path.parent.key)) {
    return path.parent.key.name;
  }

  // export default function() {} — use filename as fallback
  if (t.isExportDefaultDeclaration(path.parent)) {
    return null; // We'll skip unnamed default exports
  }

  return null;
}

/**
 * Get relative file:line source location.
 */
function getSourceLocation(path: any, state: PluginState): string {
  const filename = state.filename ?? "unknown";
  const root = state.opts?.root ?? process.cwd();

  // Compute relative path
  let relative = filename;
  if (filename.startsWith(root)) {
    relative = filename.slice(root.length);
    if (relative.startsWith("/") || relative.startsWith("\\")) {
      relative = relative.slice(1);
    }
  }

  const line = path.node.loc?.start?.line ?? 0;
  return `${relative}:${line}`;
}

/**
 * Find all JSX elements that are returned from the function.
 * Handles: return <Foo/>, return (...<Foo/>...), ternaries, and
 * arrow functions with implicit JSX returns.
 */
function findReturnedJSXElements(
  fnPath: any,
  t: typeof import("@babel/core").types
): any[] {
  const jsxElements: any[] = [];

  // Arrow function with expression body: () => <div>...</div>
  if (t.isArrowFunctionExpression(fnPath.node) && !t.isBlockStatement(fnPath.node.body)) {
    const body = fnPath.get("body");
    // Only inject on single-root elements, not fragments.
    // A fragment has no single root element, so no child can
    // meaningfully be labeled as "the component root."
    if (t.isJSXElement(body.node)) {
      jsxElements.push(body);
    } else if (t.isConditionalExpression(body.node)) {
      const consequent = body.get("consequent");
      const alternate = body.get("alternate");
      if (t.isJSXElement(consequent.node)) jsxElements.push(consequent);
      if (t.isJSXElement(alternate.node)) jsxElements.push(alternate);
    }
    return jsxElements;
  }

  // Block body: find return statements
  fnPath.traverse({
    ReturnStatement(retPath: any) {
      // Don't descend into nested functions
      if (retPath.getFunctionParent() !== fnPath) return;

      const arg = retPath.get("argument");
      if (!arg.node) return;

      if (t.isJSXElement(arg.node)) {
        jsxElements.push(arg);
      } else if (t.isJSXFragment(arg.node)) {
        // Fragment — no single root element, skip injection.
      } else if (t.isConditionalExpression(arg.node)) {
        // Handle ternary: condition ? <A/> : <B/>
        const consequent = arg.get("consequent");
        const alternate = arg.get("alternate");
        if (t.isJSXElement(consequent.node)) jsxElements.push(consequent);
        if (t.isJSXElement(alternate.node)) jsxElements.push(alternate);
      }
    },
  });

  return jsxElements;
}

/**
 * Inject data-iterate-component and data-iterate-source attributes
 * onto a JSX element, if not already present.
 */
function injectAttributes(
  jsxPath: any,
  t: typeof import("@babel/core").types,
  componentName: string,
  sourceLocation: string
): void {
  const openingElement = jsxPath.node.openingElement;
  if (!openingElement) return;

  // Skip R3F/Three.js intrinsics (group, mesh, instancedMesh, etc.).
  // Only React components (PascalCase) and known HTML/SVG tags accept data-* props.
  if (t.isJSXIdentifier(openingElement.name)) {
    const name = openingElement.name.name;
    const isReactComponent = /^[A-Z]/.test(name);
    const isHtmlOrSvg = HTML_TAGS.has(name);
    if (!isReactComponent && !isHtmlOrSvg) return;
  }

  const existingAttrs: string[] = openingElement.attributes
    .filter((a: any) => t.isJSXAttribute(a))
    .map((a: any) => (t.isJSXIdentifier(a.name) ? a.name.name : ""));

  if (!existingAttrs.includes("data-iterate-component")) {
    openingElement.attributes.push(
      t.jsxAttribute(
        t.jsxIdentifier("data-iterate-component"),
        t.stringLiteral(componentName)
      )
    );
  }

  if (!existingAttrs.includes("data-iterate-source")) {
    openingElement.attributes.push(
      t.jsxAttribute(
        t.jsxIdentifier("data-iterate-source"),
        t.stringLiteral(sourceLocation)
      )
    );
  }
}
