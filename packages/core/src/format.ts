import type { SelectedElement, TextSelection, AnnotationIntent, AnnotationSeverity, Rect } from "./types/annotations.js";

/**
 * A single annotation item to format (works for both pending and persisted annotations).
 */
export interface FormatAnnotation {
  comment: string;
  elements: SelectedElement[];
  textSelection?: TextSelection;
  intent?: AnnotationIntent;
  severity?: AnnotationSeverity;
}

/**
 * A DOM change item to format.
 */
export interface FormatDomChange {
  type: string;
  selector: string;
  componentName: string | null;
  sourceLocation: string | null;
  before: { rect: Rect };
  after: { rect: Rect };
}

/**
 * Format a batch of annotations and DOM changes as a human-readable prompt
 * suitable for pasting into any AI agent chat.
 */
export function formatBatchPrompt(
  annotations: FormatAnnotation[],
  domChanges: FormatDomChange[],
  iteration?: string,
): string {
  if (annotations.length === 0 && domChanges.length === 0) {
    return "No pending feedback.";
  }

  let text = `# UI Feedback from iterate\n\n`;

  if (iteration) {
    text += `**Iteration**: ${iteration}\n\n`;
  }

  text += `I've reviewed the UI and have the following feedback:\n\n`;

  for (let i = 0; i < annotations.length; i++) {
    const a = annotations[i];
    text += `## ${i + 1}. "${a.comment}"\n`;

    const tags: string[] = [];
    if (a.intent) tags.push(`Intent: ${a.intent}`);
    if (a.severity) tags.push(`Severity: ${a.severity}`);
    if (tags.length > 0) text += `- ${tags.join(" | ")}\n`;

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

    text += `\n`;
  }

  if (domChanges.length > 0) {
    text += `## DOM Changes (${domChanges.length})\n\n`;
    for (const dc of domChanges) {
      const dcName = dc.componentName ? `<${dc.componentName}>` : dc.selector;
      const dcSource = dc.sourceLocation ? ` — \`${dc.sourceLocation}\`` : "";
      text += `- **${dc.type}** on ${dcName}${dcSource}\n`;
      text += `  Selector: \`${dc.selector}\`\n`;
      const before = dc.before.rect;
      const after = dc.after.rect;
      text += `  Before: ${before.width.toFixed(0)}×${before.height.toFixed(0)} at (${before.x.toFixed(0)}, ${before.y.toFixed(0)})\n`;
      text += `  After: ${after.width.toFixed(0)}×${after.height.toFixed(0)} at (${after.x.toFixed(0)}, ${after.y.toFixed(0)})\n`;
    }
    text += `\n`;
  }

  text += `Please process this feedback and make the requested changes.`;

  return text;
}
