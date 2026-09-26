import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useTabSwitchGesture } from "./useTabSwitchGesture";
import { useTabSwitchWheel } from "./useTabSwitchWheel";
import { TabTransitionController } from "./tabTransitionReact";
import { getTabTransitionFrame, resetTabTransitionForTest } from "./tabTransition";
import { emptyWorkbenchSnapshot, applyCreateTab } from "./workbenchState";
import { resetWorkbenchStore, useWorkbenchStore } from "./workbenchStore";

vi.mock("../contextMenuFallback", () => ({ dismissContextMenu: vi.fn() }));
let nativePhase: ((event: { payload: { phase: string; momentumPhase: string } }) => void) | null =
  null;
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_name: string, listener: typeof nativePhase) => {
    nativePhase = listener;
    return () => {
      nativePhase = null;
    };
  },
}));

class Surface extends EventTarget {
  clientWidth = 800;
  scrollWidth = 800;
  scrollLeft = 0;
  parentElement: Surface | null = null;
  dataset: Record<string, string> = {};
  contains() {
    return true;
  }
  closest() {
    return null;
  }
  querySelector() {
    return viewport;
  }
}
let viewport: Surface;
let stage: Surface;
let windowEvents: EventTarget;
let renderer: ReactTestRenderer;
let now: number;
let frames: Map<number, FrameRequestCallback>;
let reduced: boolean;
const menu = vi.fn();
function Probe() {
  const ref = { current: stage as unknown as HTMLElement };
  useTabSwitchGesture({ stageRef: ref, onPaneContextMenu: menu });
  useTabSwitchWheel(ref);
  return <TabTransitionController />;
}
function event(target: EventTarget, name: string, values: Record<string, unknown>) {
  const input = new Event(name, { cancelable: true });
  for (const [key, value] of Object.entries(values)) Object.defineProperty(input, key, { value });
  target.dispatchEvent(input);
  return input;
}
async function actEvent(run: () => Event) {
  await act(() => {
    run();
  });
}
function pointer(name: string, x: number) {
  event(name === "pointerdown" ? stage : windowEvents, name, {
    pointerId: 1,
    button: 2,
    clientX: x,
    clientY: 0,
  });
}
async function mount(count = 2) {
  let i = 0;
  const ids = () => `nav-${++i}`;
  let state = emptyWorkbenchSnapshot(ids);
  for (let index = 1; index < count; index++) state = applyCreateTab(state, ids);
  useWorkbenchStore.setState(state);
  await act(() => {
    renderer = create(<Probe />);
  });
}
async function settle() {
  now += 400;
  await act(() => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(now);
  });
}
beforeEach(() => {
  now = 0;
  reduced = false;
  frames = new Map();
  stage = new Surface();
  viewport = new Surface();
  viewport.parentElement = stage;
  viewport.dataset.layoutMode = "bsp";
  windowEvents = Object.assign(new EventTarget(), { matchMedia: () => ({ matches: reduced }) });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", windowEvents);
  vi.stubGlobal("document", {});
  vi.stubGlobal("Element", Surface);
  vi.stubGlobal("getComputedStyle", () => ({ overflowX: "auto" }));
  vi.spyOn(performance, "now").mockImplementation(() => now);
  let handle = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++handle, callback);
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  resetTabTransitionForTest();
  resetWorkbenchStore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  nativePhase = null;
});
it("pans a single Scrolling Tab without trying to switch", async () => {
  viewport.dataset.layoutMode = "scrolling";
  viewport.scrollWidth = 1200;
  await mount(1);
  await act(() => {
    pointer("pointerdown", 500);
    now = 10;
    pointer("pointermove", 400);
  });
  expect(viewport.scrollLeft).toBe(100);
  expect(getTabTransitionFrame()).toBeNull();
});
it("cancels below-halfway travel when the pointer pauses before release", async () => {
  await mount();
  const active = useWorkbenchStore.getState().activeTabId;
  await act(() => {
    pointer("pointerdown", 500);
    now = 10;
    pointer("pointermove", 400);
  });
  now = 1010;
  await act(() => pointer("pointerup", 400));
  await settle();
  expect(useWorkbenchStore.getState().activeTabId).toBe(active);
  expect(getTabTransitionFrame()).toBeNull();
});
it.each(["pointercancel", "blur", "Escape"])(
  "%s never commits a gesture beyond halfway",
  async (cancel) => {
    await mount();
    const active = useWorkbenchStore.getState().activeTabId;
    await act(() => {
      pointer("pointerdown", 700);
      now = 10;
      pointer("pointermove", 100);
    });
    await act(() => {
      if (cancel === "Escape") event(windowEvents, "keydown", { key: "Escape" });
      else event(windowEvents, cancel, { pointerId: 1 });
    });
    await settle();
    expect(useWorkbenchStore.getState().activeTabId).toBe(active);
  },
);
it("an interrupted gesture settle cannot end a later click transition", async () => {
  await mount(3);
  const tabs = useWorkbenchStore.getState().tabs;
  await act(() => {
    pointer("pointerdown", 700);
    now = 10;
    pointer("pointermove", 100);
    pointer("pointerup", 100);
  });
  now = 200;
  await act(() => useWorkbenchStore.getState().activateTab(tabs[1]!.id));
  now = 360;
  await act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(now));
  });
  expect(getTabTransitionFrame()?.toTabId).toBe(tabs[1]!.id);
});
it("keeps a Tab settle running when the next trackpad gesture scrolls content", async () => {
  Object.assign(windowEvents, { desktopBridge: {} });
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  const inner = new Surface();
  inner.scrollWidth = 1200;
  inner.parentElement = viewport;
  await mount(2);
  const target = useWorkbenchStore.getState().tabs[0]!.id;
  await act(() => useWorkbenchStore.getState().activateTab(target));
  now = 100;
  await act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(now));
  });
  expect(getTabTransitionFrame()).not.toBeNull();
  nativePhase!({ payload: { phase: "began", momentumPhase: "none" } });
  const wheel = event(stage, "wheel", {
    target: inner,
    deltaX: 30,
    deltaY: 0,
    deltaMode: 0,
    shiftKey: false,
    ctrlKey: false,
  });
  expect(wheel.defaultPrevented).toBe(false);
  await settle();
  expect(getTabTransitionFrame()).toBeNull();
});

it("a new right drag takes over the visible position of a settling Tab", async () => {
  await mount(2);
  await act(() => {
    pointer("pointerdown", 700);
    now = 10;
    pointer("pointermove", 100);
    pointer("pointerup", 100);
  });
  now = 100;
  await act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(now));
  });
  const before = getTabTransitionFrame()!.position;
  await act(() => pointer("pointerdown", 400));
  expect(getTabTransitionFrame()!.position).toBeCloseTo(before);
  await act(() => pointer("pointermove", 420));
  const after = getTabTransitionFrame()!.position;
  expect(after).toBeLessThan(before);
  expect(after).toBeGreaterThan(0);
});
it("routes Shift+wheel through inner scroller, layout, then cyclic Tab navigation", async () => {
  viewport.dataset.layoutMode = "scrolling";
  viewport.scrollWidth = 1000;
  const inner = new Surface();
  inner.scrollWidth = 900;
  inner.parentElement = viewport;
  await mount(3);
  const tabs = useWorkbenchStore.getState().tabs;
  const wheel = () =>
    event(stage, "wheel", {
      target: inner,
      deltaX: 0,
      deltaY: 100,
      deltaMode: 0,
      shiftKey: true,
      ctrlKey: false,
    });
  await act(() => {
    wheel();
  });
  expect(inner.scrollLeft).toBe(100);
  expect(viewport.scrollLeft).toBe(0);
  expect(useWorkbenchStore.getState().activeTabId).toBe(tabs[2]!.id);
  await act(() => {
    wheel();
    wheel();
  });
  expect(viewport.scrollLeft).toBe(200);
  await act(() => {
    wheel();
  });
  expect(getTabTransitionFrame()).toMatchObject({ toTabId: tabs[0]!.id, dir: 1 });
  await act(() => {
    wheel();
  });
  await settle();
  expect(getTabTransitionFrame()).toMatchObject({ toTabId: tabs[1]!.id, dir: 1 });
});
it("does not turn a macOS-style stream of unmodified deltas into Tab switches", async () => {
  await mount(3);
  const tabs = useWorkbenchStore.getState().tabs;
  const initialActive = useWorkbenchStore.getState().activeTabId;
  for (let index = 0; index < 40; index++) {
    await act(() => {
      event(stage, "wheel", {
        target: stage,
        deltaX: 15,
        deltaY: 0,
        deltaMode: 0,
        shiftKey: false,
        ctrlKey: false,
      });
    });
  }
  expect(useWorkbenchStore.getState().activeTabId).toBe(initialActive);
  expect(getTabTransitionFrame()).toBeNull();
});

it("lets a macOS trackpad preview reverse before release and swallows its momentum", async () => {
  Object.assign(windowEvents, { desktopBridge: {} });
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  await mount(3);
  const active = useWorkbenchStore.getState().activeTabId;
  const wheel = (deltaX: number) =>
    event(stage, "wheel", {
      target: stage,
      deltaX,
      deltaY: 0,
      deltaMode: 0,
      shiftKey: false,
      ctrlKey: false,
    });
  nativePhase!({ payload: { phase: "began", momentumPhase: "none" } });
  await act(() => {
    wheel(80);
    wheel(-60);
  });
  expect(getTabTransitionFrame()?.progress).toBeCloseTo(20 / 360);
  nativePhase!({ payload: { phase: "ended", momentumPhase: "none" } });
  expect(useWorkbenchStore.getState().activeTabId).toBe(active);
  await actEvent(() => wheel(200));
  expect(useWorkbenchStore.getState().activeTabId).toBe(active);
});

it("returns a paused trackpad swipe below 20% travel to its source Tab", async () => {
  Object.assign(windowEvents, { desktopBridge: {} });
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  await mount(2);
  const active = useWorkbenchStore.getState().activeTabId;
  nativePhase!({ payload: { phase: "began", momentumPhase: "none" } });
  now = 10;
  await actEvent(() =>
    event(stage, "wheel", {
      target: stage,
      deltaX: 60,
      deltaY: 0,
      deltaMode: 0,
      shiftKey: false,
      ctrlKey: false,
    }),
  );
  expect(getTabTransitionFrame()?.progress).toBeCloseTo(60 / 360);
  now = 300;
  nativePhase!({ payload: { phase: "ended", momentumPhase: "none" } });
  expect(useWorkbenchStore.getState().activeTabId).toBe(active);
});

it("commits a paused trackpad swipe after 20% travel", async () => {
  Object.assign(windowEvents, { desktopBridge: {} });
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  await mount(2);
  const target = useWorkbenchStore.getState().tabs[0]!.id;
  nativePhase!({ payload: { phase: "began", momentumPhase: "none" } });
  now = 10;
  await actEvent(() =>
    event(stage, "wheel", {
      target: stage,
      deltaX: 80,
      deltaY: 0,
      deltaMode: 0,
      shiftKey: false,
      ctrlKey: false,
    }),
  );
  expect(getTabTransitionFrame()?.progress).toBeCloseTo(80 / 360);
  now = 300;
  nativePhase!({ payload: { phase: "ended", momentumPhase: "none" } });
  expect(useWorkbenchStore.getState().activeTabId).toBe(target);
});

it("commits a short, fast directional trackpad flick before halfway", async () => {
  Object.assign(windowEvents, { desktopBridge: {} });
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  await mount(2);
  const target = useWorkbenchStore.getState().tabs[0]!.id;
  nativePhase!({ payload: { phase: "began", momentumPhase: "none" } });
  now = 10;
  await actEvent(() =>
    event(stage, "wheel", {
      target: stage,
      deltaX: 40,
      deltaY: 0,
      deltaMode: 0,
      shiftKey: false,
      ctrlKey: false,
    }),
  );
  expect(getTabTransitionFrame()?.progress).toBeCloseTo(40 / 360);
  nativePhase!({ payload: { phase: "ended", momentumPhase: "none" } });
  expect(useWorkbenchStore.getState().activeTabId).toBe(target);
});

it("commits one trackpad switch when direct input ends despite a long momentum tail", async () => {
  Object.assign(windowEvents, { desktopBridge: {} });
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  await mount(3);
  const tabs = useWorkbenchStore.getState().tabs;
  const wheel = () =>
    event(stage, "wheel", {
      target: stage,
      deltaX: 20,
      deltaY: 0,
      deltaMode: 0,
      shiftKey: false,
      ctrlKey: false,
    });
  nativePhase!({ payload: { phase: "began", momentumPhase: "none" } });
  await act(() => {
    for (let index = 0; index < 10; index++) wheel();
  });
  nativePhase!({ payload: { phase: "ended", momentumPhase: "none" } });
  expect(useWorkbenchStore.getState().activeTabId).toBe(tabs[0]!.id);
  await act(() => {
    for (let index = 0; index < 100; index++) wheel();
  });
  expect(useWorkbenchStore.getState().activeTabId).toBe(tabs[0]!.id);
  await actEvent(() =>
    event(stage, "wheel", {
      target: stage,
      deltaX: 100,
      deltaY: 0,
      deltaMode: 0,
      shiftKey: true,
      ctrlKey: false,
    }),
  );
  expect(useWorkbenchStore.getState().activeTabId).toBe(tabs[1]!.id);
  nativePhase!({ payload: { phase: "none", momentumPhase: "ended" } });
});

it("holds content scroll ownership at the boundary until the next trackpad gesture", async () => {
  Object.assign(windowEvents, { desktopBridge: {} });
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  const inner = new Surface();
  inner.scrollWidth = 850;
  inner.parentElement = viewport;
  await mount(2);
  const active = useWorkbenchStore.getState().activeTabId;
  const wheel = (deltaX: number) => {
    const input = event(stage, "wheel", {
      target: inner,
      deltaX,
      deltaY: 0,
      deltaMode: 0,
      shiftKey: false,
      ctrlKey: false,
    });
    if (!input.defaultPrevented) {
      inner.scrollLeft = Math.max(
        0,
        Math.min(inner.scrollWidth - inner.clientWidth, inner.scrollLeft + deltaX),
      );
    }
    return input;
  };
  nativePhase!({ payload: { phase: "began", momentumPhase: "none" } });
  await actEvent(() => wheel(100));
  expect(inner.scrollLeft).toBe(50);
  expect(getTabTransitionFrame()).toBeNull();
  await actEvent(() => wheel(100));
  expect(getTabTransitionFrame()).toBeNull();
  nativePhase!({ payload: { phase: "ended", momentumPhase: "none" } });
  nativePhase!({ payload: { phase: "began", momentumPhase: "none" } });
  await actEvent(() => wheel(50));
  expect(getTabTransitionFrame()?.progress).toBeCloseTo(50 / 360);
  await actEvent(() => wheel(-100));
  expect(getTabTransitionFrame()).toBeNull();
  expect(inner.scrollLeft).toBe(0);
  expect(useWorkbenchStore.getState().activeTabId).toBe(active);
});

it("keeps a reversed Tab preview in the same gesture even with no leftover travel", async () => {
  Object.assign(windowEvents, { desktopBridge: {} });
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  await mount(3);
  const wheel = (deltaX: number) =>
    event(stage, "wheel", {
      target: stage,
      deltaX,
      deltaY: 0,
      deltaMode: 0,
      shiftKey: false,
      ctrlKey: false,
    });
  nativePhase!({ payload: { phase: "began", momentumPhase: "none" } });
  await actEvent(() => wheel(50));
  await actEvent(() => wheel(-50));
  expect(getTabTransitionFrame()).toBeNull();
  await actEvent(() => wheel(-50));
  expect(getTabTransitionFrame()).toBeNull();
});

it("keeps content momentum scrolling when the gesture never reaches a Tab", async () => {
  Object.assign(windowEvents, { desktopBridge: {} });
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  const inner = new Surface();
  inner.scrollWidth = 1200;
  inner.parentElement = viewport;
  await mount(2);
  const wheel = () => {
    const input = event(stage, "wheel", {
      target: inner,
      deltaX: 30,
      deltaY: 0,
      deltaMode: 0,
      shiftKey: false,
      ctrlKey: false,
    });
    if (!input.defaultPrevented) inner.scrollLeft += 30;
    return input;
  };
  nativePhase!({ payload: { phase: "began", momentumPhase: "none" } });
  await actEvent(() => wheel());
  nativePhase!({ payload: { phase: "ended", momentumPhase: "none" } });
  await actEvent(() => wheel());
  expect(inner.scrollLeft).toBe(60);
  expect(getTabTransitionFrame()).toBeNull();
});

it("leaves Scrolling layout direct and momentum wheel events to native scrolling", async () => {
  Object.assign(windowEvents, { desktopBridge: {} });
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  viewport.dataset.layoutMode = "scrolling";
  viewport.scrollWidth = 1200;
  await mount(2);
  const wheel = () =>
    event(stage, "wheel", {
      target: viewport,
      deltaX: 30,
      deltaY: 0,
      deltaMode: 0,
      shiftKey: false,
      ctrlKey: false,
    });
  nativePhase!({ payload: { phase: "began", momentumPhase: "none" } });
  const direct = wheel();
  expect(direct.defaultPrevented).toBe(false);
  viewport.scrollLeft = 30; // The WebView's native default action.
  nativePhase!({ payload: { phase: "ended", momentumPhase: "none" } });
  nativePhase!({ payload: { phase: "none", momentumPhase: "changed" } });
  const momentum = wheel();
  expect(momentum.defaultPrevented).toBe(false);
  viewport.scrollLeft = viewport.scrollWidth - viewport.clientWidth;
  const atBoundary = wheel();
  expect(atBoundary.defaultPrevented).toBe(false);
  expect(getTabTransitionFrame()).toBeNull();
});
it("drains queued wheel switches with reduced motion without a timeout", async () => {
  reduced = true;
  await mount(3);
  const tabs = useWorkbenchStore.getState().tabs;
  await act(() => {
    for (let i = 0; i < 2; i++)
      event(stage, "wheel", {
        deltaX: 100,
        deltaY: 0,
        deltaMode: 0,
        shiftKey: true,
        ctrlKey: false,
      });
  });
  expect(useWorkbenchStore.getState().activeTabId).toBe(tabs[1]!.id);
  expect(getTabTransitionFrame()).toBeNull();
});
it("retargets immediately for every discrete Shift+wheel notch", async () => {
  await mount(3);
  const tabs = useWorkbenchStore.getState().tabs;
  const wheel = () =>
    event(stage, "wheel", {
      deltaX: 100,
      deltaY: 0,
      deltaMode: 0,
      shiftKey: true,
      ctrlKey: false,
    });
  // Ten notches from the last of three Tabs lands at the first Tab.
  await act(() => {
    for (let index = 0; index < 10; index++) wheel();
  });
  expect(useWorkbenchStore.getState().activeTabId).toBe(tabs[0]!.id);
  expect(getTabTransitionFrame()).toMatchObject({ toTabId: tabs[0]!.id, dir: 1 });
  await settle();
  expect(getTabTransitionFrame()).toBeNull();
  expect(useWorkbenchStore.getState().activeTabId).toBe(tabs[0]!.id);
});
