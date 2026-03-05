import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type {
  ClientMessage,
  ServerMessage,
  Change,
  DomChange,
} from "iterate-ui-core";
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
      case "change:create": {
        const change: Change = {
          ...msg.payload,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          status: "queued",
        };
        this.store.addChange(change);
        this.broadcast({ type: "change:created", payload: change });
        break;
      }

      case "change:delete": {
        const removed = this.store.removeChange(msg.payload.id);
        if (removed) {
          this.broadcast({
            type: "change:deleted",
            payload: { id: msg.payload.id },
          });
        }
        break;
      }

      case "dom-change:create": {
        const domChange: DomChange = {
          ...msg.payload,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
        };
        this.store.addDomChange(domChange);
        this.broadcast({ type: "dom:changed", payload: domChange });
        break;
      }

      case "dom-change:delete": {
        const removed = this.store.removeDomChange(msg.payload.id);
        if (removed) {
          this.broadcast({
            type: "dom:deleted",
            payload: { id: msg.payload.id },
          });
        }
        break;
      }

      case "batch:submit": {
        const batchId = crypto.randomUUID();
        const { changes, domChanges } = msg.payload;

        // Store all changes from the batch
        for (const changePayload of changes) {
          const change: Change = {
            ...changePayload,
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            status: "queued",
          };
          this.store.addChange(change);
          this.broadcast({ type: "change:created", payload: change });
        }

        // Store any DOM changes from the batch
        for (const domChange of domChanges) {
          this.store.addDomChange(domChange);
          this.broadcast({ type: "dom:changed", payload: domChange });
        }

        // Notify all clients (including MCP) that a batch was submitted
        this.broadcast({
          type: "batch:submitted",
          payload: {
            batchId,
            changeCount: changes.length,
            domChangeCount: domChanges.length,
          },
        });
        break;
      }

      case "dom:move": {
        const domChange: DomChange = {
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
        this.store.addDomChange(domChange);
        this.broadcast({ type: "dom:changed", payload: domChange });
        break;
      }

      case "dom:reorder": {
        const domChange: DomChange = {
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
        this.store.addDomChange(domChange);
        this.broadcast({ type: "dom:changed", payload: domChange });
        break;
      }

      case "tool:set-mode": {
        // Relay tool mode changes to all clients (for cross-iframe sync)
        this.broadcast({ type: "tool:mode-changed", payload: msg.payload });
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
