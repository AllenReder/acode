import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useTabSwitchGesture } from "./useTabSwitchGesture";
import { useTabSwitchWheel } from "./useTabSwitchWheel";
import { TabTransitionController } from "./tabTransitionReact";
import { getTabTransitionFrame, resetTabTransitionForTest } from "./tabTransition";
import { emptyWorkbenchSnapshot, applyCreateTab } from "./workbenchState";
import { resetWorkbenchStore, useWorkbenchStore } from "./workbenchStore";

vi.mock("../contextMenuFallback", () => ({ dismissContextMenu: vi.fn() }));

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
        shiftKey: false,
        ctrlKey: false,
      });
  });
  expect(useWorkbenchStore.getState().activeTabId).toBe(tabs[1]!.id);
  expect(getTabTransitionFrame()).toBeNull();
});
