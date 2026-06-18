/**
 * Curated design-knowledge corpus.
 *
 * Each principle is actionable and, where possible, *measurable* — it carries a
 * heuristic the agent can check against captured computed styles (font-size,
 * contrast, gap, target size, …). This is what keeps critique findings concrete
 * ("this CTA is 32px tall; target ≥44px") rather than generic advice.
 *
 * The structured array is the machine-readable index and is self-sufficient for
 * `formatCritiquePrompt`. `appliesToStyles` / `appliesToElements` drive principle
 * selection so a critique only surfaces principles relevant to what was captured —
 * and so the same corpus can be reused by future features (knowledge-injected
 * edits, goal-driven iteration) against any SnapshotNode / SelectedElement.
 */

export type PrincipleCategory =
  | "typography"
  | "spacing"
  | "color"
  | "hierarchy"
  | "a11y"
  | "interaction";

export interface DesignPrinciple {
  /** Stable id, e.g. "type-line-length" */
  id: string;
  category: PrincipleCategory;
  title: string;
  /** The actionable principle */
  rule: string;
  /** A measurable test the agent can evaluate, e.g. "body line-length 45–75ch" */
  heuristic: string;
  /** CSS properties this principle inspects — drives selection */
  appliesToStyles?: string[];
  /** Lowercase element/tag names this applies to, e.g. ["button","a"] */
  appliesToElements?: string[];
  citation: { source: string; url?: string };
}

export const DESIGN_PRINCIPLES: DesignPrinciple[] = [
  // --- Typography ---
  {
    id: "type-line-length",
    category: "typography",
    title: "Comfortable line length",
    rule: "Keep running text to a readable measure so the eye can track from line to line.",
    heuristic:
      "Body text line length should be ~45–75 characters (≈ 30em max-width for paragraphs). Flag containers of long text wider than ~75ch.",
    appliesToStyles: ["font-size", "max-width", "width"],
    citation: { source: "Butterick, Practical Typography — Line length" },
  },
  {
    id: "type-min-body-size",
    category: "typography",
    title: "Legible body size",
    rule: "Body copy must be large enough to read without strain on the target device.",
    heuristic:
      "Body font-size should be ≥ 16px on the web. Flag paragraph/body text below 14px.",
    appliesToStyles: ["font-size"],
    citation: { source: "Refactoring UI — Typography" },
  },
  {
    id: "type-line-height",
    category: "typography",
    title: "Line height scales with measure",
    rule: "Generous leading aids readability for body text; tighten it for large headings.",
    heuristic:
      "Body line-height should be ~1.4–1.6. Flag body text with line-height < 1.3 or > 1.8.",
    appliesToStyles: ["line-height", "font-size"],
    citation: { source: "Refactoring UI — Typography" },
  },
  {
    id: "type-scale",
    category: "typography",
    title: "Limited, deliberate type scale",
    rule: "Use a small set of font sizes from a consistent scale rather than ad-hoc values.",
    heuristic:
      "Distinct font sizes on a page should be few (≈ 4–6) and follow a ratio-based scale. Flag many near-duplicate sizes (e.g. 15px/16px/17px mixed).",
    appliesToStyles: ["font-size", "font-weight"],
    citation: { source: "Refactoring UI — Typographic scale" },
  },

  // --- Spacing ---
  {
    id: "space-rhythm",
    category: "spacing",
    title: "Consistent spacing rhythm",
    rule: "Derive margins, padding and gaps from a single spacing scale (e.g. multiples of 4 or 8px).",
    heuristic:
      "Spacing values should snap to a 4/8px scale. Flag arbitrary values (e.g. 13px, 27px) that break the rhythm.",
    appliesToStyles: ["margin", "padding", "gap", "row-gap", "column-gap"],
    citation: { source: "Refactoring UI — Spacing and sizing" },
  },
  {
    id: "space-proximity",
    category: "spacing",
    title: "Proximity groups related items",
    rule: "Related elements should sit closer together than unrelated ones; whitespace communicates grouping.",
    heuristic:
      "Within a group, gap should be noticeably smaller than the gap separating groups. Flag uniform spacing that erases grouping, or labels equidistant between two controls.",
    appliesToStyles: ["gap", "margin", "padding"],
    citation: { source: "Gestalt principles — Proximity" },
  },

  // --- Color / contrast ---
  {
    id: "color-text-contrast",
    category: "color",
    title: "Sufficient text contrast",
    rule: "Text must contrast enough with its background to be readable.",
    heuristic:
      "Contrast ratio ≥ 4.5:1 for normal text, ≥ 3:1 for large text (≥ 24px, or ≥ 18.66px bold). Compute from color vs. effective background (best-effort).",
    appliesToStyles: ["color", "background-color", "font-size", "font-weight"],
    citation: { source: "WCAG 2.1 — 1.4.3 Contrast (Minimum)", url: "https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html" },
  },
  {
    id: "color-restraint",
    category: "color",
    title: "Restrained palette with one accent",
    rule: "Use a limited palette and reserve a saturated accent for primary actions.",
    heuristic:
      "Roughly a 60/30/10 split (dominant/secondary/accent). Flag many competing saturated colors or multiple primary-looking CTAs in one view.",
    appliesToStyles: ["color", "background-color", "border-color"],
    citation: { source: "Interior design 60-30-10 rule, applied to UI" },
  },

  // --- Hierarchy ---
  {
    id: "hierarchy-emphasis",
    category: "hierarchy",
    title: "Clear visual hierarchy",
    rule: "The most important element should be the most visually prominent; de-emphasize secondary content.",
    heuristic:
      "Primary actions/headings should outrank others via size, weight, or color. Flag a flat surface where everything competes, or a secondary action styled as prominently as the primary.",
    appliesToStyles: ["font-size", "font-weight", "color", "background-color"],
    citation: { source: "Refactoring UI — Hierarchy is everything" },
  },
  {
    id: "hierarchy-one-primary",
    category: "hierarchy",
    title: "One primary action per view",
    rule: "Avoid multiple equally-weighted primary actions; guide the user to the main next step.",
    heuristic:
      "Flag two or more buttons with identical high-emphasis styling competing as 'the' primary action.",
    appliesToElements: ["button", "a"],
    appliesToStyles: ["background-color", "font-weight"],
    citation: { source: "Refactoring UI — Emphasize by de-emphasizing" },
  },

  // --- Accessibility ---
  {
    id: "a11y-target-size",
    category: "a11y",
    title: "Adequate touch target size",
    rule: "Interactive controls must be large enough to activate reliably, especially on touch.",
    heuristic:
      "Interactive targets should be ≥ 44×44px (Apple HIG) / ≥ 24×24px minimum (WCAG 2.2). Flag buttons/links/inputs smaller than 44px in the smaller dimension.",
    appliesToElements: ["button", "a", "input", "select", "textarea"],
    appliesToStyles: ["height", "width", "padding"],
    citation: { source: "WCAG 2.2 — 2.5.8 Target Size; Apple HIG", url: "https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html" },
  },
  {
    id: "a11y-focus-visible",
    category: "a11y",
    title: "Visible focus state",
    rule: "Keyboard focus must be visible; do not remove outlines without replacing them.",
    heuristic:
      "Flag interactive elements with outline:none and no alternative focus indicator (ring/box-shadow/border change).",
    appliesToElements: ["button", "a", "input", "select", "textarea"],
    appliesToStyles: ["outline", "box-shadow"],
    citation: { source: "WCAG 2.1 — 2.4.7 Focus Visible", url: "https://www.w3.org/WAI/WCAG21/Understanding/focus-visible.html" },
  },

  // --- Interaction ---
  {
    id: "interaction-fitts",
    category: "interaction",
    title: "Make important targets big and close (Fitts's Law)",
    rule: "Time to acquire a target grows with distance and shrinks with size — make frequent/primary actions larger and easy to reach.",
    heuristic:
      "Primary actions should be among the larger interactive elements. Flag a small/cramped primary CTA, or critical actions placed far from the user's likely focus.",
    appliesToElements: ["button", "a"],
    appliesToStyles: ["height", "width", "padding", "font-size"],
    citation: { source: "Fitts's Law (1954); Universal Principles of Design" },
  },
  {
    id: "interaction-affordance",
    category: "interaction",
    title: "Clear affordance for interactivity",
    rule: "Interactive elements should look interactive (cursor, hover/active states, button-like styling).",
    heuristic:
      "Flag clickable elements without pointer cursor, or links/buttons visually indistinguishable from static text.",
    appliesToElements: ["button", "a"],
    appliesToStyles: ["cursor", "text-decoration", "background-color", "border"],
    citation: { source: "Don't Make Me Think — Affordances" },
  },
];

/** Look up a principle by id. */
export function getPrinciple(id: string): DesignPrinciple | undefined {
  return DESIGN_PRINCIPLES.find((p) => p.id === id);
}
