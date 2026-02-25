import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DaemonClient } from "./connection/daemon-client.js";

const DAEMON_PORT = parseInt(process.env.ITERATE_DAEMON_PORT ?? "4000", 10);

async function main() {
  // Connect to the iterate daemon
  const client = new DaemonClient(DAEMON_PORT);

  try {
    await client.connect();
  } catch (err) {
    console.error(
      `Failed to connect to iterate daemon on port ${DAEMON_PORT}. Is 'iterate serve' running?`
    );
    process.exit(1);
  }

  // Wait for initial state
  await client.waitForState();

  // Create MCP server
  const server = new McpServer({
    name: "iterate",
    version: "0.1.0",
  });

  // --- Iteration tools ---

  server.tool(
    "iterate_list_iterations",
    "List all active iterate iterations (worktrees with dev servers)",
    {},
    async () => {
      const iterations = client.getIterations();
      const entries = Object.values(iterations);

      if (entries.length === 0) {
        return {
          content: [
            { type: "text", text: "No active iterations." },
          ],
        };
      }

      const text = entries
        .map(
          (it) =>
            `- **${it.name}** (branch: \`${it.branch}\`, port: ${it.port}, status: ${it.status})`
        )
        .join("\n");

      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "iterate_create_iteration",
    "Create a new iteration (git worktree + dev server)",
    {
      name: z.string().describe("Name for the new iteration"),
      baseBranch: z
        .string()
        .optional()
        .describe("Branch to fork from (defaults to current)"),
    },
    async ({ name, baseBranch }) => {
      const result = await client.callApi("POST", "/api/iterations", {
        name,
        baseBranch,
      });
      return {
        content: [
          {
            type: "text",
            text: `Created iteration "${name}":\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``,
          },
        ],
      };
    }
  );

  server.tool(
    "iterate_pick_iteration",
    "Pick a winning iteration — merge to base and remove all others",
    {
      name: z.string().describe("Iteration to keep"),
      strategy: z
        .enum(["merge", "squash", "rebase"])
        .default("merge")
        .describe("Merge strategy"),
    },
    async ({ name, strategy }) => {
      await client.callApi("POST", "/api/iterations/pick", {
        name,
        strategy,
      });
      return {
        content: [
          {
            type: "text",
            text: `Picked iteration "${name}". Branch merged, others removed.`,
          },
        ],
      };
    }
  );

  server.tool(
    "iterate_remove_iteration",
    "Remove a specific iteration",
    {
      name: z.string().describe("Iteration to remove"),
    },
    async ({ name }) => {
      await client.callApi("DELETE", `/api/iterations/${name}`);
      return {
        content: [
          { type: "text", text: `Removed iteration "${name}".` },
        ],
      };
    }
  );

  // --- Annotation tools ---

  server.tool(
    "iterate_list_annotations",
    "List all user annotations with element context, intent, severity, and status. Use status filter to find pending annotations that need attention.",
    {
      iteration: z
        .string()
        .optional()
        .describe("Filter by iteration name"),
      status: z
        .enum(["pending", "acknowledged", "resolved", "dismissed"])
        .optional()
        .describe("Filter by status (default: all)"),
    },
    async ({ iteration, status }) => {
      let annotations = client.getAnnotations();
      if (iteration) {
        annotations = annotations.filter((a) => a.iteration === iteration);
      }
      if (status) {
        annotations = annotations.filter((a) => a.status === status);
      }

      if (annotations.length === 0) {
        return {
          content: [{ type: "text", text: "No annotations found." }],
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
            `- **Rect**: ${a.rect.width.toFixed(0)}x${a.rect.height.toFixed(0)} at (${a.rect.x.toFixed(0)}, ${a.rect.y.toFixed(0)})\n` +
            (a.nearbyText ? `- **Nearby text**: ${a.nearbyText}\n` : "") +
            `- **Key styles**: ${Object.entries(a.computedStyles).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(", ")}` +
            (a.agentReply ? `\n- **Agent reply**: ${a.agentReply}` : "")
        )
        .join("\n\n");

      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "iterate_get_dom_context",
    "Get full DOM context for a specific annotation (selector, styles, rect)",
    {
      annotationId: z.string().describe("Annotation ID"),
    },
    async ({ annotationId }) => {
      const annotation = client
        .getAnnotations()
        .find((a) => a.id === annotationId);

      if (!annotation) {
        return {
          content: [
            {
              type: "text",
              text: `Annotation "${annotationId}" not found.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text:
              `# Annotation: ${annotation.comment}\n\n` +
              `**Element**: ${annotation.elementName || "(unknown)"}\n` +
              `**Path**: \`${annotation.elementPath || annotation.selector}\`\n` +
              `**Selector**: \`${annotation.selector}\`\n` +
              `**Iteration**: ${annotation.iteration}\n` +
              `**Status**: ${annotation.status}${annotation.intent ? ` | Intent: ${annotation.intent}` : ""}${annotation.severity ? ` | Severity: ${annotation.severity}` : ""}\n` +
              (annotation.nearbyText ? `**Nearby text**: ${annotation.nearbyText}\n` : "") +
              `\n## Bounding Rect\n\`\`\`json\n${JSON.stringify(annotation.rect, null, 2)}\n\`\`\`\n\n` +
              `## Computed Styles\n\`\`\`json\n${JSON.stringify(annotation.computedStyles, null, 2)}\n\`\`\``,
          },
        ],
      };
    }
  );

  // --- Annotation workflow tools ---

  server.tool(
    "iterate_acknowledge_annotation",
    "Acknowledge a pending annotation — tells the user you've seen it and are working on it",
    {
      annotationId: z.string().describe("Annotation ID to acknowledge"),
    },
    async ({ annotationId }) => {
      const result = await client.callApi(
        "POST",
        `/api/annotations/${annotationId}/acknowledge`
      );
      return {
        content: [
          { type: "text", text: `Acknowledged annotation "${annotationId}".` },
        ],
      };
    }
  );

  server.tool(
    "iterate_resolve_annotation",
    "Mark an annotation as resolved — the requested change has been made",
    {
      annotationId: z.string().describe("Annotation ID to resolve"),
      reply: z
        .string()
        .optional()
        .describe("Brief reply explaining what was done"),
    },
    async ({ annotationId, reply }) => {
      await client.callApi(
        "POST",
        `/api/annotations/${annotationId}/resolve`,
        reply ? { agentReply: reply } : undefined
      );
      return {
        content: [
          {
            type: "text",
            text: `Resolved annotation "${annotationId}".${reply ? ` Reply: ${reply}` : ""}`,
          },
        ],
      };
    }
  );

  server.tool(
    "iterate_dismiss_annotation",
    "Dismiss an annotation — the feedback was noted but won't be acted on",
    {
      annotationId: z.string().describe("Annotation ID to dismiss"),
      reply: z
        .string()
        .optional()
        .describe("Brief reason for dismissal"),
    },
    async ({ annotationId, reply }) => {
      await client.callApi(
        "POST",
        `/api/annotations/${annotationId}/dismiss`,
        reply ? { agentReply: reply } : undefined
      );
      return {
        content: [
          {
            type: "text",
            text: `Dismissed annotation "${annotationId}".${reply ? ` Reason: ${reply}` : ""}`,
          },
        ],
      };
    }
  );

  server.tool(
    "iterate_get_pending_annotations",
    "Get all pending annotations that need attention. Use this to check for new user feedback.",
    {},
    async () => {
      const annotations = client
        .getAnnotations()
        .filter((a) => a.status === "pending");

      if (annotations.length === 0) {
        return {
          content: [{ type: "text", text: "No pending annotations." }],
        };
      }

      const text = annotations
        .map(
          (a) =>
            `- **${a.elementName || a.selector}**: "${a.comment}"` +
            (a.intent ? ` [${a.intent}]` : "") +
            (a.severity ? ` (${a.severity})` : "") +
            ` — ID: ${a.id}`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: `${annotations.length} pending annotation(s):\n\n${text}`,
          },
        ],
      };
    }
  );

  server.tool(
    "iterate_wait_for_submit",
    "Wait for the user to click 'Submit to Agent' in the iterate overlay. " +
    "Blocks until the user submits their annotations, then returns the list. " +
    "Call this when you want to wait for the user to finish annotating.",
    {
      timeoutSeconds: z
        .number()
        .default(300)
        .describe("Max seconds to wait (default: 300)"),
    },
    async ({ timeoutSeconds }) => {
      try {
        const result = await client.waitForSubmit(timeoutSeconds * 1000);
        const annotations = client
          .getAnnotations()
          .filter((a) => result.annotationIds.includes(a.id));

        if (annotations.length === 0) {
          return {
            content: [{ type: "text", text: "Submit received but no pending annotations found." }],
          };
        }

        const text = annotations
          .map(
            (a) =>
              `## ${a.elementName || a.selector}: "${a.comment}"\n` +
              `- **ID**: ${a.id}\n` +
              `- **Intent**: ${a.intent ?? "none"} | **Severity**: ${a.severity ?? "none"}\n` +
              `- **Selector**: \`${a.selector}\`\n` +
              `- **Element path**: \`${a.elementPath || a.selector}\`\n` +
              (a.nearbyText ? `- **Nearby text**: ${a.nearbyText}\n` : "") +
              `- **Key styles**: ${Object.entries(a.computedStyles).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(", ")}`
          )
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text: `User submitted ${result.count} annotation(s):\n\n${text}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `No submit received: ${(err as Error).message}` },
          ],
        };
      }
    }
  );

  // --- Prompts (slash commands) ---

  server.prompt(
    "review",
    "Review pending annotations from the iterate overlay and apply the requested changes.",
    {},
    async () => {
      const annotations = client
        .getAnnotations()
        .filter((a) => a.status === "pending");

      if (annotations.length === 0) {
        return {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: "No pending annotations to review.",
              },
            },
          ],
        };
      }

      const summary = annotations
        .map(
          (a) =>
            `- **${a.elementName || a.selector}**: "${a.comment}" [${a.intent ?? "change"}] (ID: ${a.id})`
        )
        .join("\n");

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Review and apply these ${annotations.length} pending annotation(s) from the iterate overlay:\n\n` +
                `${summary}\n\n` +
                `For each annotation:\n` +
                `1. Call iterate_get_dom_context to understand what element it refers to\n` +
                `2. Call iterate_acknowledge_annotation so the user sees you're working on it\n` +
                `3. Find and edit the relevant source code to apply the requested change\n` +
                `4. Call iterate_resolve_annotation with a brief description of what you did`,
            },
          },
        ],
      };
    }
  );

  // Start the MCP server over stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("iterate MCP server error:", err);
  process.exit(1);
});
