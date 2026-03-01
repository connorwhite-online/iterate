import type {
  ClientMessage,
  ServerMessage,
  IterateState,
} from "@iterate/core";
import type { IterationInfo } from "@iterate/core";

type MessageHandler = (msg: ServerMessage) => void;
type IterationsChangeHandler = (iterations: Record<string, IterationInfo>) => void;
type ToolModeHandler = (mode: string) => void;

/**
 * WebSocket connection to the iterate daemon.
 * Handles reconnection, message dispatch, and iteration state tracking.
 */
export class DaemonConnection {
  private ws: WebSocket | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private iterationsHandlers: Set<IterationsChangeHandler> = new Set();
  private toolModeHandlers: Set<ToolModeHandler> = new Set();
  private url: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _iterations: Record<string, IterationInfo> = {};

  constructor(url?: string) {
    this.url = url ?? `ws://${window.location.host}/ws`;
  }

  connect(): void {
    this.ws = new WebSocket(this.url);

    this.ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        this.trackIterations(msg);
        this.trackToolMode(msg);
        for (const handler of this.handlers) {
          handler(msg);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      // Attempt reconnection after 2 seconds
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Subscribe to iteration list changes */
  onIterationsChange(handler: IterationsChangeHandler): () => void {
    this.iterationsHandlers.add(handler);
    return () => this.iterationsHandlers.delete(handler);
  }

  /** Current iterations snapshot */
  get iterations(): Record<string, IterationInfo> {
    return this._iterations;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Send a tool mode change to the daemon for relay to all clients */
  sendToolMode(mode: string): void {
    this.send({ type: "tool:set-mode", payload: { mode } });
  }

  /** Subscribe to tool mode changes relayed from other clients */
  onToolModeChange(handler: ToolModeHandler): () => void {
    this.toolModeHandlers.add(handler);
    return () => this.toolModeHandlers.delete(handler);
  }

  /** Dispatch tool mode changes from server messages */
  private trackToolMode(msg: ServerMessage): void {
    if (msg.type === "tool:mode-changed") {
      for (const handler of this.toolModeHandlers) {
        handler(msg.payload.mode);
      }
    }
  }

  /** Update internal iterations state from server messages */
  private trackIterations(msg: ServerMessage): void {
    let changed = false;

    switch (msg.type) {
      case "state:sync":
        this._iterations = { ...msg.payload.iterations };
        changed = true;
        break;
      case "iteration:created":
        this._iterations = { ...this._iterations, [msg.payload.name]: msg.payload };
        changed = true;
        break;
      case "iteration:status":
        if (this._iterations[msg.payload.name]) {
          this._iterations = {
            ...this._iterations,
            [msg.payload.name]: {
              ...this._iterations[msg.payload.name],
              status: msg.payload.status,
            },
          };
          changed = true;
        }
        break;
      case "iteration:removed":
        if (this._iterations[msg.payload.name]) {
          const { [msg.payload.name]: _, ...rest } = this._iterations;
          this._iterations = rest;
          changed = true;
        }
        break;
    }

    if (changed) {
      for (const handler of this.iterationsHandlers) {
        handler(this._iterations);
      }
    }
  }
}
