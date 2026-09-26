import { describe, expect, it } from "vite-plus/test";

import { resolveTabEntry, shouldHoldTabEntry } from "./scrollingAnimation";

const entry = (dir: -1 | 1, focusedPaneId: string, settledAt: number) => ({
  dir,
  focusedPaneId,
  settledAt,
});

describe("resolveTabEntry", () => {
  it("records the direction an incoming Tab was entered from", () => {
    expect(resolveTabEntry(null, 1, "p1", 0)).toEqual({
      dir: 1,
      focusedPaneId: "p1",
      settledAt: 0,
    });
    expect(resolveTabEntry(null, -1, "p1", 400)).toEqual({
      dir: -1,
      focusedPaneId: "p1",
      settledAt: 400,
    });
  });

  it("keeps the entry through the commits that follow activation", () => {
    // A Tab gains its real size and may change Columns right after activating;
    // reveal re-runs each time and must still see the entry.
    const first = resolveTabEntry(null, -1, "p1", 0);
    const second = resolveTabEntry(first, undefined, "p1", 0);
    expect(second).toEqual({ dir: -1, focusedPaneId: "p1", settledAt: 0 });
  });

  it("has no entry for a Tab that was never entered", () => {
    expect(resolveTabEntry(null, undefined, "p1", 0)).toBeNull();
  });

  it("has no entry once it has been consumed", () => {
    expect(resolveTabEntry(null, undefined, "p1", 0)).toBeNull();
  });
});

describe("shouldHoldTabEntry", () => {
  it("holds while the Viewport still sits where the entry left it", () => {
    expect(shouldHoldTabEntry(entry(1, "p1", 0), "p1", 0)).toBe(true);
  });

  it("yields once the Viewport moves away, which is the user scrolling", () => {
    // The entry left the Viewport at 0; the user has since scrolled to 180.
    expect(shouldHoldTabEntry(entry(1, "p1", 0), "p1", 180)).toBe(false);
  });

  it("tolerates sub-pixel drift", () => {
    expect(shouldHoldTabEntry(entry(1, "p1", 100), "p1", 100.4)).toBe(true);
  });

  it("yields when the user focuses another Pane", () => {
    expect(shouldHoldTabEntry(entry(1, "p1", 0), "p2", 0)).toBe(false);
  });

  it("holds nothing without an entry", () => {
    expect(shouldHoldTabEntry(null, "p1", 0)).toBe(false);
  });
});
