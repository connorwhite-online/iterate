import type { DaemonClient } from "../connection/daemon-client.js";

/**
 * MCP tool definitions for working with annotations.
 * These are the structured definitions — the actual tool registration
 * now happens in index.ts using the MCP SDK's server.tool() API.
 */
export function getAnnotationTools(client: DaemonClient) {
  return [
    {
      name: "iterate_list_annotations",
      description:
        "List all annotations placed on iterations by the user. Each annotation targets one or more selected elements with React component names, source file paths, CSS selectors, computed styles, and the user's comment.",
      inputSchema: {
        type: "object" as const,
        properties: {
          iteration: {
            type: "string",
            description:
              "Filter by iteration name (optional, returns all if omitted)",
          },
          status: {
            type: "string",
            enum: ["pending", "acknowledged", "resolved", "dismissed"],
            description: "Filter by annotation status (optional)",
          },
        },
      },
      handler: async (args: { iteration?: string; status?: string }) => {
        let annotations = client.getAnnotations();

        if (args.iteration) {
          annotations = annotations.filter(
            (a) => a.iteration === args.iteration
          );
        }
        if (args.status) {
          annotations = annotations.filter((a) => a.status === args.status);
        }

        if (annotations.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No annotations found.",
              },
            ],
          };
        }

        const text = annotations
          .map((a) => {
            const primary = a.elements[0];
            const headline = primary
              ? (primary.componentName || primary.elementName || primary.selector)
              : "(no elements)";

            let out =
              `## ${headline}: "${a.comment}"\n` +
              `- **ID**: ${a.id}\n` +
              `- **Status**: ${a.status}${a.intent ? ` | Intent: ${a.intent}` : ""}${a.severity ? ` | Severity: ${a.severity}` : ""}\n` +
              `- **Iteration**: ${a.iteration}\n` +
              `- **Elements** (${a.elements.length}):\n`;

            for (const el of a.elements) {
              const name = el.componentName
                ? `<${el.componentName}>`
                : el.elementName || el.selector;
              const source = el.sourceLocation ? ` (${el.sourceLocation})` : "";
              out += `  - **${name}**${source}\n`;
              out += `    Selector: \`${el.selector}\`\n`;
              out += `    Rect: ${el.rect.width.toFixed(0)}×${el.rect.height.toFixed(0)} at (${el.rect.x.toFixed(0)}, ${el.rect.y.toFixed(0)})\n`;
              if (el.nearbyText) out += `    Text: ${el.nearbyText}\n`;
              out += `    Styles: ${formatStyles(el.computedStyles)}\n`;
            }

            if (a.textSelection) {
              out += `- **Text selection**: "${a.textSelection.text.slice(0, 100)}${a.textSelection.text.length > 100 ? "…" : ""}"\n`;
            }

            out += `- **Time**: ${new Date(a.timestamp).toISOString()}`;
            if (a.agentReply) out += `\n- **Agent reply**: ${a.agentReply}`;

            return out;
          })
          .join("\n\n");

        return {
          content: [{ type: "text" as const, text }],
        };
      },
    },
    {
      name: "iterate_get_dom_context",
      description:
        "Get the full DOM context for a specific annotation, including all selected elements with React component names, source file paths, CSS selectors, computed styles, and layout information.",
      inputSchema: {
        type: "object" as const,
        properties: {
          annotationId: {
            type: "string",
            description: "ID of the annotation to inspect",
          },
        },
        required: ["annotationId"],
      },
      handler: async (args: { annotationId: string }) => {
        const annotations = client.getAnnotations();
        const annotation = annotations.find(
          (a) => a.id === args.annotationId
        );

        if (!annotation) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Annotation "${args.annotationId}" not found.`,
              },
            ],
          };
        }

        let text =
          `# DOM Context for Annotation\n\n` +
          `**User comment**: ${annotation.comment}\n` +
          `**Iteration**: ${annotation.iteration}\n` +
          `**Status**: ${annotation.status}${annotation.intent ? ` | Intent: ${annotation.intent}` : ""}${annotation.severity ? ` | Severity: ${annotation.severity}` : ""}\n\n`;

        text += `## Selected Elements (${annotation.elements.length})\n\n`;
        for (const el of annotation.elements) {
          const name = el.componentName ? `<${el.componentName}>` : el.elementName;
          const source = el.sourceLocation ? ` — \`${el.sourceLocation}\`` : "";
          text += `### ${name || el.selector}${source}\n`;
          text += `- **Selector**: \`${el.selector}\`\n`;
          text += `- **DOM path**: \`${el.elementPath}\`\n`;
          text += `- **Bounding rect**:\n\`\`\`json\n${JSON.stringify(el.rect, null, 2)}\n\`\`\`\n`;
          if (el.nearbyText) text += `- **Nearby text**: ${el.nearbyText}\n`;
          text += `- **Computed styles**:\n\`\`\`json\n${JSON.stringify(el.computedStyles, null, 2)}\n\`\`\`\n\n`;
        }

        if (annotation.textSelection) {
          text += `## Text Selection\n`;
          text += `- **Selected text**: "${annotation.textSelection.text}"\n`;
          text += `- **Containing element**: \`${annotation.textSelection.containingElement.selector}\`\n`;
          text += `- **Offsets**: ${annotation.textSelection.startOffset}–${annotation.textSelection.endOffset}\n`;
        }

        return {
          content: [{ type: "text" as const, text }],
        };
      },
    },
  ];
}

function formatStyles(styles: Record<string, string>): string {
  const entries = Object.entries(styles).slice(0, 6);
  if (entries.length === 0) return "none captured";
  return entries.map(([k, v]) => `\`${k}: ${v}\``).join(", ");
}
