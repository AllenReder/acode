import type { ReactElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { PaneTree } from "./PaneTree";
import { beginTabTransition, endTabTransition, resetTabTransitionForTest } from "./tabTransition";
import { clearViewRegistry } from "./viewRegistry";
import { applyCreateTab, emptyWorkbenchSnapshot } from "./workbenchState";
import { resetWorkbenchStore, useWorkbenchStore } from "./workbenchStore";

let renderer: ReactTestRenderer | undefined;

interface FlipAnimation {
  readonly tabId: string;
  readonly from: string;
  readonly to: string;
}

/** Horizontal shift, in px, applied to a tab's pane frames to simulate motion. */
const frameShiftByTab = new Map<string, number>();
const flips: FlipAnimation[] = [];

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  frameShiftByTab.clear();
  flips.length = 0;
  resetTabTransitionForTest();
  resetWorkbenchStore();
  clearViewRegistry();
  vi.unstubAllGlobals();
});

function Harness() {
  return <PaneTree snapshot={useWorkbenchStore()} />;
}

function makeFrameMock(tabId: string) {
  return {
    querySelector: (selector: string) =>
      selector === "[data-view-instance-id]"
        ? { dataset: { viewInstanceId: `view-${tabId}` } }
        : null,
    getBoundingClientRect: () => ({
      left: 100 + (frameShiftByTab.get(tabId) ?? 0),
      top: 50,
      width: 600,
      height: 400,
    }),
    getAnimations: () => [],
    animate: (keyframes: ReadonlyArray<{ transform?: string }>) => {
      flips.push({
        tabId,
        from: String(keyframes[0]?.transform ?? ""),
        to: String(keyframes[1]?.transform ?? ""),
      });
      return {};
    },
  };
}

function makeViewportMock(tabId: string) {
  const frame = makeFrameMock(tabId);
  return {
    style: {},
    dataset: {},
    clientWidth: 600,
    clientHeight: 400,
    scrollWidth: 600,
    scrollLeft: 0,
    scrollTop: 0,
    querySelectorAll: (selector: string) => (selector === ".workbench-pane-frame" ? [frame] : []),
    querySelector: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 400 }),
    addEventListener() {},
    removeEventListener() {},
    contains: () => true,
    focus() {},
  };
}

const genericMock = {
  style: {},
  dataset: {},
  clientWidth: 600,
  clientHeight: 400,
  scrollWidth: 600,
  scrollLeft: 0,
  scrollTop: 0,
  querySelectorAll: () => [],
  querySelector: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 400 }),
  addEventListener() {},
  removeEventListener() {},
  contains: () => true,
  focus() {},
};

function nodeMock(element: ReactElement) {
  const props = element.props as Record<string, unknown>;
  const className = String(props.className ?? "");
  const tabId = props["data-tab-id"] as string | undefined;
  if (className === "workbench-viewport" && tabId) return makeViewportMock(tabId);
  return genericMock;
}

function stubEnvironment() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("document", { documentElement: { dataset: {} }, activeElement: null });
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    removeEventListener() {},
    getSelection: () => null,
  });
}

async function renderTwoTabs() {
  let n = 0;
  const ids = () => `id-${++n}`;
  const snapshot = applyCreateTab(emptyWorkbenchSnapshot(ids), ids);
  const [first, second] = snapshot.tabs;
  useWorkbenchStore.setState({ ...snapshot, focusRequestId: 0 });
  await act(() => {
    renderer = create(<Harness />, { createNodeMock: nodeMock });
  });
  // `applyCreateTab` activates the newest Tab; make the first Tab the source so
  // each test's `second` is a real switch target.
  await act(() => useWorkbenchStore.getState().activateTab(first!.id));
  return { first: first!, second: second! };
}

it("does not FLIP pane frames when a Tab becomes active during a Sliding Tab switch", async () => {
  stubEnvironment();
  const { first, second } = await renderTwoTabs();

  // Give the target Tab a settled FLIP baseline, then make the source active again.
  await act(() => useWorkbenchStore.getState().activateTab(second.id));
  await act(() => useWorkbenchStore.getState().activateTab(first.id));

  // The target sits off-screen under the switch's strip transform.
  frameShiftByTab.set(second.id, 600);
  await act(() =>
    beginTabTransition({
      fromTabId: first.id,
      toTabId: second.id,
      fromIndex: 0,
      toIndex: 1,
      dir: 1,
    }),
  );

  flips.length = 0;
  await act(() => useWorkbenchStore.getState().activateTab(second.id));

  expect(flips).toEqual([]);
});

it("does not FLIP pane frames on a plain Tab activation", async () => {
  stubEnvironment();
  const { first, second } = await renderTwoTabs();

  await act(() => useWorkbenchStore.getState().activateTab(second.id));
  flips.length = 0;
  await act(() => useWorkbenchStore.getState().activateTab(first.id));

  expect(flips).toEqual([]);
});

it("FLIPs a real layout change after a Sliding Tab switch settles", async () => {
  stubEnvironment();
  const { first, second } = await renderTwoTabs();

  frameShiftByTab.set(second.id, 600);
  await act(() =>
    beginTabTransition({
      fromTabId: first.id,
      toTabId: second.id,
      fromIndex: 0,
      toIndex: 1,
      dir: 1,
    }),
  );
  await act(() => useWorkbenchStore.getState().activateTab(second.id));
  // The settle lands the card back at rest.
  frameShiftByTab.set(second.id, 0);
  await act(() => endTabTransition());
  flips.length = 0;

  // A genuine layout change on the now-active Tab must still animate — and it
  // must animate only the real delta, proving the switch offset never entered
  // the FLIP baseline.
  frameShiftByTab.set(second.id, 30);
  await act(() => useWorkbenchStore.getState().setLayoutMode("scrolling"));
  await act(() => useWorkbenchStore.getState().setLayoutMode("bsp"));

  expect(flips).toEqual([{ tabId: second.id, from: "translate(-30px,0px)", to: "translate(0,0)" }]);
});

it("does not FLIP the source Tab when a Sliding Tab switch is abandoned", async () => {
  stubEnvironment();
  const { first, second } = await renderTwoTabs();

  await act(() =>
    beginTabTransition({
      fromTabId: first.id,
      toTabId: second.id,
      fromIndex: 0,
      toIndex: 1,
      dir: 1,
    }),
  );
  // Cancel returns the source to rest; the transition ends without activating.
  frameShiftByTab.set(first.id, 0);
  await act(() => endTabTransition());
  flips.length = 0;

  // The source stays active and its baseline is intact for a real layout change.
  frameShiftByTab.set(first.id, 25);
  await act(() => useWorkbenchStore.getState().setLayoutMode("scrolling"));
  await act(() => useWorkbenchStore.getState().setLayoutMode("bsp"));

  expect(flips).toEqual([{ tabId: first.id, from: "translate(-25px,0px)", to: "translate(0,0)" }]);
});
