import { describe, it, expect } from "vitest";
import { createSerializer } from "../worktree/serialize.js";

describe("createSerializer", () => {
  it("runs tasks one at a time, even when scheduled in parallel", async () => {
    const serial = createSerializer();
    const events: string[] = [];

    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // Schedule three tasks "concurrently". If they actually ran in parallel
    // the entry events would interleave (a-start, b-start, c-start, ...).
    // Serialized, each must finish before the next begins.
    const a = serial(async () => {
      events.push("a-start");
      await wait(20);
      events.push("a-end");
    });
    const b = serial(async () => {
      events.push("b-start");
      await wait(5);
      events.push("b-end");
    });
    const c = serial(async () => {
      events.push("c-start");
      events.push("c-end");
    });

    await Promise.all([a, b, c]);

    expect(events).toEqual([
      "a-start", "a-end",
      "b-start", "b-end",
      "c-start", "c-end",
    ]);
  });

  it("preserves return values per task", async () => {
    const serial = createSerializer();
    const [a, b, c] = await Promise.all([
      serial(async () => 1),
      serial(async () => "two"),
      serial(async () => ({ three: 3 })),
    ]);
    expect(a).toBe(1);
    expect(b).toBe("two");
    expect(c).toEqual({ three: 3 });
  });

  it("does not poison the chain when a task rejects", async () => {
    const serial = createSerializer();
    const events: string[] = [];

    // A task that rejects must not block subsequent tasks from running.
    // (Real-world example: a stale-branch cleanup fails inside `create`,
    // but the next caller's create() should still run.)
    const failed = serial(async () => {
      events.push("failed-start");
      throw new Error("boom");
    });
    const after = serial(async () => {
      events.push("after-start");
      return "ok";
    });

    await expect(failed).rejects.toThrow("boom");
    await expect(after).resolves.toBe("ok");
    expect(events).toEqual(["failed-start", "after-start"]);
  });

  it("propagates the failed task's rejection to its own caller only", async () => {
    const serial = createSerializer();
    const failed = serial(async () => { throw new Error("only-this-one"); });
    const after = serial(async () => "fine");

    let observed: unknown;
    try { await failed; } catch (e) { observed = e; }
    expect((observed as Error).message).toBe("only-this-one");
    await expect(after).resolves.toBe("fine");
  });
});
