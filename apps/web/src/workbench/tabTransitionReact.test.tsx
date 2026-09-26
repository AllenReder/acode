import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

import {
  getTabTransition,
  getTabTransitionFrame,
  resetTabTransitionForTest,
  setTabTransitionProgress,
} from "./tabTransition";
import { TabTransitionController } from "./tabTransitionReact";
import { applyCreateTab, emptyWorkbenchSnapshot } from "./workbenchState";
import { resetWorkbenchStore, useWorkbenchStore } from "./workbenchStore";

let renderer: ReactTestRenderer | undefined;

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  resetTabTransitionForTest();
  resetWorkbenchStore();
  vi.unstubAllGlobals();
});

function seedTwoTabs() {
  let n = 0;
  const ids = () => `id-${++n}`;
  const snapshot = applyCreateTab(emptyWorkbenchSnapshot(ids), ids);
  useWorkbenchStore.setState({ ...snapshot, focusRequestId: 0 });
  return useWorkbenchStore.getState().tabs;
}

it("starts a Sliding Tab switch for a plain activation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const tabs = seedTwoTabs();
  const [first, second] = tabs;
  expect(second).toBeDefined();

  await act(() => {
    renderer = create(<TabTransitionController />);
  });
  expect(getTabTransition()).toBeNull();

  await act(() => {
    useWorkbenchStore.getState().activateTab(first!.id);
  });

  const transition = getTabTransition();
  expect(transition?.fromTabId).toBe(second!.id);
  expect(transition?.toTabId).toBe(first!.id);
  expect(transition?.fromIndex).toBe(1);
  expect(transition?.toIndex).toBe(0);
  expect(transition?.dir).toBe(-1);
});

it("lands instantly when a Tab is created", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  seedTwoTabs();
  await act(() => {
    renderer = create(<TabTransitionController />);
  });
  await act(() => {
    useWorkbenchStore.getState().createTab();
  });
  expect(getTabTransition()).toBeNull();
});

it("lands instantly under reduced motion", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
  const tabs = seedTwoTabs();
  await act(() => {
    renderer = create(<TabTransitionController />);
  });
  await act(() => {
    useWorkbenchStore.getState().activateTab(tabs[0]!.id);
  });
  expect(getTabTransition()).toBeNull();
});

it("keeps click Tab motion when panel animations are set to zero", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  vi.stubGlobal("document", {
    querySelector: () => ({ getAttribute: () => "false" }),
  });
  const tabs = seedTwoTabs();
  await act(() => {
    renderer = create(<TabTransitionController />);
  });
  await act(() => useWorkbenchStore.getState().activateTab(tabs[0]!.id));
  expect(getTabTransitionFrame()?.toTabId).toBe(tabs[0]!.id);
});

it("keeps visible cards in place when a third Tab becomes the latest target", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let n = 0;
  const ids = () => `retarget-${++n}`;
  const snapshot = applyCreateTab(applyCreateTab(emptyWorkbenchSnapshot(ids), ids), ids);
  const [a, b, c] = snapshot.tabs;
  useWorkbenchStore.setState({ ...snapshot, activeTabId: a!.id, focusRequestId: 0 });
  await act(() => {
    renderer = create(<TabTransitionController />);
  });
  await act(() => useWorkbenchStore.getState().activateTab(b!.id));
  await act(() => setTabTransitionProgress(0.4));
  const before = getTabTransitionFrame()!;
  await act(() => useWorkbenchStore.getState().activateTab(c!.id));
  const after = getTabTransitionFrame()!;
  expect(after.toTabId).toBe(c!.id);
  expect(after.position).toBeCloseTo(before.position);
  expect(after.cards).toEqual([
    { tabId: a!.id, slot: 0 },
    { tabId: b!.id, slot: 1 },
    { tabId: c!.id, slot: 2 },
  ]);
});
