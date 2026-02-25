import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { branchCommand } from "./commands/branch.js";
import { listCommand } from "./commands/list.js";
import { pickCommand } from "./commands/pick.js";
import { serveCommand } from "./commands/serve.js";
import { stopCommand } from "./commands/stop.js";

const program = new Command();

program
  .name("iterate")
  .description(
    "Figma-like canvas tool for live web projects, powered by git worktrees"
  )
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(branchCommand);
program.addCommand(listCommand);
program.addCommand(pickCommand);
program.addCommand(serveCommand);
program.addCommand(stopCommand);

program.parse();
