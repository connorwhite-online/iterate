---
name: "iterate:go"
description: Implement all pending UI feedback changes from the iterate overlay. Use this after submitting a batch of changes in the browser.
---

The user has submitted UI feedback changes via the iterate overlay. Your job is to fetch, understand, and implement every pending change.

## Tools

Use the MCP tools below. If MCP tools are not available (e.g. the server isn't connected), fall back to the daemon's REST API at `http://localhost:4000`:

| MCP tool                          | REST equivalent                                  |
|-----------------------------------|--------------------------------------------------|
| `iterate_get_pending_batch`       | `GET /api/changes/pending`                       |
| `iterate_start_change`            | `PATCH /api/changes/{id}/start`                  |
| `iterate_implement_change`        | `PATCH /api/changes/{id}/implement`              |
| `iterate_implement_dom_change`    | `DELETE /api/dom-changes/{id}`                   |
| `iterate_list_iterations`         | `GET /api/iterations`                            |

- **Start**: `PATCH /api/changes/{id}/start` — no body needed
- **Implement change**: `PATCH /api/changes/{id}/implement` — body: `{ "summary": "what you changed" }`
- **Implement DOM change**: `DELETE /api/dom-changes/{id}` — no body needed

## Steps

1. **Fetch the pending batch.** Call `iterate_get_pending_batch` to retrieve all pending changes and DOM changes. If there are no pending items, tell the user there's nothing to implement and stop.

2. **Start each change.** For every change, call `iterate_start_change` with its ID so the overlay UI reflects that you've started working on it.

3. **Plan your changes.** Group changes by source file. Each change includes:
   - `sourceLocation` — the file and line number (e.g. `src/components/Hero.tsx:42`)
   - `componentName` — the React component name
   - `comment` — what the user wants changed
   - `elements` — selected DOM elements with selectors, styles, and layout info
   - `textSelection` — highlighted text if applicable
   - DOM changes — any elements the user dragged to new positions

4. **Read source files.** For each unique `sourceLocation`, read the file to understand the current code before making changes.

5. **Implement the changes.** Work through each change:
   - Make changes in the correct iteration worktree — the change's `iteration` field tells you which worktree the change belongs to
   - **IMPORTANT: Worktrees are full repository checkouts.** The worktree path points to the repo root, NOT the app subdirectory. If the app lives at `examples/next-app/` in the repo, you must edit files at `{worktreePath}/examples/next-app/src/...`, not `{worktreePath}/src/...`. Always use the `sourceLocation` path relative to the worktree root.
   - **DOM changes** describe structural layout changes the user made by dragging elements. Each DOM change has a `type` field:
     - **`reorder`** — the user reordered an element within the same parent container (e.g. a flex/grid layout). The `before.siblingIndex` and `after.siblingIndex` tell you the element's position among its siblings before and after. Implement this by reordering the JSX children in the source code.
     - **`reorder` with `targetParentSelector`** — cross-parent move. The element was dragged from one container (`parentSelector`) to another (`targetParentSelector`). Move the JSX element from the source parent to the destination parent at `after.siblingIndex`.
     - **`move`** — the user repositioned an element visually. The `before.rect` and `after.rect` give bounding box coordinates. Translate the delta into CSS/layout changes (margin, position, transform, etc.).
   - DOM changes include `componentName` and `sourceLocation` to help locate the source code, plus `selector` and `parentSelector` to identify the elements.

6. **Resolve each change.** After implementing a change, you **must** mark it as resolved so it's removed from the pending queue. **Do not skip this step** — unresolved changes will remain in the overlay as pending. Resolve each change immediately after implementing it, not in a batch at the end.

   - **Regular changes**: Call `iterate_implement_change` with `annotationId` (the change's `id`) and `reply` (a brief summary shown in the overlay UI).
   - **DOM changes**: Call `iterate_implement_dom_change` with `id` (the DOM change's `id`) and optionally `reply`. DOM changes have their own IDs shown in the pending batch output — they are resolved separately from regular changes.

7. **Summarize.** After resolving all changes, give the user a brief summary of what you changed. The dev server will hot-reload automatically so they can see the results immediately in the browser.
