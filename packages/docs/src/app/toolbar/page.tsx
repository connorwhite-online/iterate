import type { Metadata } from "next";
import {
  CursorIcon,
  MoveIcon,
  MarkerIcon,
  CopyIcon,
  TrashIcon,
  UndoIcon,
  ForkIcon,
  PickIcon,
  DiscardIcon,
  CloseIcon,
} from "@/lib/icons";
import { Callout } from "@/components/Callout";

export const metadata: Metadata = {
  title: "Toolbar",
  description: "The iterate overlay toolbar — tool modes, batch actions, and iteration management.",
};

export default function ToolbarPage() {
  return (
    <>
      <h1 style={{ display: "flex", alignItems: "center" }}>Toolbar <kbd style={{ fontSize: "0.6em", padding: "2px 8px", borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-bg-code)", fontWeight: 500, marginLeft: "auto" }}>⌘I</kbd></h1>
      <p>
        An injected toolbar overlay visible on your app during development only. It&apos;s draggable to any corner of the screen.
      </p>

      {/* Dummy toolbar matching the real overlay */}
      <div style={{ display: "flex", justifyContent: "center", margin: "1.5rem 0" }}>
      <div className="toolbar-mockup" style={{
        background: "var(--toolbar-panel-bg)",
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
          display: "flex", alignItems: "center", gap: 2, padding: "2px 2px", marginBottom: 2,
        }}>
          {[
            { name: "Original", active: false },
            { name: "v1", active: true },
            { name: "v2", active: false },
            { name: "v3", active: false },
          ].map((tab) => (
            <span key={tab.name} title={tab.name} style={{
              display: "flex", alignItems: "center", gap: 4,
              maxWidth: 80, padding: "1px 8px", borderRadius: 6,
              border: "1px solid transparent",
              background: tab.active ? "var(--toolbar-active-bg)" : "transparent",
              color: tab.active ? "var(--toolbar-icon-hover)" : "var(--toolbar-icon-default)",
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
          background: "var(--toolbar-bg)", border: "1px solid var(--toolbar-border)", borderRadius: 10, padding: 4,
        }}>
          {/* Annotation tools: Select, Draw, Move */}
          <span title="Select" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 4, borderRadius: 8, border: "none",
            background: "var(--toolbar-active-bg)", color: "var(--toolbar-icon-hover)", cursor: "pointer",
          }}><CursorIcon size={24} /></span>
          <span title="Draw" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 4, borderRadius: 8, border: "none",
            background: "transparent", color: "var(--toolbar-icon-default)", cursor: "pointer",
          }}><MarkerIcon size={24} /></span>
          <span title="Move" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 4, borderRadius: 8, border: "none",
            background: "transparent", color: "var(--toolbar-icon-default)", cursor: "pointer",
          }}><MoveIcon size={24} /></span>

          {/* Divider */}
          <span style={{ width: 1, height: 20, background: "var(--toolbar-border)", margin: "0 2px", flexShrink: 0 }} />

          {/* Change tools: Undo, Clear, Copy */}
          <span title="Undo" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 4, borderRadius: 8, border: "none",
            background: "transparent", color: "var(--toolbar-icon-default)", cursor: "pointer",
          }}><UndoIcon size={24} /></span>
          <span title="Clear" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 4, borderRadius: 8, border: "none",
            background: "transparent", color: "var(--toolbar-icon-default)", cursor: "pointer",
          }}><TrashIcon size={24} /></span>
          <span title="Copy" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 4, borderRadius: 8, border: "none",
            background: "transparent", color: "var(--toolbar-icon-default)", cursor: "pointer",
          }}><CopyIcon size={24} /></span>

          {/* Divider */}
          <span style={{ width: 1, height: 20, background: "var(--toolbar-border)", margin: "0 2px", flexShrink: 0 }} />

          {/* Branching: Pick (shown when viewing iteration) */}
          <span title="Pick" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 4, borderRadius: 8, border: "none",
            background: "transparent", color: "var(--toolbar-icon-default)", cursor: "pointer",
          }}><PickIcon size={24} /></span>

          {/* Divider */}
          <span style={{ width: 1, height: 20, background: "var(--toolbar-border)", margin: "0 2px", flexShrink: 0 }} />

          {/* Close */}
          <span title="Close toolbar" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 4, borderRadius: 8, border: "none",
            background: "transparent", color: "var(--toolbar-text-tertiary)", cursor: "pointer",
          }}><CloseIcon size={24} /></span>
        </div>
      </div>
      </div>

      <h2>Context tools</h2>
      <p>
        These three modes let you give context to the agent directly from the page.
      </p>

      <h3 style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}><CursorIcon size={16} /> Select <kbd style={{ fontSize: "0.75em", padding: "1px 5px", borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-bg-code)", fontWeight: 500, marginLeft: "auto" }}>S</kbd></h3>
      <p>
        Click any element to select it, or hold and drag to marquee-select multiple elements.
        Provide written feedback on what you want to change and click &quot;Add&quot; (or <strong>Cmd+Enter</strong>).
        Blue numbered badges appear on annotated elements.
      </p>

      <h3 style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}><MarkerIcon size={16} /> Draw <kbd style={{ fontSize: "0.75em", padding: "1px 5px", borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-bg-code)", fontWeight: 500, marginLeft: "auto" }}>D</kbd></h3>
      <p>
        Draw freeform lines and shapes directly on the page. This mode is designed for
        looser, more free-form direction that doesn&apos;t target specific components —
        use it to circle areas, sketch layouts, or indicate visual changes that are hard
        to describe by selecting individual elements.
      </p>

      <h3 style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}><MoveIcon size={16} /> Move <kbd style={{ fontSize: "0.75em", padding: "1px 5px", borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-bg-code)", fontWeight: 500, marginLeft: "auto" }}>M</kbd></h3>
      <p>
        Drag any element to a new position. Each move is recorded in the pending batch with
        before/after coordinates.
      </p>
      <Callout>
        <p>
          This feature is still in beta, but the output has been quite helpful. Improvements will be made to this tool rapidly.
        </p>
      </Callout>

      <h3 style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}><UndoIcon size={16} /> Undo <kbd style={{ fontSize: "0.75em", padding: "1px 5px", borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-bg-code)", fontWeight: 500, marginLeft: "auto" }}>U</kbd></h3>
      <p>
        Reverts your most recent action — whether it was an annotation,
        a drag move, or a deletion.
      </p>

      <h3 style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}><TrashIcon size={16} /> Clear <kbd style={{ fontSize: "0.75em", padding: "1px 5px", borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-bg-code)", fontWeight: 500, marginLeft: "auto" }}>X</kbd></h3>
      <p>
        Discards all queued changes at once.
      </p>

      <h3 style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}><CopyIcon size={16} /> Copy <kbd style={{ fontSize: "0.75em", padding: "1px 5px", borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-bg-code)", fontWeight: 500, marginLeft: "auto" }}>C</kbd></h3>
      <p>
        Copies structured markdown to your clipboard. Paste into Cursor, Codex, or any AI coding tool —
        useful as a workaround when you&apos;re not using the MCP integration.
      </p>

      <h2>Iteration management</h2>
      <p>
        These tools manage the worktree lifecycle:
      </p>

      <h3 style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}><ForkIcon size={16} /> Fork</h3>
      <p>
        Create 3 iteration worktrees, each with its own branch, dependencies, and dev server on a unique port.
      </p>

      <h3 style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}><PickIcon size={16} /> Pick</h3>
      <p>
        Merge the desired iteration back to your base branch and remove the rest.
      </p>

      <h3 style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}><DiscardIcon size={16} /> Discard</h3>
      <p>
        Keep original, remove all iteration worktrees.
      </p>

      <h2>Iteration tabs</h2>
      <p>
        When multiple iterations, or worktrees, exist, tabs appear at the top of the toolbar. Each tab
        shows the iteration name and a colored status dot:
      </p>
      <div className="toolbar-mockup" style={{
        display: "inline-flex", alignItems: "center", gap: 2,
        background: "var(--toolbar-panel-bg)", borderRadius: 8, padding: 4,
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
            padding: "1px 8px", borderRadius: 6,
            border: "1px solid transparent",
            background: tab.active ? "var(--toolbar-active-bg)" : "transparent",
            color: tab.active ? "var(--toolbar-icon-hover)" : "var(--toolbar-icon-default)",
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

      <h2>Keyboard shortcuts</h2>
      <p>
        All single-key shortcuts are active when the toolbar is open and no text input is focused.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", margin: "1rem 0" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid var(--color-border)" }}>
            <th style={{ padding: "8px 12px" }}>Key</th>
            <th style={{ padding: "8px 12px" }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["⌘I", "Toggle toolbar open / closed"],
            ["Esc", "Close toolbar"],
            ["S", "Toggle Select mode"],
            ["D", "Toggle Draw mode"],
            ["M", "Toggle Move mode"],
            ["U", "Undo last change"],
            ["X", "Clear all changes"],
            ["C", "Copy changes to clipboard"],
          ].map(([key, action]) => (
            <tr key={key} style={{ borderBottom: "1px solid var(--color-border)" }}>
              <td style={{ padding: "6px 12px" }}>
                <kbd style={{
                  display: "inline-block",
                  padding: "2px 6px",
                  borderRadius: 4,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg-code)",
                  fontSize: 12,
                  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                  fontWeight: 500,
                }}>{key}</kbd>
              </td>
              <td style={{ padding: "6px 12px" }}>{action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
