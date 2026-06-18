---
name: "iterate:critique"
description: Analyze a pending design-critique request from the iterate overlay against the built-in design principles and submit prioritized, element-anchored findings. Use this when the user requests a design critique (the daemon auto-runs it when the overlay's Critique button is pressed).
---

The user pressed **Critique** in the iterate overlay. The overlay captured a snapshot of the current screen (DOM + computed styles) and created a critique request. Your job is to evaluate that snapshot against the design principles and submit concrete, element-anchored findings.

## Tools

| MCP tool                       | What it does                                                        |
|--------------------------------|---------------------------------------------------------------------|
| `iterate_get_critique_request` | Fetch the pending request: page snapshot + principles to apply      |
| `iterate_submit_critique`      | Submit findings for the request (resolves elements + places badges) |
| `iterate_list_iterations`      | List all iterations                                                 |

### If MCP tools are unavailable

Read the daemon port from `.iterate/daemon.lock` (JSON, `port` field) and call `http://localhost:<port>` directly:

| Method  | Path                                   | Body                            |
|---------|----------------------------------------|---------------------------------|
| `GET`   | `/api/critique-requests?status=pending`| —                               |
| `PATCH` | `/api/critique-requests/{id}/start`    | —                               |
| `POST`  | `/api/critique-findings`               | a finding object (see below)    |
| `PATCH` | `/api/critique-requests/{id}/complete` | —                               |

A finding posted over HTTP needs: `requestId`, `principleId`, `severity`, `element` (the full snapshot node), `rationale`, `recommendation`, and optionally `measured`/`target`/`category`/`principleTitle`.

## Steps

1. **Fetch the request.** Call `iterate_get_critique_request`. It returns the captured elements (each with selector, size, computed styles, source location) and the design principles to evaluate against. If there's no pending request, tell the user and stop. Note the **request ID**.

2. **Evaluate against the principles.** For each principle, check the captured elements. Prefer **measurable** judgments using the captured data:
   - `a11y-target-size` — flag interactive elements smaller than 44px in either dimension (compare to the captured `Size`).
   - `color-text-contrast` — estimate contrast from the captured `color` vs. background; flag text below 4.5:1 (3:1 for large text).
   - `type-min-body-size` / `type-line-height` / `type-line-length` — check captured `font-size`, `line-height`, and container width.
   - `space-rhythm` — flag padding/margin/gap values that don't fit a 4/8px scale.
   - `hierarchy-*`, `interaction-*` — reason about emphasis and affordance from size/weight/color.

3. **Read source where useful.** Use each element's `sourceLocation` to read the component and confirm a finding is actionable before raising it. Worktrees are full repo checkouts — the `sourceLocation` path is relative to the worktree root.

4. **Submit findings.** Call `iterate_submit_critique` with the request ID and a `findings` array. For each finding provide:
   - `selector` — must match an element from the snapshot (the server resolves it and places the on-page badge)
   - `principleId` — the cited principle (e.g. `a11y-target-size`)
   - `severity` — `high` | `medium` | `low`
   - `rationale` — one line; include the measured-vs-target numbers
   - `recommendation` — a concrete fix the user can apply
   - `measured` / `target` — the numbers, when applicable (e.g. `"32px"` vs `"≥44px"`)

   Prioritize by severity. **Only raise findings backed by the captured data — do not speculate** about things not visible in the snapshot. A short, high-signal list beats an exhaustive one.

5. **Summarize.** After submitting, give the user a brief summary: how many findings by severity, and the top issues. The overlay shows each finding as a badge on the element; the user can Apply a finding (which turns it into a normal change you'll implement via `iterate:go`) or dismiss it.
