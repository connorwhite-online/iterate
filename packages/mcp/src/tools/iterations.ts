import type { DaemonClient } from "../connection/daemon-client.js";

/**
 * MCP tool definitions for managing iterations.
 */
export function getIterationTools(client: DaemonClient) {
  return [
    {
      name: "iterate_list_iterations",
      description:
        "List all active iterate iterations. Each iteration is a git worktree with its own branch and dev server.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
      handler: async () => {
        const iterations = client.getIterations();
        const entries = Object.values(iterations);

        if (entries.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No active iterations. Use iterate_create_iteration to create one.",
              },
            ],
          };
        }

        const text = entries
          .map(
            (it) =>
              `- **${it.name}** (branch: ${it.branch}, port: ${it.port}, status: ${it.status})`
          )
          .join("\n");

        return {
          content: [{ type: "text" as const, text }],
        };
      },
    },
    {
      name: "iterate_create_iteration",
      description:
        "Create a new iteration. This creates a git worktree, installs dependencies, and starts a dev server.",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Name for the new iteration",
          },
          baseBranch: {
            type: "string",
            description: "Branch to fork from (optional, defaults to current)",
          },
        },
        required: ["name"],
      },
      handler: async (args: { name: string; baseBranch?: string }) => {
        const result = await client.callApi("POST", "/api/iterations", {
          name: args.name,
          baseBranch: args.baseBranch,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Created iteration "${args.name}":\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      },
    },
    {
      name: "iterate_pick_iteration",
      description:
        "Pick a winning iteration. Merges its branch into the base branch and removes all other iterations.",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Name of the iteration to keep",
          },
          strategy: {
            type: "string",
            enum: ["merge", "squash", "rebase"],
            description: "Merge strategy (default: merge)",
          },
        },
        required: ["name"],
      },
      handler: async (args: { name: string; strategy?: string }) => {
        const result = await client.callApi("POST", "/api/iterations/pick", {
          name: args.name,
          strategy: args.strategy ?? "merge",
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Picked iteration "${args.name}". Branch merged to base, other iterations removed.`,
            },
          ],
        };
      },
    },
    {
      name: "iterate_remove_iteration",
      description: "Remove a specific iteration (worktree and dev server).",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Name of the iteration to remove",
          },
        },
        required: ["name"],
      },
      handler: async (args: { name: string }) => {
        await client.callApi("DELETE", `/api/iterations/${args.name}`);
        return {
          content: [
            {
              type: "text" as const,
              text: `Removed iteration "${args.name}".`,
            },
          ],
        };
      },
    },
  ];
}
