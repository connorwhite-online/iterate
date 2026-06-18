import type { SelectedElement, TextSelection, DrawingData, Rect, PageSnapshot } from "./types/annotations.js";
import { selectPrinciples, type DesignPrinciple } from "./knowledge/index.js";

/**
 * A single change item to format (works for both pending and persisted changes).
 */
export interface FormatChange {
  comment: string;
  elements: SelectedElement[];
  textSelection?: TextSelection;
  drawing?: DrawingData;
  iteration?: string;
  url?: string;
}

/**
 * A DOM change item to format.
 */
export interface FormatDomChange {
  id?: string;
  type: string;
  selector: string;
  componentName: string | null;
  sourceLocation: string | null;
  before: { rect: Rect; siblingIndex?: number };
  after: { rect: Rect; siblingIndex?: number };
  parentSelector?: string;
  targetParentSelector?: string;
  url?: string;
}

/**
 * Format a batch of changes and DOM changes as a human-readable prompt
 * suitable for pasting into any AI agent chat.
 */
export function formatBatchPrompt(
  changes: FormatChange[],
  domChanges: FormatDomChange[],
  iteration?: string,
): string {
  if (changes.length === 0 && domChanges.length === 0) {
    return "No pending feedback.";
  }

  let text = `# UI Feedback from iterate\n\n`;

  // Show a single iteration header if all changes share the same one,
  // otherwise show per-change iteration labels.
  const uniqueIterations = new Set(changes.map((a) => a.iteration ?? iteration).filter(Boolean));
  const singleIteration = uniqueIterations.size === 1 ? [...uniqueIterations][0] : null;

  if (singleIteration) {
    text += `**Iteration**: ${singleIteration}\n\n`;
  }

  text += `I've reviewed the UI and have the following feedback:\n\n`;

  for (let i = 0; i < changes.length; i++) {
    const a = changes[i];
    text += `## ${i + 1}. "${a.comment}"\n`;

    if (!singleIteration && a.iteration) {
      text += `- **Iteration**: ${a.iteration}\n`;
    }
    if (a.url) {
      text += `- **Page**: ${a.url}\n`;
    }

    if (a.elements.length > 0) {
      text += `- **Elements** (${a.elements.length}):\n`;
      for (const el of a.elements) {
        const name = el.componentName
          ? `<${el.componentName}>`
          : el.elementName || el.selector;
        const source = el.sourceLocation ? ` — \`${el.sourceLocation}\`` : "";
        text += `  - **${name}**${source}\n`;
        text += `    Selector: \`${el.selector}\`\n`;
        text += `    Size: ${el.rect.width.toFixed(0)}×${el.rect.height.toFixed(0)} at (${el.rect.x.toFixed(0)}, ${el.rect.y.toFixed(0)})\n`;
        if (el.nearbyText) text += `    Text: "${el.nearbyText}"\n`;
        const styles = Object.entries(el.computedStyles)
          .slice(0, 6)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
        if (styles) text += `    Styles: ${styles}\n`;
      }
    }

    if (a.textSelection) {
      text += `- **Selected text**: "${a.textSelection.text}"\n`;
      const container = a.textSelection.containingElement;
      const containerName = container.componentName
        ? `<${container.componentName}>`
        : container.elementName || container.selector;
      text += `  In: ${containerName} (\`${container.selector}\`)\n`;
    }

    if (a.drawing) {
      text += `- **Drawing annotation** (marker tool)\n`;
      text += `  Region: ${a.drawing.bounds.width.toFixed(0)}×${a.drawing.bounds.height.toFixed(0)} at (${a.drawing.bounds.x.toFixed(0)}, ${a.drawing.bounds.y.toFixed(0)})\n`;
      text += `  SVG path: \`${a.drawing.path}\`\n`;
      text += `  Stroke: ${a.drawing.strokeColor}, width ${a.drawing.strokeWidth}\n`;
    }

    text += `\n`;
  }

  if (domChanges.length > 0) {
    text += `## DOM Changes (${domChanges.length})\n\n`;
    for (const dc of domChanges) {
      const dcName = dc.componentName ? `<${dc.componentName}>` : dc.selector;
      const dcSource = dc.sourceLocation ? ` — \`${dc.sourceLocation}\`` : "";
      const isCrossParent = dc.targetParentSelector && dc.targetParentSelector !== dc.parentSelector;
      const label = isCrossParent ? "reparent" : dc.type;
      text += `- **${label}** on ${dcName}${dcSource}\n`;
      if (dc.id) text += `  ID: ${dc.id}\n`;
      if (dc.url) text += `  Page: ${dc.url}\n`;
      text += `  Selector: \`${dc.selector}\`\n`;
      if (dc.type === "reorder" && dc.before.siblingIndex !== undefined) {
        if (isCrossParent) {
          text += `  From: \`${dc.parentSelector}\` (index ${dc.before.siblingIndex})\n`;
          text += `  To: \`${dc.targetParentSelector}\` (index ${dc.after.siblingIndex})\n`;
        } else {
          text += `  Reordered: index ${dc.before.siblingIndex} → ${dc.after.siblingIndex}`;
          if (dc.parentSelector) text += ` in \`${dc.parentSelector}\``;
          text += `\n`;
        }
      } else {
        const before = dc.before.rect;
        const after = dc.after.rect;
        text += `  Before: ${before.width.toFixed(0)}×${before.height.toFixed(0)} at (${before.x.toFixed(0)}, ${before.y.toFixed(0)})\n`;
        text += `  After: ${after.width.toFixed(0)}×${after.height.toFixed(0)} at (${after.x.toFixed(0)}, ${after.y.toFixed(0)})\n`;
      }
    }
    text += `\n`;
  }

  text += `Please process this feedback and make the requested changes.`;

  return text;
}

/**
 * Format a page snapshot plus the relevant design principles as a prompt the
 * agent uses to produce a design critique. Mirrors `formatBatchPrompt`'s element
 * blocks so the agent sees the same kind of structured, measured element data.
 *
 * If `principles` is omitted, the relevant subset is selected automatically from
 * the snapshot's nodes (see `selectPrinciples`).
 */
export function formatCritiquePrompt(
  snapshot: PageSnapshot,
  principles?: DesignPrinciple[],
): string {
  const selected = principles ?? selectPrinciples(snapshot.nodes);

  let text = `# Design Critique Request\n\n`;
  text += `Evaluate this page against the design principles below and return prioritized, element-anchored findings.\n\n`;
  text += `**Page**: ${snapshot.url}\n`;
  text += `**Viewport**: ${snapshot.viewport.width}×${snapshot.viewport.height}\n`;
  if (snapshot.region) {
    const r = snapshot.region;
    text += `**Region**: ${r.width.toFixed(0)}×${r.height.toFixed(0)} at (${r.x.toFixed(0)}, ${r.y.toFixed(0)})\n`;
  }
  text += `**Captured elements**: ${snapshot.nodes.length}\n\n`;

  text += `## Elements\n\n`;
  for (const node of snapshot.nodes) {
    const indent = "  ".repeat(Math.min(node.depth, 6));
    const name = node.componentName ? `<${node.componentName}>` : node.elementName || node.selector;
    const source = node.sourceLocation ? ` — \`${node.sourceLocation}\`` : "";
    text += `${indent}- **${name}**${source}\n`;
    text += `${indent}  Selector: \`${node.selector}\`\n`;
    text += `${indent}  Size: ${node.rect.width.toFixed(0)}×${node.rect.height.toFixed(0)} at (${node.rect.x.toFixed(0)}, ${node.rect.y.toFixed(0)})\n`;
    if (node.nearbyText) text += `${indent}  Text: "${node.nearbyText}"\n`;
    const styles = Object.entries(node.computedStyles)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    if (styles) text += `${indent}  Styles: ${styles}\n`;
  }
  text += `\n`;

  text += `## Design principles to evaluate against\n\n`;
  for (const p of selected) {
    text += `### ${p.title} (\`${p.id}\`, ${p.category})\n`;
    text += `- **Rule**: ${p.rule}\n`;
    text += `- **Heuristic**: ${p.heuristic}\n`;
    text += `- **Source**: ${p.citation.source}${p.citation.url ? ` (${p.citation.url})` : ""}\n\n`;
  }

  text += `## Instructions\n\n`;
  text += `For each issue you find, produce a finding with: the element selector, the cited principle id, a severity (high/medium/low), a one-line rationale, a measured value and target where applicable (e.g. "32px" vs "≥44px"), and a concrete recommendation. Prioritize by severity. Only raise findings backed by the captured data — do not speculate about things not visible in the snapshot.`;

  return text;
}
