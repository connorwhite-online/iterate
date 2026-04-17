---
name: "iterate:prompt"
description: Create multiple iterate variations from a design prompt and implement each one differently.
argument-hint: <design prompt>
---

The user wants to create multiple UI variations from a prompt. Their prompt is:

> $ARGUMENTS

## Tools

Use the MCP tools below. If MCP tools are not available (e.g. the server isn't connected), fall back to the daemon's REST API at `http://localhost:<port>`, where `<port>` is read from `.iterate/daemon.lock` in the repo root (JSON with a `port` field):

| MCP tool                      | REST equivalent                                              |
|-------------------------------|--------------------------------------------------------------|
| `iterate_list_iterations`     | `GET /api/iterations`                                        |
| `iterate_create_iteration`    | `POST /api/iterations` — body: `{ "name": "...", "baseBranch": "..." }` |
| `iterate_remove_iteration`    | `DELETE /api/iterations/{name}`                              |

## Steps

1. **Check current state.** Call `iterate_list_iterations` to see what iterations already exist. If iterations already exist, ask the user whether to create new ones alongside them or remove the existing ones first.

2. **Create iterations.** Create 3 iterations using `iterate_create_iteration`, naming them based on the prompt:
   - Use short, descriptive names like `v1-blue-buttons`, `v2-gradient-buttons`, `v3-outlined-buttons`
   - Each name should hint at how that variation will differ
   - Names must be alphanumeric with hyphens/underscores only

3. **Wait for iterations.** After creating all iterations, call `iterate_list_iterations` to confirm they're all in `ready` status. If any are still starting up, wait briefly and check again.

4. **Implement variations.** For each iteration, make meaningfully different code changes that address the prompt. The iteration's `worktreePath` tells you where its code lives — all file edits for that variation must happen inside that worktree path.
   - **IMPORTANT: Worktrees are full repository checkouts.** The `worktreePath` points to the repo root, NOT the app subdirectory. If the app lives at `examples/next-app/` in the repo, you must edit files at `{worktreePath}/examples/next-app/src/...`, not `{worktreePath}/src/...`. Always check the repo structure to find the correct path relative to the worktree root.
   - Each variation should take a distinct creative direction
   - Changes should be substantial enough that the user can see real differences
   - Focus on the visual/functional differences implied by the prompt

5. **Summarize.** After implementing all variations, give the user a brief summary of what makes each variation unique. Remind them they can compare the variations in the iterate overlay on their running dev server and submit feedback on whichever one they'd like to refine.
