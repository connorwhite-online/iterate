---
name: "iterate:go"
description: Implement all pending UI feedback changes from the iterate overlay. Use this after submitting a batch of changes in the browser.
---

The user has submitted UI feedback changes via the iterate overlay. Your job is to fetch, understand, and implement every pending change.

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
   - For DOM position changes (moves), translate the pixel delta into appropriate CSS/layout changes in the source
   - Make changes in the correct iteration worktree — the change's `iteration` field tells you which worktree the change belongs to
   - **IMPORTANT: Worktrees are full repository checkouts.** The worktree path points to the repo root, NOT the app subdirectory. If the app lives at `examples/next-app/` in the repo, you must edit files at `{worktreePath}/examples/next-app/src/...`, not `{worktreePath}/src/...`. Always use the `sourceLocation` path relative to the worktree root.

6. **Implement each change.** After implementing a change, call `iterate_implement_change` with:
   - The change's `id`
   - A brief `reply` summarizing what you changed (this shows in the overlay UI)

After implementing all changes, give the user a brief summary of what you changed. The dev server will hot-reload automatically so they can see the results immediately in the browser.
