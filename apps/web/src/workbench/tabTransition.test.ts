import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_CLIENT_SETTINGS } from "@awen/contracts/settings";
import { __setClientSettingsForTests } from "../hooks/useSettings";

import {
  animateTabTransitionTo,
  beginTabTransition,
  computeCardOffset,
  deriveTabDirection,
  endTabTransition,
  getTabTransition,
  getTabTransitionFrame,
  nextTabIndex,
  resetTabTransitionForTest,
  retargetTabTransition,
  resolveSwitchCommit,
  setTabTransitionPosition,
  setTabTransitionProgress,
  subscribeTabTransition,
  subscribeTabTransitionFrame,
  tabIdsKey,
} from "./tabTransition";

afterEach(() => {
  resetTabTransitionForTest();
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("computeCardOffset", () => {
  it("keeps the source card at rest and the target off-screen at progress 0", () => {
    // dir +1 (next): source slot -1, target slot 0.
    expect(computeCardOffset(-1, 1, 0)).toBeCloseTo(0, 6);
    expect(computeCardOffset(0, 1, 0)).toBeCloseTo(1, 6);
  });

  it("lands the target at rest and pushes the source off-screen at progress 1", () => {
    expect(computeCardOffset(-1, 1, 1)).toBeCloseTo(-1, 6);
    expect(computeCardOffset(0, 1, 1)).toBeCloseTo(0, 6);
  });

  it("mirrors for a previous switch", () => {
    expect(computeCardOffset(1, -1, 0)).toBeCloseTo(0, 6);
    expect(computeCardOffset(0, -1, 0)).toBeCloseTo(-1, 6);
  });
});

describe("tab order helpers", () => {
  it("builds a stable ordered key for a Tab list", () => {
    expect(tabIdsKey([{ id: "a" }, { id: "b" }])).toBe(tabIdsKey([{ id: "a" }, { id: "b" }]));
    expect(tabIdsKey([{ id: "a" }, { id: "b" }])).not.toBe(tabIdsKey([{ id: "b" }, { id: "a" }]));
    expect(tabIdsKey([])).toBe("");
  });

  it("derives signed direction between indices", () => {
    expect(deriveTabDirection(0, 2)).toBe(1);
    expect(deriveTabDirection(2, 0)).toBe(-1);
    expect(deriveTabDirection(1, 1)).toBe(0);
  });

  it("wraps next and previous indices cyclically", () => {
    expect(nextTabIndex(3, 2, 1)).toBe(0);
    expect(nextTabIndex(3, 0, -1)).toBe(2);
    expect(nextTabIndex(0, 0, 1)).toBe(-1);
  });
});

describe("resolveSwitchCommit", () => {
  it("commits past halfway regardless of velocity", () => {
    expect(resolveSwitchCommit({ progress: 0.6, velocity: 0, dir: 1 })).toBe(true);
    expect(resolveSwitchCommit({ progress: 0.4, velocity: 0, dir: 1 })).toBe(false);
  });

  it("commits a directional flick below halfway", () => {
    // next (dir +1) is dragged left, so a fast negative velocity commits.
    expect(resolveSwitchCommit({ progress: 0.2, velocity: -0.5, dir: 1 })).toBe(true);
    // a flick in the opposite direction does not.
    expect(resolveSwitchCommit({ progress: 0.2, velocity: 0.5, dir: 1 })).toBe(false);
    expect(resolveSwitchCommit({ progress: 0.2, velocity: 0.5, dir: -1 })).toBe(true);
  });
});

describe("tab transition store", () => {
  it("keeps next navigation moving forward when the Tab order wraps", () => {
    beginTabTransition({ fromTabId: "a", toTabId: "b", fromIndex: 0, toIndex: 1, dir: 1 });
    setTabTransitionPosition(0.4);
    retargetTabTransition({ fromTabId: "b", toTabId: "c", fromIndex: 1, toIndex: 2, dir: 1 });
    retargetTabTransition({ fromTabId: "c", toTabId: "a", fromIndex: 2, toIndex: 0, dir: 1 });
    expect(getTabTransitionFrame()?.destinationSlot).toBe(3);
    expect(getTabTransitionFrame()?.cards.find((card) => card.tabId === "a")?.slot).toBe(0);
    setTabTransitionPosition(1.5);
    expect(getTabTransitionFrame()?.cards.find((card) => card.tabId === "a")?.slot).toBe(3);
    expect(getTabTransitionFrame()?.position).toBe(1.5);
  });

  it("tracks state, progress, and notifies subscribers", () => {
    const states: Array<unknown> = [];
    const frames: Array<unknown> = [];
    subscribeTabTransition((state) => states.push(state));
    subscribeTabTransitionFrame((frame) => frames.push(frame));

    beginTabTransition({ fromTabId: "a", toTabId: "b", fromIndex: 0, toIndex: 1, dir: 1 });
    expect(getTabTransition()).toEqual({
      fromTabId: "a",
      toTabId: "b",
      fromIndex: 0,
      toIndex: 1,
      dir: 1,
    });
    expect(getTabTransitionFrame()?.progress).toBe(0);

    setTabTransitionProgress(0.5);
    expect(getTabTransitionFrame()?.progress).toBe(0.5);

    endTabTransition();
    expect(getTabTransition()).toBeNull();
    expect(getTabTransitionFrame()).toBeNull();
    expect(states.at(-1)).toBeNull();
    expect(frames.at(-1)).toBeNull();
  });

  it("ignores progress without an active transition", () => {
    setTabTransitionProgress(0.5);
    expect(getTabTransitionFrame()).toBeNull();
  });

  it("settles to the commit target and clears the transition", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      return setTimeout(() => callback(performance.now()), 0) as unknown as number;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => clearTimeout(handle));
    beginTabTransition({ fromTabId: "a", toTabId: "b", fromIndex: 0, toIndex: 1, dir: 1 });
    const done = animateTabTransitionTo(1);
    await vi.waitFor(() => expect(getTabTransition()).toBeNull());
    expect(getTabTransitionFrame()).toBeNull();
    done();
  });

  it("clears immediately under reduced motion", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    beginTabTransition({ fromTabId: "a", toTabId: "b", fromIndex: 0, toIndex: 1, dir: 1 });
    animateTabTransitionTo(1);
    expect(getTabTransition()).toBeNull();
  });

  it("settles a released trackpad preview at the default animation speed", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal("document", {
      querySelector: () => ({ getAttribute: () => "false" }),
    });
    const requestFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    beginTabTransition({ fromTabId: "a", toTabId: "b", fromIndex: 0, toIndex: 1, dir: 1 });
    setTabTransitionProgress(0.4);
    animateTabTransitionTo(1);
    expect(getTabTransitionFrame()?.position).toBeCloseTo(0.4);
    expect(requestFrame).toHaveBeenCalled();
  });

  it("settles a Tab more slowly at 2× than at 1×", () => {
    let now = 0;
    let handle = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++handle, callback);
      return handle;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const positionAfter100ms = (animationDurationScale: number) => {
      now = 0;
      frames.clear();
      __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, animationDurationScale });
      beginTabTransition({ fromTabId: "a", toTabId: "b", fromIndex: 0, toIndex: 1, dir: 1 });
      animateTabTransitionTo(1);
      now = 100;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(now));
      const position = getTabTransitionFrame()?.position ?? 1;
      endTabTransition();
      return position;
    };
    expect(positionAfter100ms(1)).toBeGreaterThan(positionAfter100ms(2));
  });
});

it("a new gesture cancels the previous settle even when its caller keeps no handle", () => {
  let time = 0;
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => frames.delete(handle));
  beginTabTransition({ fromTabId: "a", toTabId: "b", fromIndex: 0, toIndex: 1, dir: 1 });
  animateTabTransitionTo(1);
  beginTabTransition({ fromTabId: "b", toTabId: "c", fromIndex: 1, toIndex: 2, dir: 1 }, 0.2);
  time = 400;
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(time);
  expect(getTabTransitionFrame()).toMatchObject({ toTabId: "c", progress: 0.2 });
  vi.restoreAllMocks();
});
