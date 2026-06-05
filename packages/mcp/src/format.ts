import type { IterationInfo } from "iterate-ui-core";

/**
 * Format an iteration list for the `iterate_list_iterations` MCP tool.
 *
 * Returns a markdown-ish string the agent reads. Includes appName when
 * present so multi-app repos are legible, but stays compact for the
 * single-app case.
 */
export function formatIterationList(iterations: IterationInfo[]): string {
  if (iterations.length === 0) return "No active iterations.";
  return iterations
    .map((it) => {
      const app = it.appName ? `, app: ${it.appName}` : "";
      const commandLine = it.commandPrompt ? `\n  Command: "${it.commandPrompt}"` : "";
      const commandId = it.commandId ? ` [command: ${it.commandId}]` : "";
      return (
        `- **${it.name}** (branch: \`${it.branch}\`${app}, port: ${it.port}, status: ${it.status})` +
        commandLine +
        commandId
      );
    })
    .join("\n");
}
