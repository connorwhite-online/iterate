import type { DaemonClient } from "../connection/daemon-client.js";

/**
 * MCP tool definitions for working with annotations.
 */
export function getAnnotationTools(client: DaemonClient) {
  return [
    {
      name: "iterate_list_annotations",
      description:
        "List all annotations placed on iterations by the user. Each annotation includes a CSS selector, bounding rect, computed styles, and the user's comment about what should change.",
      inputSchema: {
        type: "object" as const,
        properties: {
          iteration: {
            type: "string",
            description:
              "Filter by iteration name (optional, returns all if omitted)",
          },
        },
      },
      handler: async (args: { iteration?: string }) => {
        let annotations = client.getAnnotations();

        if (args.iteration) {
          annotations = annotations.filter(
            (a) => a.iteration === args.iteration
          );
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
          .map(
            (a) =>
              `## Annotation: ${a.comment}\n` +
              `- **Iteration**: ${a.iteration}\n` +
              `- **Selector**: \`${a.selector}\`\n` +
              `- **Bounding rect**: ${JSON.stringify(a.rect)}\n` +
              `- **Key styles**: ${formatStyles(a.computedStyles)}\n` +
              `- **Time**: ${new Date(a.timestamp).toISOString()}`
          )
          .join("\n\n");

        return {
          content: [{ type: "text" as const, text }],
        };
      },
    },
    {
      name: "iterate_get_dom_context",
      description:
        "Get the full DOM context for a specific annotation, including the element's selector, computed styles, and surrounding layout information. Use this to understand what the user is pointing at.",
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

        const text =
          `# DOM Context for Annotation\n\n` +
          `**User comment**: ${annotation.comment}\n` +
          `**Iteration**: ${annotation.iteration}\n` +
          `**CSS Selector**: \`${annotation.selector}\`\n\n` +
          `## Bounding Rect\n` +
          `\`\`\`json\n${JSON.stringify(annotation.rect, null, 2)}\n\`\`\`\n\n` +
          `## Computed Styles\n` +
          `\`\`\`json\n${JSON.stringify(annotation.computedStyles, null, 2)}\n\`\`\``;

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
