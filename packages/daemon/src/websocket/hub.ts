import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type {
  ClientMessage,
  ServerMessage,
  AnnotationData,
  DomChange,
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
    app.get("/ws", { websocket: true }, (socket, _request) => {
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

      socket.on("error", () => {
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
          status: "pending",
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

      case "batch:submit": {
        const batchId = crypto.randomUUID();
        const { annotations, domChanges } = msg.payload;

        // Store all annotations from the batch
        for (const annotationPayload of annotations) {
          const annotation: AnnotationData = {
            ...annotationPayload,
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            status: "pending",
          };
          this.store.addAnnotation(annotation);
          this.broadcast({ type: "annotation:created", payload: annotation });
        }

        // Store any DOM changes from the batch
        for (const change of domChanges) {
          this.store.addDomChange(change);
          this.broadcast({ type: "dom:changed", payload: change });
        }

        // Notify all clients (including MCP) that a batch was submitted
        this.broadcast({
          type: "batch:submitted",
          payload: {
            batchId,
            annotationCount: annotations.length,
            domChangeCount: domChanges.length,
          },
        });
        break;
      }

      case "dom:move": {
        const change: DomChange = {
          id: crypto.randomUUID(),
          iteration: msg.payload.iteration,
          selector: msg.payload.selector,
          type: "move",
          componentName: null,
          sourceLocation: null,
          before: { rect: msg.payload.from, computedStyles: {} },
          after: { rect: msg.payload.to, computedStyles: {} },
          timestamp: Date.now(),
        };
        this.store.addDomChange(change);
        this.broadcast({ type: "dom:changed", payload: change });
        break;
      }

      case "dom:reorder": {
        const change: DomChange = {
          id: crypto.randomUUID(),
          iteration: msg.payload.iteration,
          selector: msg.payload.selector,
          type: "reorder",
          componentName: null,
          sourceLocation: null,
          before: { rect: { x: 0, y: 0, width: 0, height: 0 }, computedStyles: {} },
          after: { rect: { x: 0, y: 0, width: 0, height: 0 }, computedStyles: {}, siblingIndex: msg.payload.newIndex },
          timestamp: Date.now(),
        };
        this.store.addDomChange(change);
        this.broadcast({ type: "dom:changed", payload: change });
        break;
      }

      case "dom:select":
      case "dom:resize":
      case "iteration:switch":
      case "iteration:compare":
        break;
    }
  }
}
