import type {
  IterateState,
  IterateConfig,
  IterationInfo,
  Change,
  ChangeStatus,
  DomChange,
} from "iterate-ui-core";

/** Command context for /iterate slash commands */
export interface CommandContext {
  commandId: string;
  prompt: string;
  iterations: string[];
  createdAt: number;
}

/** In-memory state store for the daemon */
export class StateStore {
  private state: IterateState;
  private commands: Map<string, CommandContext> = new Map();

  constructor(config: IterateConfig) {
    this.state = {
      config,
      iterations: {},
      changes: [],
      domChanges: [],
    };
  }

  getState(): IterateState {
    return this.state;
  }

  getConfig(): IterateConfig {
    return this.state.config;
  }

  // --- Iterations ---

  getIterations(): Record<string, IterationInfo> {
    return this.state.iterations;
  }

  getIteration(name: string): IterationInfo | undefined {
    return this.state.iterations[name];
  }

  setIteration(name: string, info: IterationInfo): void {
    this.state.iterations[name] = info;
  }

  removeIteration(name: string): void {
    delete this.state.iterations[name];
  }

  // --- Changes ---

  getChanges(): Change[] {
    return this.state.changes;
  }

  getChange(id: string): Change | undefined {
    return this.state.changes.find((a) => a.id === id);
  }

  getPendingChanges(): Change[] {
    return this.state.changes.filter((a) => a.status === "queued");
  }

  addChange(change: Change): void {
    this.state.changes.push(change);
  }

  updateChange(id: string, updates: Partial<Change>): Change | null {
    const change = this.state.changes.find((a) => a.id === id);
    if (!change) return null;
    Object.assign(change, updates);
    return change;
  }

  removeChange(id: string): boolean {
    const idx = this.state.changes.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    this.state.changes.splice(idx, 1);
    return true;
  }

  // --- DOM Changes ---

  getDomChanges(): DomChange[] {
    return this.state.domChanges;
  }

  addDomChange(change: DomChange): void {
    this.state.domChanges.push(change);
  }

  removeDomChange(id: string): boolean {
    const idx = this.state.domChanges.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    this.state.domChanges.splice(idx, 1);
    return true;
  }

  clearDomChanges(): void {
    this.state.domChanges = [];
  }

  /** Remove all changes and DOM changes belonging to an iteration */
  removeIterationData(iteration: string): { changeIds: string[]; domChangeIds: string[] } {
    const changeIds = this.state.changes
      .filter((a) => a.iteration === iteration)
      .map((a) => a.id);
    const domChangeIds = this.state.domChanges
      .filter((c) => c.iteration === iteration)
      .map((c) => c.id);

    this.state.changes = this.state.changes.filter((a) => a.iteration !== iteration);
    this.state.domChanges = this.state.domChanges.filter((c) => c.iteration !== iteration);

    return { changeIds, domChangeIds };
  }

  // --- Commands ---

  setCommandContext(commandId: string, prompt: string, iterations: string[]): void {
    this.commands.set(commandId, {
      commandId,
      prompt,
      iterations,
      createdAt: Date.now(),
    });
  }

  getCommandContext(commandId: string): CommandContext | undefined {
    return this.commands.get(commandId);
  }

  getLatestCommand(): CommandContext | undefined {
    let latest: CommandContext | undefined;
    for (const cmd of this.commands.values()) {
      if (!latest || cmd.createdAt > latest.createdAt) {
        latest = cmd;
      }
    }
    return latest;
  }

  getAllCommands(): CommandContext[] {
    return Array.from(this.commands.values());
  }
}
