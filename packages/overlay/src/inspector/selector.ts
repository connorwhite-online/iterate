/**
 * Generate a unique CSS selector for a DOM element.
 * Tries to produce the most specific yet readable selector.
 */
export function generateSelector(element: Element): string {
  // If element has an id, use it
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  // Build a path from the element to the root
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();

    // Add class names (up to 2 for readability)
    const classes = Array.from(current.classList)
      .filter((c) => !c.startsWith("__") && !c.includes("svelte-"))
      .slice(0, 2);

    if (classes.length > 0) {
      selector += classes.map((c) => `.${CSS.escape(c)}`).join("");
    }

    // Check if this selector is already unique
    if (current.parentElement) {
      const siblings = current.parentElement.querySelectorAll(
        `:scope > ${selector}`
      );
      if (siblings.length > 1) {
        // Add nth-child
        const index =
          Array.from(current.parentElement.children).indexOf(current) + 1;
        selector += `:nth-child(${index})`;
      }
    }

    parts.unshift(selector);

    // If we've built a unique selector, stop
    if (document.querySelectorAll(parts.join(" > ")).length === 1) {
      break;
    }

    current = current.parentElement;
  }

  return parts.join(" > ");
}

/**
 * Extract relevant computed styles for an element.
 */
export function getRelevantStyles(
  element: Element
): Record<string, string> {
  const computed = window.getComputedStyle(element);
  const relevant: Record<string, string> = {};

  const properties = [
    "display",
    "position",
    "width",
    "height",
    "margin",
    "padding",
    "flex-direction",
    "justify-content",
    "align-items",
    "gap",
    "grid-template-columns",
    "grid-template-rows",
    "top",
    "left",
    "right",
    "bottom",
    "z-index",
    "overflow",
    "background-color",
    "color",
    "font-size",
    "font-weight",
    "border",
    "border-radius",
    "box-shadow",
    "opacity",
  ];

  for (const prop of properties) {
    const value = computed.getPropertyValue(prop);
    if (value && value !== "none" && value !== "normal" && value !== "auto") {
      relevant[prop] = value;
    }
  }

  return relevant;
}
