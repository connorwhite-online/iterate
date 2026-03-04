import type { Metadata } from "next";
import { IconGrid } from "@/components/IconGrid";
import {
  CursorIcon,
  MoveIcon,
  MarkerIcon,
  SendIcon,
  CopyIcon,
  TrashIcon,
  UndoIcon,
  ForkIcon,
  PickIcon,
  DiscardIcon,
  CloseIcon,
} from "@/lib/icons";

export const metadata: Metadata = {
  title: "Toolbar Tools",
  description: "The iterate overlay toolbar — tool modes, batch actions, and iteration management.",
};

export default function ToolbarPage() {
  return (
    <>
      <h1>Toolbar Tools</h1>
      <p>
        The overlay injects a floating panel in the bottom-right corner of your app during
        development only — it has zero production impact. It&apos;s draggable
        to any corner and toggled with <strong>Cmd+I</strong>.
      </p>

      {/* Dummy toolbar matching the real overlay */}
      <div style={{ display: "flex", justifyContent: "center", margin: "1.5rem 0" }}>
      <div style={{
        background: "#f7f7f7",
        border: "none",
        borderRadius: 12,
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        display: "inline-flex",
        flexDirection: "column",
        gap: 0,
        userSelect: "none",
        overflow: "hidden",
        padding: 4,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}>
        {/* Iteration tabs */}
        <div style={{
          display: "flex", alignItems: "center", gap: 2, padding: "0 2px", marginBottom: 2,
        }}>
          {[
            { name: "Original", active: false },
            { name: "v1", active: true },
            { name: "v2", active: false },
            { name: "v3", active: false },
          ].map((tab) => (
            <span key={tab.name} title={tab.name} style={{
              display: "flex", alignItems: "center", gap: 4,
              maxWidth: 80, padding: "3px 8px", borderRadius: 6,
              border: "1px solid transparent",
              background: tab.active ? "#e8e8e8" : "transparent",
              color: tab.active ? "#141414" : "#666",
              cursor: "pointer", fontSize: 11, fontWeight: 500,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 0,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />
              {tab.name}
            </span>
          ))}
        </div>
        {/* Main toolbar row */}
        <div style={{
          display: "flex", alignItems: "center",
          background: "#fff", border: "1px solid #e0e0e0", borderRadius: 10, padding: 4,
        }}>
          {/* Annotation tools: Select, Draw, Move */}
          <span title="Select" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 4, borderRadius: 8, border: "none",
            background: "#e0e0e0", color: "#141414", cursor: "pointer",
          }}><CursorIcon size={24} /></span>
          <span title="Draw" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 4, borderRadius: 8, border: "none",
            background: "transparent", color: "#666", cursor: "pointer",
          }}><MarkerIcon size={24} /></span>
          <span title="Move" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 4, borderRadius: 8, border: "none",
            background: "transparent", color: "#666", cursor: "pointer",
          }}><MoveIcon size={24} /></span>

          {/* Divider */}
          <span style={{ width: 1, height: 20, background: "#e0e0e0", margin: "0 2px", flexShrink: 0 }} />

          {/* Change tools: Undo, Clear, Copy, Send(+badge) */}
          <span title="Undo" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 4, borderRadius: 8, border: "none",
            background: "transparent", color: "#666", cursor: "pointer",
          }}><UndoIcon size={24} /></span>
          <span title="Clear" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 4, borderRadius: 8, border: "none",
            background: "transparent", color: "#666", cursor: "pointer",
          }}><TrashIcon size={24} /></span>
          <span title="Copy" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 4, borderRadius: 8, border: "none",
            background: "transparent", color: "#666", cursor: "pointer",
          }}><CopyIcon size={24} /></span>
          <span title="Send" style={{
            position: "relative",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 4, borderRadius: 8, border: "none",
            background: "transparent", color: "#666", cursor: "pointer",
          }}>
            <SendIcon size={24} />
            <span style={{
              position: "absolute", top: -4, left: -4,
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 16, height: 16, borderRadius: "50%",
              background: "#2563eb", color: "#fff",
              fontSize: 9, fontWeight: 700, lineHeight: 1,
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            }}>3</span>
          </span>

          {/* Divider */}
          <span style={{ width: 1, height: 20, background: "#e0e0e0", margin: "0 2px", flexShrink: 0 }} />

          {/* Branching: Pick (shown when viewing iteration) */}
          <span title="Pick" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 4, borderRadius: 8, border: "none",
            background: "transparent", color: "#666", cursor: "pointer",
          }}><PickIcon size={24} /></span>

          {/* Divider */}
          <span style={{ width: 1, height: 20, background: "#e0e0e0", margin: "0 2px", flexShrink: 0 }} />

          {/* Close */}
          <span title="Close toolbar" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 4, borderRadius: 8, border: "none",
            background: "transparent", color: "#999", cursor: "pointer",
          }}><CloseIcon size={24} /></span>
        </div>
      </div>
      </div>

      <h2>Tool modes</h2>
      <p>
        These three modes let you give context to the agent directly from the page.
      </p>
      <IconGrid
        items={[
          {
            icon: <CursorIcon size={20} />,
            name: "Select",
            description: "Click or marquee-select elements for annotation",
          },
          {
            icon: <MarkerIcon size={20} />,
            name: "Draw",
            description: "Annotate freeform lines and shapes",
          },
          {
            icon: <MoveIcon size={20} />,
            name: "Move",
            description: "Drag elements to new positions on the page",
          },
        ]}
      />

      <h3>Select mode</h3>
      <p>
        Click any element to select it. Hold and drag to marquee-select multiple elements.
        Selected elements appear in the SelectionPanel that slides in from the right, showing
        each element&apos;s React component name and source file location.
      </p>
      <p>
        From the SelectionPanel, write a comment describing what you want changed and
        click &quot;Add&quot; (or <strong>Cmd+Enter</strong>).
        Blue numbered badges appear on annotated elements, showing the annotation count.
      </p>

      <h3>Draw mode</h3>
      <p>
        Draw freeform lines and shapes directly on the page. This mode is designed for
        looser, more free-form direction that doesn&apos;t target specific components —
        use it to circle areas, sketch layouts, or indicate visual changes that are hard
        to describe by selecting individual elements.
      </p>

      <h3>Move mode</h3>
      <p>
        Drag any element to a new position. Each move is recorded in the pending batch with
        before/after coordinates. Use the Preview toggle to see the repositioned layout,
        and Undo to revert the last move.
      </p>

      <h2>Undo & Clear</h2>
      <IconGrid
        items={[
          {
            icon: <UndoIcon size={20} />,
            name: "Undo",
            description: "Revert the last change (annotation, move, or deletion)",
          },
          {
            icon: <TrashIcon size={20} />,
            name: "Clear",
            description: "Discard all pending annotations and moves",
          },
        ]}
      />
      <p>
        The Undo button reverts your most recent action — whether it was an annotation,
        a drag move, or a deletion. Clear discards all pending items at once.
        A badge shows the count of pending changes.
      </p>

      <h2>Batch actions</h2>
      <p>
        These appear when you have pending annotations or moves:
      </p>
      <IconGrid
        items={[
          {
            icon: <SendIcon size={20} />,
            name: "Send",
            description: "Submit the batch to the daemon via WebSocket",
          },
          {
            icon: <CopyIcon size={20} />,
            name: "Copy",
            description: "Format the batch as markdown and copy to clipboard",
          },
        ]}
      />

      <h2>Iteration management</h2>
      <p>
        These tools manage the worktree lifecycle:
      </p>
      <IconGrid
        items={[
          {
            icon: <ForkIcon size={20} />,
            name: "Fork",
            description: "Create 3 iteration worktrees from a prompt",
          },
          {
            icon: <PickIcon size={20} />,
            name: "Pick",
            description: "Merge the desired iteration back to base and remove the rest",
          },
          {
            icon: <DiscardIcon size={20} />,
            name: "Discard",
            description: "Keep original, remove all iteration worktrees",
          },
        ]}
      />

      <h2>Iteration tabs</h2>
      <p>
        When multiple iterations exist, tabs appear at the top of the toolbar. Each tab
        shows the iteration name and a colored status dot:
      </p>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 2,
        background: "#f7f7f7", borderRadius: 8, padding: 4,
        marginBottom: "1.5rem",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}>
        {[
          { name: "Original", active: true, color: "#22c55e" },
          { name: "v1", active: false, color: "#22c55e" },
          { name: "v2", active: false, color: "#eab308" },
          { name: "v3", active: false, color: "#ef4444" },
        ].map((tab) => (
          <span key={tab.name} style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "3px 8px", borderRadius: 6,
            border: "1px solid transparent",
            background: tab.active ? "#e8e8e8" : "transparent",
            color: tab.active ? "#141414" : "#666",
            cursor: "pointer", fontSize: 11, fontWeight: 500,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: tab.color, flexShrink: 0 }} />
            {tab.name}
          </span>
        ))}
      </div>
      <p>
        <strong style={{ color: "#22c55e" }}>Green</strong> means the tab&apos;s dev server is running.{" "}
        <strong style={{ color: "#eab308" }}>Yellow</strong> means it&apos;s starting up.{" "}
        <strong style={{ color: "#ef4444" }}>Red</strong> means there was an error.
      </p>
      <p>
        Click a tab to switch which iteration iframe is displayed. Annotations are scoped to the active iteration.
      </p>

      <h2>Keyboard shortcut</h2>
      <p>
        Toggle the overlay visibility with <strong>Cmd+I</strong>.
      </p>
    </>
  );
}
