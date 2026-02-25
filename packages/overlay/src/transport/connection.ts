import type {
  ClientMessage,
  ServerMessage,
  IterateState,
} from "@iterate/core";

type MessageHandler = (msg: ServerMessage) => void;

/**
 * WebSocket connection to the iterate daemon.
 * Handles reconnection and message dispatch.
 */
export class DaemonConnection {
  private ws: WebSocket | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private url: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(url?: string) {
    this.url = url ?? `ws://${window.location.host}/ws`;
  }

  connect(): void {
    this.ws = new WebSocket(this.url);

    this.ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
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

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
