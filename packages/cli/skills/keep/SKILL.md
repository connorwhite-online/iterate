---
name: keep
description: Pick a winning iteration to merge back to the base branch and clean up the rest.
argument-hint: <iteration name or description>
---

The user wants to keep one iteration and merge it into the base branch. They said:

> $ARGUMENTS

## Steps

1. **List iterations.** Call `iterate_list_iterations` to see all active iterations with their names, branches, and any command prompts.

2. **Match the iteration.** Determine which iteration the user wants to keep:
   - If `$ARGUMENTS` exactly matches an iteration name, use that
   - If it partially matches (e.g. "v2" matches "v2-blue-buttons"), use the closest match
   - If it describes what the iteration looks like rather than its name (e.g. "the one with the gradient"), read the source files or command prompts for each iteration to determine which one best matches the description
   - If ambiguous, ask the user to clarify which iteration they mean

3. **Confirm and pick.** Once you've identified the iteration:
   - Tell the user which iteration you're going to keep and that all others will be removed
   - Call `iterate_pick_iteration` with the iteration name and `strategy: "merge"`

4. **Report the result.** Let the user know the merge completed and they're back on the base branch with the winning iteration's changes applied.
