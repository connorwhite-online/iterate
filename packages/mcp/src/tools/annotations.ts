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
        "List all annotations placed on iterations by the user. Each annotation includes element identification, intent/severity, status, CSS selector, computed styles, and the user's comment.",
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
          .map(
            (a) =>
              `## ${a.elementName || a.selector}: "${a.comment}"\n` +
              `- **ID**: ${a.id}\n` +
              `- **Status**: ${a.status}${a.intent ? ` | Intent: ${a.intent}` : ""}${a.severity ? ` | Severity: ${a.severity}` : ""}\n` +
              `- **Iteration**: ${a.iteration}\n` +
              `- **Element**: ${a.elementName || "(unknown)"}` +
              (a.elementPath ? ` — path: \`${a.elementPath}\`` : "") + "\n" +
              `- **Selector**: \`${a.selector}\`\n` +
              `- **Bounding rect**: ${JSON.stringify(a.rect)}\n` +
              (a.nearbyText ? `- **Nearby text**: ${a.nearbyText}\n` : "") +
              `- **Key styles**: ${formatStyles(a.computedStyles)}\n` +
              `- **Time**: ${new Date(a.timestamp).toISOString()}` +
              (a.agentReply ? `\n- **Agent reply**: ${a.agentReply}` : "")
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
        "Get the full DOM context for a specific annotation, including element identification, CSS selector, computed styles, nearby text, and layout information.",
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
          `**Element**: ${annotation.elementName || "(unknown)"}\n` +
          `**Path**: \`${annotation.elementPath || annotation.selector}\`\n` +
          `**Iteration**: ${annotation.iteration}\n` +
          `**CSS Selector**: \`${annotation.selector}\`\n` +
          `**Status**: ${annotation.status}${annotation.intent ? ` | Intent: ${annotation.intent}` : ""}${annotation.severity ? ` | Severity: ${annotation.severity}` : ""}\n` +
          (annotation.nearbyText ? `**Nearby text**: ${annotation.nearbyText}\n` : "") +
          `\n## Bounding Rect\n` +
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
