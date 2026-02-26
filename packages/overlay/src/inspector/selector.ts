/**
 * Generate a unique CSS selector for a DOM element.
 * Produces a human-readable path like: article > section.hero > h1
 */
export function generateSelector(element: Element): string {
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();

    // Filter class names: skip CSS module hashes, framework internals
    const classes = Array.from(current.classList)
      .filter((c) =>
        !c.startsWith("__") &&
        !c.includes("svelte-") &&
        !/^[a-z]{1,2}$/.test(c) &&
        !/[_][a-zA-Z0-9]{5,}/.test(c)
      )
      .slice(0, 2);

    if (classes.length > 0) {
      selector += classes.map((c) => `.${CSS.escape(c)}`).join("");
    }

    if (current.parentElement) {
      const siblings = current.parentElement.querySelectorAll(
        `:scope > ${selector}`
      );
      if (siblings.length > 1) {
        const index =
          Array.from(current.parentElement.children).indexOf(current) + 1;
        selector += `:nth-child(${index})`;
      }
    }

    parts.unshift(selector);

    if (document.querySelectorAll(parts.join(" > ")).length === 1) {
      break;
    }

    current = current.parentElement;
  }

  return parts.join(" > ");
}

/**
 * Generate a human-readable element path (up to maxDepth ancestors).
 * Example: "main > section > div.card"
 */
export function getElementPath(element: Element, maxDepth = 4): string {
  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;

  while (current && current !== document.documentElement && depth < maxDepth) {
    const tag = current.tagName.toLowerCase();
    const classes = Array.from(current.classList)
      .filter((c) => !/[_][a-zA-Z0-9]{5,}/.test(c))
      .slice(0, 1);

    parts.unshift(classes.length > 0 ? `${tag}.${classes[0]}` : tag);
    current = current.parentElement;
    depth++;
  }

  return parts.join(" > ");
}

/**
 * Generate a human-readable name for an element.
 * Inspired by agentation's element identification.
 */
export function identifyElement(element: Element): string {
  const tag = element.tagName.toLowerCase();

  // data-element attribute (user-provided label)
  const dataElement = element.getAttribute("data-element");
  if (dataElement) return dataElement;

  // Buttons: use text content or aria-label
  if (tag === "button" || element.getAttribute("role") === "button") {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return `button [${ariaLabel}]`;
    const text = element.textContent?.trim().slice(0, 30);
    if (text) return `button "${text}"`;
    return "button";
  }

  // Links
  if (tag === "a") {
    const text = element.textContent?.trim().slice(0, 30);
    if (text) return `link "${text}"`;
    return "link";
  }

  // Inputs
  if (tag === "input") {
    const type = (element as HTMLInputElement).type || "text";
    const name = (element as HTMLInputElement).name;
    const placeholder = (element as HTMLInputElement).placeholder;
    if (name) return `input[${type}] "${name}"`;
    if (placeholder) return `input[${type}] "${placeholder}"`;
    return `input[${type}]`;
  }

  // Images
  if (tag === "img") {
    const alt = (element as HTMLImageElement).alt;
    if (alt) return `image "${alt.slice(0, 30)}"`;
    return "image";
  }

  // Headings
  if (/^h[1-6]$/.test(tag)) {
    const text = element.textContent?.trim().slice(0, 30);
    if (text) return `${tag} "${text}"`;
    return tag;
  }

  // ID
  if (element.id) return `#${element.id}`;

  // Class name
  const firstClass = Array.from(element.classList)
    .filter((c) => !/[_][a-zA-Z0-9]{5,}/.test(c) && c.length > 2)
    .at(0);
  if (firstClass) return `${tag}.${firstClass}`;

  return tag;
}

/** Capture text content near the element (own + sibling text) */
export function getNearbyText(element: Element): string {
  const parts: string[] = [];

  const prev = element.previousElementSibling;
  if (prev?.textContent?.trim()) {
    parts.push(`[prev] ${prev.textContent.trim().slice(0, 50)}`);
  }

  const own = element.textContent?.trim();
  if (own) {
    parts.push(own.slice(0, 80));
  }

  const next = element.nextElementSibling;
  if (next?.textContent?.trim()) {
    parts.push(`[next] ${next.textContent.trim().slice(0, 50)}`);
  }

  return parts.join(" | ");
}

/**
 * Get the React fiber node for a DOM element.
 * React attaches fibers via a `__reactFiber$` prefixed property.
 */
function getReactFiber(node: Element): any | null {
  for (const key of Object.keys(node)) {
    if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
      return (node as any)[key];
    }
  }
  return null;
}

/**
 * Framework-internal component names to skip when building the ancestry path.
 * These are React/Next.js/framework plumbing, not user code.
 */
const FRAMEWORK_COMPONENTS = new Set([
  // Next.js internals
  "AppRouter", "Router", "HotReload", "InnerLayoutRouter", "OuterLayoutRouter",
  "RenderFromTemplateContext", "ScrollAndFocusHandler", "InnerScrollAndFocusHandler",
  "ClientPageRoot", "SegmentViewNode", "SegmentStateProvider",
  "RootErrorBoundary", "AppDevOverlayErrorBoundary",
  "DevRootHTTPAccessFallbackBoundary",
  "Root", "ServerRoot",
  // Generic React/framework patterns
  "ErrorBoundary", "ErrorBoundaryHandler", "Suspense",
  "RedirectBoundary", "RedirectErrorBoundary",
  "HTTPAccessFallbackBoundary", "HTTPAccessFallbackErrorBoundary",
  "LoadingBoundary",
]);

/**
 * Check if a fiber represents a user-defined component.
 * Must be PascalCase, a function/class (not a host element), and not
 * a known framework internal.
 */
function isUserComponent(fiber: any): boolean {
  if (!fiber || !fiber.type) return false;
  if (typeof fiber.type === "string") return false;
  const name = fiber.type.displayName || fiber.type.name;
  if (!name) return false;
  if (!/^[A-Z]/.test(name)) return false;
  if (FRAMEWORK_COMPONENTS.has(name)) return false;
  // Skip names that look like framework internals (Context, Provider, etc.)
  if (/Context$|Provider$/.test(name)) return false;
  return true;
}

/**
 * Get the nearest React component name for a DOM element by walking the
 * fiber tree. Returns just the innermost user component (e.g. "Header"),
 * not the full ancestry chain.
 *
 * Falls back to data-iterate-component/data-iterate-source attributes
 * if the babel plugin injected them.
 */
export function getComponentInfo(element: Element): {
  component: string | null;
  source: string | null;
  isComponentRoot: boolean;
} {
  // Strategy 1: Walk the React fiber tree to nearest user component
  const fiber = getReactFiber(element);
  if (fiber) {
    let current = fiber;
    let isFirst = true;
    while (current) {
      if (isUserComponent(current)) {
        const name = current.type.displayName || current.type.name;
        const debugSource = current._debugSource;
        const source = debugSource
          ? `${debugSource.fileName}:${debugSource.lineNumber}`
          : null;
        // The element is the component root if the component fiber
        // is the immediate parent of the element's host fiber
        return { component: name, source, isComponentRoot: isFirst };
      }
      // After the first hop from the host fiber, we're no longer at the root
      if (current === fiber.return) isFirst = false;
      current = current.return;
    }
  }

  // Strategy 2: Fall back to data attributes from babel plugin
  let el: Element | null = element;
  while (el && el !== document.documentElement) {
    const component = el.getAttribute("data-iterate-component");
    const source = el.getAttribute("data-iterate-source");
    if (component) {
      return { component, source, isComponentRoot: false };
    }
    el = el.parentElement;
  }

  return { component: null, source: null, isComponentRoot: false };
}

// --- Type-specific style capture (inspired by agentation) ---

const TEXT_ELEMENTS = new Set(["p", "span", "h1", "h2", "h3", "h4", "h5", "h6", "label", "a", "li"]);
const CONTAINER_ELEMENTS = new Set(["div", "section", "main", "article", "aside", "nav", "header", "footer"]);
const INTERACTIVE_ELEMENTS = new Set(["button", "input", "select", "textarea"]);

const TEXT_PROPERTIES = [
  "color", "font-size", "font-weight", "font-family", "line-height",
  "text-align", "text-decoration", "letter-spacing",
];

const CONTAINER_PROPERTIES = [
  "display", "flex-direction", "justify-content", "align-items", "gap",
  "grid-template-columns", "grid-template-rows",
  "padding", "margin", "background-color", "border-radius", "overflow",
];

const INTERACTIVE_PROPERTIES = [
  "background-color", "color", "padding", "border-radius",
  "font-size", "font-weight", "border", "cursor", "outline",
];

const POSITION_PROPERTIES = [
  "position", "top", "left", "right", "bottom", "z-index",
  "width", "height",
];

const SKIP_VALUES = new Set(["none", "normal", "auto", "0px", "transparent", "rgba(0, 0, 0, 0)"]);

/**
 * Extract computed styles relevant to the element's type.
 * Text elements get typography props, containers get layout props, etc.
 */
export function getRelevantStyles(element: Element): Record<string, string> {
  const computed = window.getComputedStyle(element);
  const tag = element.tagName.toLowerCase();
  const relevant: Record<string, string> = {};

  // Always include position properties
  let properties = [...POSITION_PROPERTIES];

  if (TEXT_ELEMENTS.has(tag)) {
    properties = properties.concat(TEXT_PROPERTIES);
  } else if (INTERACTIVE_ELEMENTS.has(tag)) {
    properties = properties.concat(INTERACTIVE_PROPERTIES);
  } else if (CONTAINER_ELEMENTS.has(tag)) {
    properties = properties.concat(CONTAINER_PROPERTIES);
  } else {
    // Generic: include a mix
    properties = properties.concat(CONTAINER_PROPERTIES, TEXT_PROPERTIES);
  }

  for (const prop of properties) {
    const value = computed.getPropertyValue(prop);
    if (value && !SKIP_VALUES.has(value)) {
      relevant[prop] = value;
    }
  }

  return relevant;
}
