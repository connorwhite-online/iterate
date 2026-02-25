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
    "List all user annotations with CSS selectors, positions, styles, and comments",
    {
      iteration: z
        .string()
        .optional()
        .describe("Filter by iteration name"),
    },
    async ({ iteration }) => {
      let annotations = client.getAnnotations();
      if (iteration) {
        annotations = annotations.filter((a) => a.iteration === iteration);
      }

      if (annotations.length === 0) {
        return {
          content: [{ type: "text", text: "No annotations found." }],
        };
      }

      const text = annotations
        .map(
          (a) =>
            `## ${a.comment}\n` +
            `- Iteration: ${a.iteration}\n` +
            `- Selector: \`${a.selector}\`\n` +
            `- Rect: ${a.rect.width.toFixed(0)}x${a.rect.height.toFixed(0)} at (${a.rect.x.toFixed(0)}, ${a.rect.y.toFixed(0)})\n` +
            `- Key styles: ${Object.entries(a.computedStyles).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(", ")}`
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
              `**Selector**: \`${annotation.selector}\`\n` +
              `**Iteration**: ${annotation.iteration}\n\n` +
              `## Bounding Rect\n\`\`\`json\n${JSON.stringify(annotation.rect, null, 2)}\n\`\`\`\n\n` +
              `## Computed Styles\n\`\`\`json\n${JSON.stringify(annotation.computedStyles, null, 2)}\n\`\`\``,
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
