import type {
  IterateState,
  Change,
  IterationInfo,
  DomChange,
  ServerMessage,
} from "iterate-ui-core";
import { WebSocket } from "ws";

/** Callback fired whenever a batch:submitted notification arrives */
export type BatchSubmittedHandler = (payload: {
  batchId: string;
  changeCount: number;
  domChangeCount: number;
}) => void;

/**
 * Client that connects to the iterate daemon's WebSocket
 * and maintains a synchronized copy of the state.
 *
 * Features:
 * - Tracks all state: iterations, changes, AND dom changes
 * - Automatic reconnection with exponential backoff
 * - Batch-submitted event listeners for proactive MCP notifications
 */
export class DaemonClient {
  private ws: WebSocket | null = null;
  private state: IterateState | null = null;
  private daemonUrl: string;
  private stateListeners: Set<() => void> = new Set();
  private batchListeners: Set<BatchSubmittedHandler> = new Set();

  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = Infinity;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(daemonPort: number = 4000) {
    this.daemonUrl = `ws://127.0.0.1:${daemonPort}/ws`;
  }

  async connect(): Promise<void> {
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    return this.doConnect();
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.daemonUrl);
      this.ws = ws;
      let resolved = false;

      ws.on("open", () => {
        resolved = true;
        this.reconnectAttempts = 0;
        resolve();
      });

      ws.on("message", (data) => {
        try {
          const msg: ServerMessage = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch {
          // Ignore malformed messages
        }
      });

      ws.on("error", (err) => {
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      ws.on("close", () => {
        // Don't null state on close — keep the last known state
        // so MCP tools can still return cached data
        this.ws = null;
        this.scheduleReconnect();
      });
    });
  }

  /** Schedule a reconnection attempt with exponential backoff */
  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.doConnect();
      } catch {
        // doConnect rejection means we couldn't connect — backoff handled by close event
      }
    }, delay);
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  /** Whether the WebSocket is currently connected */
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getState(): IterateState | null {
    return this.state;
  }

  getChanges(): Change[] {
    return this.state?.changes ?? [];
  }

  getIterations(): Record<string, IterationInfo> {
    return this.state?.iterations ?? {};
  }

  getDomChanges(): DomChange[] {
    return this.state?.domChanges ?? [];
  }

  /** Subscribe to batch:submitted events */
  onBatchSubmitted(handler: BatchSubmittedHandler): () => void {
    this.batchListeners.add(handler);
    return () => this.batchListeners.delete(handler);
  }

  /** Wait for state to be available */
  async waitForState(timeoutMs: number = 10000): Promise<IterateState> {
    if (this.state) return this.state;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.stateListeners.delete(listener);
        reject(new Error("Timeout waiting for daemon state"));
      }, timeoutMs);

      const listener = () => {
        if (this.state) {
          clearTimeout(timer);
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
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "state:sync":
        this.state = msg.payload;
        break;

      // --- Changes ---
      case "change:created":
        this.state?.changes.push(msg.payload);
        break;
      case "change:updated":
        if (this.state) {
          const idx = this.state.changes.findIndex(
            (a) => a.id === msg.payload.id
          );
          if (idx !== -1) {
            this.state.changes[idx] = msg.payload;
          }
        }
        break;
      case "change:deleted":
        if (this.state) {
          this.state.changes = this.state.changes.filter(
            (a) => a.id !== msg.payload.id
          );
        }
        break;

      // --- DOM Changes ---
      case "dom:changed":
        if (this.state) {
          this.state.domChanges.push(msg.payload);
        }
        break;
      case "dom:deleted":
        if (this.state) {
          this.state.domChanges = this.state.domChanges.filter(
            (dc) => dc.id !== msg.payload.id
          );
        }
        break;

      // --- Iterations ---
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

      // --- Batch submitted ---
      case "batch:submitted":
        // Changes and dom changes already arrived via their own events.
        // Notify listeners that a batch was finalized.
        for (const handler of this.batchListeners) {
          handler(msg.payload);
        }
        break;

      // --- Commands ---
      case "command:started":
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
