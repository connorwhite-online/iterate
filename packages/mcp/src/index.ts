import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DaemonClient } from "./connection/daemon-client.js";
import { formatBatchPrompt } from "iterate-ui-core";
import { formatIterationList } from "./format.js";
import { loadConfig, resolveDaemonPort } from "iterate-ui-core/node";

const CWD = process.env.ITERATE_CWD ?? process.cwd();
// Resolution order: explicit env var → lockfile → config → default.
const DAEMON_PORT = (() => {
  if (process.env.ITERATE_DAEMON_PORT) {
    const parsed = parseInt(process.env.ITERATE_DAEMON_PORT, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  try {
    const config = loadConfig(CWD);
    return resolveDaemonPort(CWD, config);
  } catch {
    return 47100;
  }
})();

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
      const text = formatIterationList(Object.values(client.getIterations()));
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "iterate_create_iteration",
    "Create a new iteration (git worktree + dev server). In multi-app repos, pass appName to pick which registered app this iteration targets.",
    {
      name: z.string().describe("Name for the new iteration"),
      baseBranch: z
        .string()
        .optional()
        .describe("Branch to fork from (defaults to current)"),
      appName: z
        .string()
        .optional()
        .describe("Registered app (from .iterate/config.json apps[]) this iteration targets. Required when multiple apps are configured."),
    },
    async ({ name, baseBranch, appName }) => {
      const result = await client.callApi("POST", "/api/iterations", {
        name,
        baseBranch,
        appName,
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

  // --- Change tools ---

  server.tool(
    "iterate_list_changes",
    "List all user-submitted changes with selected elements, React component names, source file paths, and status. Each change may target multiple elements. Use status filter to find queued changes that need attention.",
    {
      iteration: z
        .string()
        .optional()
        .describe("Filter by iteration name"),
      status: z
        .enum(["queued", "in-progress", "implemented"])
        .optional()
        .describe("Filter by status (default: all)"),
    },
    async ({ iteration, status }) => {
      let changes = client.getChanges();
      if (iteration) {
        changes = changes.filter((a) => a.iteration === iteration);
      }
      if (status) {
        changes = changes.filter((a) => a.status === status);
      }

      if (changes.length === 0) {
        return {
          content: [{ type: "text", text: "No changes found." }],
        };
      }

      const text = changes
        .map((a) => {
          const headline = a.elements[0]
            ? (a.elements[0].componentName || a.elements[0].elementName || a.elements[0].selector)
            : "(no elements)";
          let out =
            `## ${headline}: "${a.comment}"\n` +
            `- **ID**: ${a.id}\n` +
            `- **Status**: ${a.status}\n` +
            `- **Iteration**: ${a.iteration}\n` +
            (a.url ? `- **Page**: ${a.url}\n` : "") +
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

          if (a.drawing) {
            out += `- **Drawing annotation** (marker tool)\n`;
            out += `  Region: ${a.drawing.bounds.width.toFixed(0)}×${a.drawing.bounds.height.toFixed(0)} at (${a.drawing.bounds.x.toFixed(0)}, ${a.drawing.bounds.y.toFixed(0)})\n`;
            out += `  SVG path: \`${a.drawing.path}\`\n`;
          }

          if (a.agentSummary) {
            out += `- **Agent summary**: ${a.agentSummary}\n`;
          }

          return out;
        })
        .join("\n\n");

      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "iterate_get_dom_context",
    "Get full DOM context for a specific change, including all selected elements with React component names, source file paths, CSS selectors, computed styles, and layout information.",
    {
      annotationId: z.string().describe("Change ID"),
    },
    async ({ annotationId }) => {
      const change = client
        .getChanges()
        .find((a) => a.id === annotationId);

      if (!change) {
        return {
          content: [
            {
              type: "text",
              text: `Change "${annotationId}" not found.`,
            },
          ],
        };
      }

      let text =
        `# Change: ${change.comment}\n\n` +
        `**Iteration**: ${change.iteration}\n` +
        `**Status**: ${change.status}\n` +
        (change.url ? `**Page**: ${change.url}\n` : "") +
        `\n`;

      text += `## Selected Elements (${change.elements.length})\n\n`;
      for (const el of change.elements) {
        const name = el.componentName ? `<${el.componentName}>` : el.elementName;
        const source = el.sourceLocation ? ` — \`${el.sourceLocation}\`` : "";
        text += `### ${name || el.selector}${source}\n`;
        text += `- **Selector**: \`${el.selector}\`\n`;
        text += `- **DOM path**: \`${el.elementPath}\`\n`;
        text += `- **Bounding rect**:\n\`\`\`json\n${JSON.stringify(el.rect, null, 2)}\n\`\`\`\n`;
        if (el.nearbyText) text += `- **Nearby text**: ${el.nearbyText}\n`;
        text += `- **Computed styles**:\n\`\`\`json\n${JSON.stringify(el.computedStyles, null, 2)}\n\`\`\`\n\n`;
      }

      if (change.textSelection) {
        text += `## Text Selection\n`;
        text += `- **Selected text**: "${change.textSelection.text}"\n`;
        text += `- **Containing element**: \`${change.textSelection.containingElement.selector}\`\n`;
        text += `- **Offsets**: ${change.textSelection.startOffset}–${change.textSelection.endOffset}\n\n`;
      }

      if (change.drawing) {
        text += `## Drawing Annotation\n`;
        text += `- **Region**: ${change.drawing.bounds.width.toFixed(0)}×${change.drawing.bounds.height.toFixed(0)} at (${change.drawing.bounds.x.toFixed(0)}, ${change.drawing.bounds.y.toFixed(0)})\n`;
        text += `- **SVG path**: \`${change.drawing.path}\`\n`;
        text += `- **Stroke**: ${change.drawing.strokeColor}, width ${change.drawing.strokeWidth}\n\n`;
      }

      // Include related DOM changes for this iteration
      const domChanges = client
        .getDomChanges()
        .filter((dc) => dc.iteration === change.iteration);
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

  // --- Change workflow tools ---

  server.tool(
    "iterate_start_change",
    "Mark a change as in-progress — tells the user you've seen it and are working on it",
    {
      annotationId: z.string().describe("Change ID to start"),
    },
    async ({ annotationId }) => {
      await client.callApi(
        "PATCH",
        `/api/changes/${annotationId}/start`
      );
      return {
        content: [
          { type: "text", text: `Started change "${annotationId}".` },
        ],
      };
    }
  );

  server.tool(
    "iterate_implement_change",
    "Mark a change as implemented — the requested change has been made",
    {
      annotationId: z.string().describe("Change ID to implement"),
      reply: z
        .string()
        .optional()
        .describe("Brief reply explaining what was done"),
    },
    async ({ annotationId, reply }) => {
      await client.callApi(
        "PATCH",
        `/api/changes/${annotationId}/implement`,
        reply ? { summary: reply } : undefined
      );
      return {
        content: [
          {
            type: "text",
            text: `Implemented change "${annotationId}".${reply ? ` Summary: ${reply}` : ""}`,
          },
        ],
      };
    }
  );

  server.tool(
    "iterate_implement_dom_change",
    "Mark a DOM change (move/reorder) as implemented — removes it from the pending list",
    {
      id: z.string().describe("DOM change ID to resolve"),
      reply: z
        .string()
        .optional()
        .describe("Brief reply explaining what was done"),
    },
    async ({ id, reply }) => {
      await client.callApi("DELETE", `/api/dom-changes/${id}`);
      return {
        content: [
          {
            type: "text",
            text: `Implemented DOM change "${id}".${reply ? ` Summary: ${reply}` : ""}`,
          },
        ],
      };
    }
  );

  server.tool(
    "iterate_get_pending_changes",
    "Get all queued changes that need attention. Use this to check for new user feedback. Shows element names, React component names, source file paths, as well as DOM move/reorder changes.",
    {},
    async () => {
      const changes = client
        .getChanges()
        .filter((a) => a.status === "queued");
      const domChanges = client.getDomChanges();

      if (changes.length === 0 && domChanges.length === 0) {
        return {
          content: [{ type: "text", text: "No queued changes." }],
        };
      }

      let text = "";

      if (changes.length > 0) {
        text += changes
          .map((a) => {
            const primary = a.elements[0];
            const name = primary
              ? (primary.componentName ? `<${primary.componentName}>` : primary.elementName || primary.selector)
              : "(no elements)";
            const source = primary?.sourceLocation ? ` (${primary.sourceLocation})` : "";
            const extraCount = a.elements.length > 1 ? ` +${a.elements.length - 1} more` : "";
            return (
              `- **${name}**${source}${extraCount}: "${a.comment}"` +
              (a.url ? ` — page: ${a.url}` : "") +
              (a.textSelection ? ` — text: "${a.textSelection.text.slice(0, 40)}…"` : "") +
              (a.drawing ? ` — drawing: ${a.drawing.bounds.width.toFixed(0)}×${a.drawing.bounds.height.toFixed(0)} at (${a.drawing.bounds.x.toFixed(0)}, ${a.drawing.bounds.y.toFixed(0)})` : "") +
              ` — ID: ${a.id}`
            );
          })
          .join("\n");
      }

      if (domChanges.length > 0) {
        if (text) text += "\n\n";
        text += domChanges
          .map((dc) => {
            const dcName = dc.componentName ? `<${dc.componentName}>` : dc.selector;
            const dcSource = dc.sourceLocation ? ` (${dc.sourceLocation})` : "";
            const isCrossParent = dc.targetParentSelector && dc.targetParentSelector !== dc.parentSelector;
            const label = isCrossParent ? "reparent" : dc.type;
            let line = `- **${label}** on ${dcName}${dcSource}`;
            if (dc.type === "reorder" && dc.before.siblingIndex !== undefined) {
              if (isCrossParent) {
                line += ` — from \`${dc.parentSelector}\` to \`${dc.targetParentSelector}\``;
              } else {
                line += ` — index ${dc.before.siblingIndex} → ${dc.after.siblingIndex}`;
              }
            } else if (dc.type === "move") {
              line += ` — (${Math.round(dc.before.rect.x)},${Math.round(dc.before.rect.y)}) → (${Math.round(dc.after.rect.x)},${Math.round(dc.after.rect.y)})`;
            }
            line += ` — ID: ${dc.id}`;
            return line;
          })
          .join("\n");
      }

      const total = changes.length + domChanges.length;
      return {
        content: [
          {
            type: "text",
            text: `${total} pending item(s):\n\n${text}`,
          },
        ],
      };
    }
  );

  // --- Batch & command tools ---

  server.tool(
    "iterate_get_pending_batch",
    "Get all queued changes and DOM changes from the latest submitted batch. This is the primary tool for reading user-submitted feedback after a batch:submitted notification. Returns changes with full element context including React component names and source file paths, as well as DOM move/reorder changes with before/after positions.",
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

      let changes = client.getChanges().filter((a) => a.status === "queued");
      let domChanges = client.getDomChanges();

      if (iteration) {
        changes = changes.filter((a) => a.iteration === iteration);
        domChanges = domChanges.filter((dc) => dc.iteration === iteration);
      }

      if (changes.length === 0 && domChanges.length === 0) {
        return {
          content: [{ type: "text", text: "No pending batch items." }],
        };
      }

      let text = `# Pending Batch\n\n`;

      if (changes.length > 0) {
        text += `## Changes (${changes.length})\n\n`;
        for (const a of changes) {
          text += `### "${a.comment}"\n`;
          text += `- **ID**: ${a.id}\n`;
          text += `- **Iteration**: ${a.iteration}\n`;
          if (a.url) text += `- **Page**: ${a.url}\n`;
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

          if (a.drawing) {
            text += `- **Drawing annotation** (marker tool)\n`;
            text += `  Region: ${a.drawing.bounds.width.toFixed(0)}×${a.drawing.bounds.height.toFixed(0)} at (${a.drawing.bounds.x.toFixed(0)}, ${a.drawing.bounds.y.toFixed(0)})\n`;
            text += `  SVG path: \`${a.drawing.path}\`\n`;
            text += `  Stroke: ${a.drawing.strokeColor}, width ${a.drawing.strokeWidth}\n`;
          }
          text += `\n`;
        }
      }

      if (domChanges.length > 0) {
        text += `## DOM Changes (${domChanges.length})\n\n`;
        for (const dc of domChanges) {
          const dcName = dc.componentName ? `<${dc.componentName}>` : dc.selector;
          const dcSource = dc.sourceLocation ? ` (${dc.sourceLocation})` : "";
          const isCrossParent = dc.targetParentSelector && dc.targetParentSelector !== dc.parentSelector;
          const label = isCrossParent ? "reparent" : dc.type;
          text += `- **${label}** on ${dcName}${dcSource}\n`;
          text += `  ID: ${dc.id}\n`;
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
            text += `  Before: ${JSON.stringify(dc.before.rect)}\n`;
            text += `  After: ${JSON.stringify(dc.after.rect)}\n`;
          }
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
      const changes = client.getChanges();
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
              `**Changes**: ${changes.length} (${changes.filter((a) => a.status === "queued").length} queued)\n` +
              `**DOM Changes**: ${domChanges.length}`,
          },
        ],
      };
    }
  );

  // --- Prompt templates ---

  server.prompt(
    "iterate_process_feedback",
    "Get all pending UI feedback (changes and DOM changes) formatted as an actionable prompt. Use this after the user submits a batch of feedback from the iterate overlay.",
    {
      iteration: z
        .string()
        .optional()
        .describe("Filter by iteration name (optional, returns all if omitted)"),
    },
    async ({ iteration }) => {
      let changes = client.getChanges().filter((a) => a.status === "queued");
      let domChanges = client.getDomChanges();

      if (iteration) {
        changes = changes.filter((a) => a.iteration === iteration);
        domChanges = domChanges.filter((dc) => dc.iteration === iteration);
      }

      const text = formatBatchPrompt(changes, domChanges, iteration);

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
