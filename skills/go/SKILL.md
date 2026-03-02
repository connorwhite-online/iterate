---
name: go
description: Implement all pending UI feedback annotations from the iterate overlay. Use this after submitting a batch of annotations in the browser.
---

The user has submitted UI feedback annotations via the iterate overlay. Your job is to fetch, understand, and implement every pending annotation.

## Steps

1. **Fetch the pending batch.** Call `iterate_get_pending_batch` to retrieve all pending annotations and DOM changes. If there are no pending items, tell the user there's nothing to implement and stop.

2. **Acknowledge each annotation.** For every annotation, call `iterate_acknowledge_annotation` with its ID so the overlay UI reflects that you've started working on it.

3. **Plan your changes.** Group annotations by source file. Each annotation includes:
   - `sourceLocation` — the file and line number (e.g. `src/components/Hero.tsx:42`)
   - `componentName` — the React component name
   - `comment` — what the user wants changed
   - `intent` — fix, change, question, or approve
   - `severity` — blocking, important, or suggestion
   - `elements` — selected DOM elements with selectors, styles, and layout info
   - `textSelection` — highlighted text if applicable
   - DOM changes — any elements the user dragged to new positions

4. **Read source files.** For each unique `sourceLocation`, read the file to understand the current code before making changes.

5. **Implement the changes.** Work through annotations by priority:
   - `blocking` severity first, then `important`, then `suggestion`
   - `fix` intent items before `change` items
   - For DOM position changes (moves), translate the pixel delta into appropriate CSS/layout changes in the source
   - Make changes in the correct iteration worktree — the annotation's `iteration` field tells you which worktree the change belongs to

6. **Resolve each annotation.** After implementing a change, call `iterate_resolve_annotation` with:
   - The annotation's `id`
   - A brief `reply` summarizing what you changed (this shows in the overlay UI)

7. **Handle questions.** If an annotation has `intent: "question"`, answer the question by calling `iterate_resolve_annotation` with your answer as the `reply` instead of making code changes.

8. **Handle approvals.** If an annotation has `intent: "approve"`, simply acknowledge it and resolve it — no changes needed. The user is saying that part looks good.

After resolving all annotations, give the user a brief summary of what you changed. The dev server will hot-reload automatically so they can see the results immediately in the browser.
