---
name: prompt
description: Create multiple iterate variations from a design prompt and implement each one differently.
argument-hint: <design prompt>
---

The user wants to create multiple UI variations from a prompt. Their prompt is:

> $ARGUMENTS

## Steps

1. **Check current state.** Call `iterate_list_iterations` to see what iterations already exist. If iterations already exist, ask the user whether to create new ones alongside them or remove the existing ones first.

2. **Create iterations.** Create 3 iterations using `iterate_create_iteration`, naming them based on the prompt:
   - Use short, descriptive names like `v1-blue-buttons`, `v2-gradient-buttons`, `v3-outlined-buttons`
   - Each name should hint at how that variation will differ
   - Names must be alphanumeric with hyphens/underscores only

3. **Wait for iterations.** After creating all iterations, call `iterate_list_iterations` to confirm they're all in `ready` status. If any are still starting up, wait briefly and check again.

4. **Implement variations.** For each iteration, make meaningfully different code changes that address the prompt. The iteration's `worktreePath` tells you where its code lives — all file edits for that variation must happen inside that worktree path.
   - Each variation should take a distinct creative direction
   - Changes should be substantial enough that the user can see real differences
   - Focus on the visual/functional differences implied by the prompt

5. **Summarize.** After implementing all variations, give the user a brief summary of what makes each variation unique. Remind them they can compare the variations in the iterate browser UI (localhost:4000) and submit feedback annotations on whichever one they'd like to refine.
