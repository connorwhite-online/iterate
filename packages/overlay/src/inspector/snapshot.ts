import type { PageSnapshot, SnapshotNode, Rect } from "iterate-ui-core";
import { elementToPicked } from "./ElementPicker.js";

/** Elements we never want in a snapshot (non-visual / structural). */
const SKIP_TAGS = new Set([
  "script", "style", "meta", "link", "head", "noscript", "br", "template",
  "title", "svg", "path", "g", "defs", "use",
]);

function isOverlayElement(el: Element): boolean {
  return (
    !!el.closest("#__iterate-overlay-root__") ||
    !!el.closest("#__iterate-markers-layer__") ||
    !!el.closest("#__iterate-fixed-markers-layer__")
  );
}

/** Whether an element (or an ancestor) is position:fixed/sticky. */
function isElementFixed(element: Element | null): boolean {
  let current = element;
  while (current && current !== document.documentElement) {
    const pos = window.getComputedStyle(current).position;
    if (pos === "fixed" || pos === "sticky") return true;
    current = current.parentElement;
  }
  return false;
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y);
}

export interface CaptureOptions {
  /** Limit capture to a region (page coordinates). */
  region?: Rect;
  /** Hard cap on captured nodes (default 80). */
  maxNodes?: number;
}

/**
 * Capture a DOM/style snapshot of the page for design critique.
 *
 * Defaults to the **current viewport** (not the whole page) so the snapshot
 * stays small enough for the agent's context. Reuses `elementToPicked` for
 * per-element metadata, skips iterate's own overlay UI, prunes invisible /
 * zero-area nodes, and converts rects to page coordinates so badges anchor
 * correctly when the page scrolls.
 */
export function capturePageSnapshot(
  doc: Document,
  scrollOffset: { x: number; y: number },
  opts: CaptureOptions = {},
): PageSnapshot {
  const maxNodes = opts.maxNodes ?? 80;
  const viewport = { width: window.innerWidth, height: window.innerHeight };

  // The scope rect in page coordinates: an explicit region, else the viewport.
  const scope: Rect = opts.region ?? {
    x: scrollOffset.x,
    y: scrollOffset.y,
    width: viewport.width,
    height: viewport.height,
  };

  const all = Array.from(doc.querySelectorAll<HTMLElement>("body *"));
  const nodes: SnapshotNode[] = [];
  // Prefer component roots when we have to drop nodes to fit the cap.
  const roots: SnapshotNode[] = [];

  for (const el of all) {
    if (nodes.length + roots.length >= maxNodes * 3) break; // bound the walk itself
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) continue;
    if (isOverlayElement(el)) continue;

    const cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;

    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;

    // Page-coordinate rect for scope test + badge placement.
    const pageRect: Rect = {
      x: r.x + scrollOffset.x,
      y: r.y + scrollOffset.y,
      width: r.width,
      height: r.height,
    };
    if (!rectsIntersect(pageRect, scope)) continue;

    // Compute depth within <body>.
    let depth = 0;
    let p = el.parentElement;
    while (p && p !== doc.body && depth < 20) {
      depth++;
      p = p.parentElement;
    }

    const picked = elementToPicked(el);
    const node: SnapshotNode = {
      selector: picked.selector,
      elementName: picked.elementName,
      tagName: tag,
      elementPath: picked.elementPath,
      rect: pageRect,
      computedStyles: picked.computedStyles,
      nearbyText: picked.nearbyText,
      componentName: picked.componentName,
      sourceLocation: picked.sourceLocation,
      depth,
      isFixed: isElementFixed(el),
    };

    if (node.componentName) roots.push(node);
    else nodes.push(node);
  }

  // Component roots first (highest signal), then fill remaining budget with the rest.
  const ordered = [...roots, ...nodes].slice(0, maxNodes);
  // Keep document order for readability.
  ordered.sort((a, b) => (a.rect.y - b.rect.y) || (a.rect.x - b.rect.x));

  return {
    url: getCurrentUrl(doc),
    viewport,
    capturedAt: Date.now(),
    region: opts.region,
    nodes: ordered,
  };
}

function getCurrentUrl(doc: Document): string {
  try {
    return doc.defaultView?.location.href ?? window.location.href;
  } catch {
    return window.location.href;
  }
}
