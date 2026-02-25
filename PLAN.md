# iterate v2 — Comprehensive Implementation Plan

## Overview

Overhaul the iterate tool from a "draw-a-line-then-annotate" workflow to a professional element-selection + batch-submission + worktree-branching system. This touches every package in the monorepo.

---

## 1. Babel Plugin for React Component Names + File Paths

### What
A new package `@iterate/babel-plugin` that injects `data-iterate-component` and `data-iterate-source` attributes onto every JSX element during development builds. This gives the overlay runtime access to component names and source file paths for any DOM node.

### New package: `packages/babel-plugin/`

**`packages/babel-plugin/src/index.ts`**
```ts
// Babel visitor that:
// 1. Detects JSXOpeningElement nodes
// 2. Gets the component name from the nearest function/class declaration
// 3. Gets the file path relative to project root (from state.filename)
// 4. Injects two JSX attributes:
//    - data-iterate-component="ComponentName"
//    - data-iterate-source="src/components/Hero.tsx:42"
//
// Skips: HTML intrinsic elements (div, span, etc.) — only targets
// user-defined components (PascalCase names).
// Also skips if attrs already present (idempotent).
```

**Integration points:**
- `packages/vite/src/index.ts` — Add `babel: { plugins: ['@iterate/babel-plugin'] }` to the Vite React plugin config. Needs to detect if user uses `@vitejs/plugin-react` or `@vitejs/plugin-react-swc` and configure accordingly.
- `packages/next/src/index.ts` — Add the plugin to `experimental.babel` or via a custom `.babelrc` injection.
- Only active in development mode (`process.env.NODE_ENV !== 'production'`).

### Runtime Consumption

**`packages/overlay/src/inspector/selector.ts`** — New function:
```ts
export function getComponentInfo(element: Element): {
  component: string | null;
  source: string | null;
} {
  // Walk up the DOM tree to find the nearest ancestor (or self)
  // with data-iterate-component / data-iterate-source attributes.
  // Returns the first match found.
}
```

This replaces the unused `reactComponent?: string` field with real data.

---

## 2. Annotation System Overhaul

### 2a. Remove SVG Freehand Drawing

**Delete:** `packages/overlay/src/canvas/SVGCanvas.tsx`

The freehand SVG drawing approach is replaced entirely by element-selection-based annotations.

### 2b. New Selection Modes

The `ToolMode` type changes from `"select" | "annotate" | "move"` to:

```ts
export type ToolMode = "select" | "move";
```

"Select" mode now IS the annotation mode. Clicking elements in select mode adds them to a selection set. The user then adds a comment to the selection.

**Three selection mechanisms (all active in "select" mode):**

#### Click-to-Select
Modify `ElementPicker.tsx`:
- Click an element → adds it to a `selectedElements: PickedElement[]` array (lifted to `IterateOverlay` state)
- Ctrl/Cmd+Click → toggle an element in/out of selection
- Clicking an already-selected element deselects it
- Visual: selected elements get a persistent blue highlight border + badge showing component name & file path

#### Multi-Select Drag Box (Marquee/Rubber Band)

**New file: `packages/overlay/src/inspector/MarqueeSelect.tsx`**
- When user click-drags on empty space (not on an element), draw a selection rectangle
- On release, find all elements within the rectangle using `document.elementsFromPoint()` or by iterating visible elements and checking `getBoundingClientRect()` intersection
- Add all matched elements to the selection set
- Visual: semi-transparent blue rectangle during drag

#### Text Highlight Selection

**New file: `packages/overlay/src/inspector/TextSelect.tsx`**
- When user selects text (using native browser text selection within the iframe)
- Listen for `selectionchange` event on the iframe document
- On selection, capture:
  - The selected text string
  - The containing element(s)
  - The range start/end offsets
- Add a "text selection" annotation type to the selection set
- Visual: preserve the native blue text highlight + add a small tooltip

### 2c. Selection Panel (replaces AnnotationDialog)

**Replace:** `packages/overlay/src/annotate/AnnotationDialog.tsx` → `packages/overlay/src/annotate/SelectionPanel.tsx`

When the user has selected element(s), show a panel (anchored to the toolbar, not floating near the element) that displays:

1. **Selected elements list** — Each entry shows:
   - React component name (from `data-iterate-component`, e.g. `<HeroSection>`)
   - File path (from `data-iterate-source`, e.g. `src/components/Hero.tsx:42`)
   - CSS selector as fallback
   - Remove (×) button per element
2. **Comment textarea** — "What should change?"
3. **Intent/severity chips** — Same as current (fix/change/question/approve + suggestion/important/blocking)
4. **"Add to batch" button** — Adds this annotation to the pending batch (does NOT submit to MCP yet)

### 2d. Schema Changes

**`packages/core/src/types/annotations.ts`:**

```ts
/** A single selected element within an annotation */
export interface SelectedElement {
  selector: string;
  elementName: string;
  elementPath: string;
  rect: Rect;
  computedStyles: Record<string, string>;
  nearbyText?: string;
  // NEW fields from babel plugin
  componentName: string | null;  // React component name
  sourceLocation: string | null; // file:line e.g. "src/Hero.tsx:42"
}

/** A text selection within an annotation */
export interface TextSelection {
  text: string;
  containingElement: SelectedElement;
  startOffset: number;
  endOffset: number;
}

export interface AnnotationData {
  id: string;
  iteration: string;
  // CHANGED: support multiple selected elements
  elements: SelectedElement[];
  // NEW: optional text selection
  textSelection?: TextSelection;
  // REMOVED: drawing?: SVGPathData (no more freehand)
  // REMOVED: singular selector/elementName/elementPath/rect/computedStyles/nearbyText
  comment: string;
  timestamp: number;
  intent?: AnnotationIntent;
  severity?: AnnotationSeverity;
  status: AnnotationStatus;
  resolvedBy?: "human" | "agent";
  agentReply?: string;
}
```

**Remove:** `SVGPathData` type (no longer needed).

---

## 3. Icon-Based Toolbar

### Redesign `packages/overlay/src/panel/FloatingPanel.tsx`

Replace text-based buttons with custom SVG icons. The toolbar becomes a compact icon bar.

**Icons needed (inline SVG components):**
- **Cursor/Select** — Arrow pointer icon (for select mode)
- **Move** — Four-directional arrow icon (for move mode)
- **Submit** — Paper plane / send icon (conditionally shown)
- **Minimize** — Minus icon
- **Badge** — Annotation count badge on the submit icon

**Layout:**
```
┌─────────────────────────┐
│ iterate  [↗] [⇅] [➤ 3] │  ← brand + select + move + submit(count)
└─────────────────────────┘
```

The submit button:
- Only visible when `pendingBatchCount > 0`
- Shows the count as a badge
- Clicking it triggers the batch submission flow

**New file: `packages/overlay/src/panel/icons.tsx`**
Custom SVG icon components for each tool. Simple, 16×16 or 20×20, monochrome, matching the existing dark theme.

---

## 4. Batch Submission Workflow

### Concept
Annotations are created locally (stored in overlay state) and accumulate until the user explicitly submits the entire batch. This replaces the current "each annotation immediately sent to daemon" flow.

### Flow

1. **User selects elements → adds comment → clicks "Add to batch"**
   - Annotation stored in local overlay state (`pendingBatch: AnnotationData[]`)
   - Badge count on Submit icon updates
   - Selected elements show a numbered marker matching their annotation

2. **User clicks Submit icon in toolbar**
   - Overlay sends a new message type: `batch:submit`
   - Payload contains the full `AnnotationData[]` array + any `DomChange[]` accumulated

3. **Daemon receives `batch:submit`**
   - Stores all annotations with `status: "pending"`
   - Stores all DOM changes
   - Broadcasts `batch:submitted` to all clients (MCP client will be listening)
   - Emits an **MCP notification** via a new mechanism (see below)

4. **MCP server receives notification**
   - The MCP `DaemonClient` already has a WebSocket connection
   - Add a listener for `batch:submitted` events
   - When received, the MCP server can use the `notifications/resources/updated` protocol to signal Claude that new work is available
   - Claude calls `iterate_get_pending_batch` to read all the annotations + DOM changes

### Protocol Changes

**`packages/core/src/protocol/messages.ts`:**
```ts
// New client → server messages
| { type: "batch:submit"; payload: {
    iteration: string;
    annotations: Omit<AnnotationData, "id" | "timestamp" | "status">[];
    domChanges: DomChange[];
  }}

// New server → client messages
| { type: "batch:submitted"; payload: {
    batchId: string;
    annotationCount: number;
    domChangeCount: number;
  }}
```

### New MCP Tool

**`iterate_get_pending_batch`** — Returns all annotations and DOM changes from the most recent batch submission, with full component names and file paths for each selected element.

---

## 5. DOM Element Manipulation

### Current State
`DragHandler.tsx` already supports moving absolutely/fixed-positioned elements and flex children. This is solid.

### Enhancements
- DOM changes should be included in the batch submission (they already accumulate in daemon state)
- The batch submission payload should include `domChanges` alongside annotations
- The MCP tool `iterate_get_pending_batch` should format DOM changes with before/after positions
- Add component name + file path to `DomChange` schema:

```ts
export interface DomChange {
  id: string;
  iteration: string;
  selector: string;
  type: "move" | "reorder" | "resize" | "style";
  componentName: string | null;   // NEW
  sourceLocation: string | null;  // NEW
  before: DomSnapshot;
  after: DomSnapshot;
  timestamp: number;
}
```

---

## 6. Worktree Slash Command Flow (Shell UI Command Bar)

### Concept
Add a command input bar to the daemon's shell HTML (the tab bar area). The user types a slash command like `/iterate make 3 variations of the hero section` and the system:
1. Creates N worktree iterations
2. Sends the prompt to the MCP server for Claude to work on each iteration differently
3. User flips between tabs to compare results
4. User clicks "Pick" on their preferred iteration

### Shell UI Changes

**In `getShellHTML()` (daemon index.ts):**

Add a command input bar between the tab bar and viewport:
```html
<div id="command-bar">
  <input id="command-input" placeholder="/ Type a command..." />
</div>
```

When user types `/iterate <prompt>`:
- Parse the command (supports `/iterate <prompt>` and `/iterate --count N <prompt>`)
- POST to a new daemon API endpoint: `POST /api/command`
- The daemon creates N iterations and stores the prompt context
- Each iteration tab shows the prompt snippet

### New API Endpoint

**`POST /api/command`**
```json
{
  "command": "iterate",
  "prompt": "make 3 variations of the hero section",
  "count": 3
}
```

This endpoint:
1. Creates N iterations via the existing worktree flow
2. Stores the prompt in a new `commandContext` field on each iteration
3. Broadcasts `command:started` to WebSocket clients
4. The MCP server picks up the prompt and iteration names
5. Claude works on each iteration independently

### MCP Integration

New MCP tool: **`iterate_get_command_context`** — Returns the prompt and iteration context so Claude knows what to build in each worktree.

The flow for Claude:
1. `iterate_get_command_context` → learns prompt + iteration names
2. For each iteration, Claude makes different code changes in the corresponding worktree
3. User views each tab, picks a winner
4. `iterate_pick_iteration` merges the winner

### Iteration Schema Update

```ts
export interface IterationInfo {
  name: string;
  branch: string;
  worktreePath: string;
  port: number;
  pid: number | null;
  status: IterationStatus;
  createdAt: string;
  // NEW
  commandPrompt?: string;  // The prompt that spawned this iteration
  commandId?: string;       // Groups iterations from the same command
}
```

---

## 7. Implementation Order

### Phase 1: Core Schema + Babel Plugin (Foundation)
1. Create `packages/babel-plugin/` with the JSX attribute injector
2. Update `AnnotationData` schema in `packages/core/` (new multi-element structure, remove SVGPathData)
3. Update `DomChange` schema to include component/source fields
4. Add `IterationInfo.commandPrompt` and `commandId` fields
5. Update protocol messages for batch submission
6. Wire babel plugin into Vite and Next.js integrations

### Phase 2: Overlay UI (Selection + Toolbar)
7. Delete `SVGCanvas.tsx`
8. Refactor `ElementPicker.tsx` — multi-select, component info display
9. Create `MarqueeSelect.tsx` — rubber band selection
10. Create `TextSelect.tsx` — text highlight selection
11. Replace `AnnotationDialog.tsx` with `SelectionPanel.tsx`
12. Create `icons.tsx` — custom SVG icons
13. Redesign `FloatingPanel.tsx` — icon-based toolbar with Submit button
14. Update `IterateOverlay.tsx` — new selection state management, batch accumulation
15. Update `standalone.tsx` — wire new components

### Phase 3: Daemon + Protocol (Batch Submission)
16. Add `batch:submit` handler in `WebSocketHub`
17. Add batch storage in `StateStore`
18. Add `POST /api/command` endpoint in daemon
19. Update shell HTML with command bar
20. Update proxy router if needed

### Phase 4: MCP (Agent Integration)
21. Add `iterate_get_pending_batch` tool
22. Add `iterate_get_command_context` tool
23. Update `iterate_list_annotations` to use new schema (multi-element format)
24. Update `iterate_get_dom_context` to include component names + file paths
25. Add WebSocket listener for `batch:submitted` events → MCP notification

### Phase 5: Polish + Integration Testing
26. End-to-end: select elements → add comment → submit batch → Claude reads batch
27. End-to-end: /iterate command → worktrees created → Claude works → user picks winner
28. Verify babel plugin works with Vite and Next.js
29. Verify component names and file paths appear in overlay UI

---

## Files Summary

### New Files
- `packages/babel-plugin/src/index.ts` — Babel plugin
- `packages/babel-plugin/package.json` — Package config
- `packages/overlay/src/inspector/MarqueeSelect.tsx` — Rubber band selection
- `packages/overlay/src/inspector/TextSelect.tsx` — Text highlight selection
- `packages/overlay/src/annotate/SelectionPanel.tsx` — Selection annotation panel
- `packages/overlay/src/panel/icons.tsx` — Custom SVG icons

### Modified Files
- `packages/core/src/types/annotations.ts` — Schema overhaul
- `packages/core/src/types/dom.ts` — Add component/source fields
- `packages/core/src/types/iterations.ts` — Add command fields
- `packages/core/src/protocol/messages.ts` — Batch messages
- `packages/core/src/index.ts` — Export new types
- `packages/overlay/src/inspector/selector.ts` — Add `getComponentInfo()`
- `packages/overlay/src/inspector/ElementPicker.tsx` — Multi-select, component display
- `packages/overlay/src/panel/FloatingPanel.tsx` — Icon-based toolbar
- `packages/overlay/src/IterateOverlay.tsx` — New state management
- `packages/overlay/src/standalone.tsx` — Wire new components
- `packages/daemon/src/index.ts` — Command bar in shell HTML, new API endpoint
- `packages/daemon/src/websocket/hub.ts` — Batch submission handler
- `packages/daemon/src/state/store.ts` — Batch storage
- `packages/vite/src/index.ts` — Babel plugin integration
- `packages/next/src/index.ts` — Babel plugin integration
- `packages/mcp/src/index.ts` — New MCP tools, updated formatters

### Deleted Files
- `packages/overlay/src/canvas/SVGCanvas.tsx` — Replaced by element selection
