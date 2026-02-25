import type {
  IterateState,
  AnnotationData,
  IterationInfo,
  ServerMessage,
} from "@iterate/core";
import { WebSocket } from "ws";

/**
 * Client that connects to the iterate daemon's WebSocket
 * and maintains a synchronized copy of the state.
 */
export class DaemonClient {
  private ws: WebSocket | null = null;
  private state: IterateState | null = null;
  private daemonUrl: string;
  private stateListeners: Set<() => void> = new Set();

  constructor(daemonPort: number = 4000) {
    this.daemonUrl = `ws://127.0.0.1:${daemonPort}/ws`;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.daemonUrl);

      this.ws.on("open", () => {
        resolve();
      });

      this.ws.on("message", (data) => {
        try {
          const msg: ServerMessage = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch {
          // Ignore malformed messages
        }
      });

      this.ws.on("error", (err) => {
        reject(err);
      });

      this.ws.on("close", () => {
        this.state = null;
      });
    });
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  getState(): IterateState | null {
    return this.state;
  }

  getAnnotations(): AnnotationData[] {
    return this.state?.annotations ?? [];
  }

  getIterations(): Record<string, IterationInfo> {
    return this.state?.iterations ?? {};
  }

  /** Wait for state to be available */
  async waitForState(): Promise<IterateState> {
    if (this.state) return this.state;
    return new Promise((resolve) => {
      const listener = () => {
        if (this.state) {
          this.stateListeners.delete(listener);
          resolve(this.state);
        }
      };
      this.stateListeners.add(listener);
    });
  }

  /** Call the daemon REST API */
  async callApi(
    method: string,
    path: string,
    body?: unknown
  ): Promise<unknown> {
    const port = new URL(this.daemonUrl).port || "4000";
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "state:sync":
        this.state = msg.payload;
        break;
      case "annotation:created":
        this.state?.annotations.push(msg.payload);
        break;
      case "annotation:updated":
        if (this.state) {
          const idx = this.state.annotations.findIndex(
            (a) => a.id === msg.payload.id
          );
          if (idx !== -1) {
            this.state.annotations[idx] = msg.payload;
          }
        }
        break;
      case "annotation:deleted":
        if (this.state) {
          this.state.annotations = this.state.annotations.filter(
            (a) => a.id !== msg.payload.id
          );
        }
        break;
      case "iteration:created":
        if (this.state) {
          this.state.iterations[msg.payload.name] = msg.payload;
        }
        break;
      case "iteration:removed":
        if (this.state) {
          delete this.state.iterations[msg.payload.name];
        }
        break;
      case "iteration:status":
        if (this.state && this.state.iterations[msg.payload.name]) {
          this.state.iterations[msg.payload.name]!.status = msg.payload.status;
        }
        break;
      case "batch:submitted":
        // Batch was processed — annotations are already in state via annotation:created events
        // This is a notification that a batch has been submitted
        break;
      case "command:started":
        // A /iterate command was executed — iterations will arrive via iteration:created events
        // Store the command context for retrieval via iterate_get_command_context
        if (this.state) {
          for (const iterName of msg.payload.iterations) {
            if (this.state.iterations[iterName]) {
              this.state.iterations[iterName]!.commandPrompt = msg.payload.prompt;
              this.state.iterations[iterName]!.commandId = msg.payload.commandId;
            }
          }
        }
        break;
    }

    for (const listener of this.stateListeners) {
      listener();
    }
  }
}
