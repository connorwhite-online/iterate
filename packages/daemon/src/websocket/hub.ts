import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import type {
  ClientMessage,
  ServerMessage,
  AnnotationData,
} from "@iterate/core";
import type { StateStore } from "../state/store.js";

/**
 * WebSocket hub for real-time communication between the browser overlay and daemon.
 */
export class WebSocketHub {
  private clients: Set<WebSocket> = new Set();
  private store: StateStore;

  constructor(store: StateStore) {
    this.store = store;
  }

  /** Register the WebSocket route on the Fastify server */
  register(app: FastifyInstance): void {
    app.get("/ws", { websocket: true }, (socket) => {
      this.clients.add(socket);

      // Send initial state sync
      this.send(socket, {
        type: "state:sync",
        payload: this.store.getState(),
      });

      socket.on("message", (data) => {
        try {
          const msg: ClientMessage = JSON.parse(data.toString());
          this.handleMessage(msg, socket);
        } catch {
          this.send(socket, {
            type: "error",
            payload: { message: "Invalid message format" },
          });
        }
      });

      socket.on("close", () => {
        this.clients.delete(socket);
      });
    });
  }

  /** Broadcast a message to all connected clients */
  broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(data);
      }
    }
  }

  /** Send a message to a specific client */
  private send(socket: WebSocket, msg: ServerMessage): void {
    if (socket.readyState === 1) {
      socket.send(JSON.stringify(msg));
    }
  }

  /** Handle incoming messages from the browser overlay */
  private handleMessage(msg: ClientMessage, _socket: WebSocket): void {
    switch (msg.type) {
      case "annotation:create": {
        const annotation: AnnotationData = {
          ...msg.payload,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
        };
        this.store.addAnnotation(annotation);
        this.broadcast({ type: "annotation:created", payload: annotation });
        break;
      }

      case "annotation:delete": {
        const removed = this.store.removeAnnotation(msg.payload.id);
        if (removed) {
          this.broadcast({
            type: "annotation:deleted",
            payload: { id: msg.payload.id },
          });
        }
        break;
      }

      case "dom:select":
      case "dom:move":
      case "dom:reorder":
      case "dom:resize": {
        // Store DOM changes and broadcast to all clients
        // Full implementation in Phase 2
        break;
      }

      case "iteration:switch":
      case "iteration:compare": {
        // These are handled by the overlay UI locally
        break;
      }
    }
  }
}
