import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DaemonClient } from "./connection/daemon-client.js";
import { formatBatchPrompt } from "@iterate/core";

const DAEMON_PORT = parseInt(process.env.ITERATE_DAEMON_PORT ?? "4000", 10);

/** Attempt to connect to the daemon with retries */
async function connectWithRetry(
  client: DaemonClient,
  maxAttempts: number = 10,
  baseDelay: number = 1000
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await client.connect();
      return;
    } catch {
      if (attempt === maxAttempts) {
        throw new Error(
          `Failed to connect to iterate daemon on port ${DAEMON_PORT} after ${maxAttempts} attempts. Is 'iterate serve' running?`
        );
      }
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), 15000);
      console.error(
        `[iterate-mcp] Connection attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms...`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function main() {
  // Connect to the iterate daemon (with retries)
  const client = new DaemonClient(DAEMON_PORT);

  try {
    await connectWithRetry(client);
  } catch (err) {
    console.error(`[iterate-mcp] ${(err as Error).message}`);
    process.exit(1);
  }

  // Wait for initial state (with timeout)
  try {
    await client.waitForState(15000);
  } catch {
    console.error(
      "[iterate-mcp] Warning: Timed out waiting for initial state from daemon. Continuing anyway..."
    );
  }

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
            `- **${it.name}** (branch: \`${it.branch}\`, port: ${it.port}, status: ${it.status})` +
            (it.commandPrompt ? `\n  Command: "${it.commandPrompt}"` : "") +
            (it.commandId ? ` [command: ${it.commandId}]` : "")
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
    "List all user annotations with selected elements, React component names, source file paths, intent, severity, and status. Each annotation may target multiple elements. Use status filter to find pending annotations that need attention.",
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
        .map((a) => {
          const headline = a.elements[0]
            ? (a.elements[0].componentName || a.elements[0].elementName || a.elements[0].selector)
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
            const styles = Object.entries(el.computedStyles).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(", ");
            if (styles) out += `    Styles: ${styles}\n`;
          }

          if (a.textSelection) {
            out += `- **Text selection**: "${a.textSelection.text.slice(0, 100)}${a.textSelection.text.length > 100 ? "…" : ""}"\n`;
          }

          if (a.agentReply) {
            out += `- **Agent reply**: ${a.agentReply}\n`;
          }

          return out;
        })
        .join("\n\n");

      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "iterate_get_dom_context",
    "Get full DOM context for a specific annotation, including all selected elements with React component names, source file paths, CSS selectors, computed styles, and layout information.",
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

      let text =
        `# Annotation: ${annotation.comment}\n\n` +
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
        text += `- **Offsets**: ${annotation.textSelection.startOffset}–${annotation.textSelection.endOffset}\n\n`;
      }

      // Include related DOM changes for this iteration
      const domChanges = client
        .getDomChanges()
        .filter((dc) => dc.iteration === annotation.iteration);
      if (domChanges.length > 0) {
        text += `## Related DOM Changes (${domChanges.length})\n\n`;
        for (const dc of domChanges) {
          const dcName = dc.componentName ? `<${dc.componentName}>` : dc.selector;
          const dcSource = dc.sourceLocation ? ` (${dc.sourceLocation})` : "";
          text += `- **${dc.type}** on ${dcName}${dcSource}: \`${dc.selector}\`\n`;
          text += `  Before: ${JSON.stringify(dc.before.rect)} → After: ${JSON.stringify(dc.after.rect)}\n`;
        }
      }

      return {
        content: [{ type: "text", text }],
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
      await client.callApi(
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
    "Get all pending annotations that need attention. Use this to check for new user feedback. Shows element names, React component names, and source file paths.",
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
        .map((a) => {
          const primary = a.elements[0];
          const name = primary
            ? (primary.componentName ? `<${primary.componentName}>` : primary.elementName || primary.selector)
            : "(no elements)";
          const source = primary?.sourceLocation ? ` (${primary.sourceLocation})` : "";
          const extraCount = a.elements.length > 1 ? ` +${a.elements.length - 1} more` : "";
          return (
            `- **${name}**${source}${extraCount}: "${a.comment}"` +
            (a.intent ? ` [${a.intent}]` : "") +
            (a.severity ? ` (${a.severity})` : "") +
            (a.textSelection ? ` — text: "${a.textSelection.text.slice(0, 40)}…"` : "") +
            ` — ID: ${a.id}`
          );
        })
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

  // --- Batch & command tools ---

  server.tool(
    "iterate_get_pending_batch",
    "Get all pending annotations and DOM changes from the latest submitted batch. This is the primary tool for reading user-submitted feedback after a batch:submitted notification. Returns annotations with full element context including React component names and source file paths, as well as DOM move/reorder changes with before/after positions.",
    {
      iteration: z
        .string()
        .optional()
        .describe("Filter by iteration name (optional, returns all if omitted)"),
    },
    async ({ iteration }) => {
      if (!client.connected && !client.getState()) {
        return {
          content: [{ type: "text", text: "Not connected to daemon — waiting for reconnection." }],
        };
      }

      let annotations = client.getAnnotations().filter((a) => a.status === "pending");
      let domChanges = client.getDomChanges();

      if (iteration) {
        annotations = annotations.filter((a) => a.iteration === iteration);
        domChanges = domChanges.filter((dc) => dc.iteration === iteration);
      }

      if (annotations.length === 0 && domChanges.length === 0) {
        return {
          content: [{ type: "text", text: "No pending batch items." }],
        };
      }

      let text = `# Pending Batch\n\n`;

      if (annotations.length > 0) {
        text += `## Annotations (${annotations.length})\n\n`;
        for (const a of annotations) {
          text += `### "${a.comment}"\n`;
          text += `- **ID**: ${a.id}\n`;
          text += `- **Iteration**: ${a.iteration}\n`;
          if (a.intent) text += `- **Intent**: ${a.intent}\n`;
          if (a.severity) text += `- **Severity**: ${a.severity}\n`;
          text += `- **Elements** (${a.elements.length}):\n`;

          for (const el of a.elements) {
            const name = el.componentName
              ? `<${el.componentName}>`
              : el.elementName || el.selector;
            const source = el.sourceLocation ? ` — \`${el.sourceLocation}\`` : "";
            text += `  - **${name}**${source}\n`;
            text += `    Selector: \`${el.selector}\`\n`;
            text += `    Path: \`${el.elementPath}\`\n`;
            text += `    Rect: ${el.rect.width.toFixed(0)}×${el.rect.height.toFixed(0)} at (${el.rect.x.toFixed(0)}, ${el.rect.y.toFixed(0)})\n`;
            if (el.nearbyText) text += `    Text: ${el.nearbyText}\n`;
            const styles = Object.entries(el.computedStyles)
              .slice(0, 6)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ");
            if (styles) text += `    Styles: ${styles}\n`;
          }

          if (a.textSelection) {
            text += `- **Text selection**: "${a.textSelection.text}"\n`;
            text += `  Container: \`${a.textSelection.containingElement.selector}\`\n`;
          }
          text += `\n`;
        }
      }

      if (domChanges.length > 0) {
        text += `## DOM Changes (${domChanges.length})\n\n`;
        for (const dc of domChanges) {
          const dcName = dc.componentName ? `<${dc.componentName}>` : dc.selector;
          const dcSource = dc.sourceLocation ? ` (${dc.sourceLocation})` : "";
          text += `- **${dc.type}** on ${dcName}${dcSource}\n`;
          text += `  Selector: \`${dc.selector}\`\n`;
          text += `  Before: ${JSON.stringify(dc.before.rect)}\n`;
          text += `  After: ${JSON.stringify(dc.after.rect)}\n`;
        }
      }

      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "iterate_get_command_context",
    "Get the context for the latest /iterate command — the user's prompt and the iteration names that were created. Use this to understand what to build in each worktree after a command:started notification.",
    {
      commandId: z
        .string()
        .optional()
        .describe("Specific command ID (optional, returns latest if omitted)"),
    },
    async ({ commandId }) => {
      try {
        const path = commandId
          ? `/api/command-context/${commandId}`
          : `/api/command-context`;
        const result = await client.callApi("GET", path) as {
          commandId?: string;
          prompt?: string;
          iterations?: string[];
          error?: string;
        };

        if (result.error || !result.commandId) {
          return {
            content: [
              {
                type: "text",
                text: result.error || "No command context found. No /iterate command has been run yet.",
              },
            ],
          };
        }

        const text =
          `# Command Context\n\n` +
          `**Command ID**: ${result.commandId}\n` +
          `**Prompt**: "${result.prompt}"\n` +
          `**Iterations** (${result.iterations?.length ?? 0}):\n` +
          (result.iterations || []).map((name: string) => `- ${name}`).join("\n") +
          `\n\nMake different code changes in each iteration to give the user variations to choose from.`;

        return { content: [{ type: "text", text }] };
      } catch {
        return {
          content: [
            {
              type: "text",
              text: "Failed to fetch command context. Is the daemon running?",
            },
          ],
        };
      }
    }
  );

  // --- Connection status tool ---

  server.tool(
    "iterate_connection_status",
    "Check the connection status to the iterate daemon. Useful for debugging when tools return stale data.",
    {},
    async () => {
      const connected = client.connected;
      const state = client.getState();
      const annotations = client.getAnnotations();
      const domChanges = client.getDomChanges();
      const iterations = Object.keys(client.getIterations());

      return {
        content: [
          {
            type: "text",
            text:
              `**Connected**: ${connected ? "yes" : "no (reconnecting...)"}\n` +
              `**State loaded**: ${state ? "yes" : "no"}\n` +
              `**Iterations**: ${iterations.length} (${iterations.join(", ") || "none"})\n` +
              `**Annotations**: ${annotations.length} (${annotations.filter((a) => a.status === "pending").length} pending)\n` +
              `**DOM Changes**: ${domChanges.length}`,
          },
        ],
      };
    }
  );

  // --- Prompt templates ---

  server.prompt(
    "iterate_process_feedback",
    "Get all pending UI feedback (annotations and DOM changes) formatted as an actionable prompt. Use this after the user submits a batch of feedback from the iterate overlay.",
    {
      iteration: z
        .string()
        .optional()
        .describe("Filter by iteration name (optional, returns all if omitted)"),
    },
    async ({ iteration }) => {
      let annotations = client.getAnnotations().filter((a) => a.status === "pending");
      let domChanges = client.getDomChanges();

      if (iteration) {
        annotations = annotations.filter((a) => a.iteration === iteration);
        domChanges = domChanges.filter((dc) => dc.iteration === iteration);
      }

      const text = formatBatchPrompt(annotations, domChanges, iteration);

      return {
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text },
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
  console.error("[iterate-mcp] Fatal error:", err);
  process.exit(1);
});
