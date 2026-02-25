import type { PluginObj, types as t } from "@babel/core";

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
    if (t.isJSXElement(body.node) || t.isJSXFragment(body.node)) {
      if (t.isJSXElement(body.node)) {
        jsxElements.push(body);
      }
      // For fragments, find the first child JSX element
      if (t.isJSXFragment(body.node)) {
        body.traverse({
          JSXElement(innerPath: any) {
            jsxElements.push(innerPath);
            innerPath.stop();
          },
        });
      }
    }
    // Wrapped in parens — same node, babel strips parens
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
        // Find first child JSX element in fragment
        arg.traverse({
          JSXElement(innerPath: any) {
            jsxElements.push(innerPath);
            innerPath.stop();
          },
        });
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
