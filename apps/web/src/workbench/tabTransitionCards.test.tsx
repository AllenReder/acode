import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { PaneTree } from "./PaneTree";
import { beginTabTransition, resetTabTransitionForTest } from "./tabTransition";
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

it("renders the source and target Tabs as two cards during a Sliding Tab switch", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  let n = 0;
  const ids = () => `id-${++n}`;
  const snapshot = applyCreateTab(emptyWorkbenchSnapshot(ids), ids);
  const [first, second] = snapshot.tabs;
  useWorkbenchStore.setState({ ...snapshot, focusRequestId: 0 });

  beginTabTransition({
    fromTabId: second!.id,
    toTabId: first!.id,
    fromIndex: 1,
    toIndex: 0,
    dir: -1,
  });

  await act(() => {
    renderer = create(<PaneTree snapshot={useWorkbenchStore.getState()} />, {
      createNodeMock: () => ({
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 400 }),
        style: {},
        querySelector: () => null,
        querySelectorAll: () => [],
        clientWidth: 600,
        clientHeight: 400,
        scrollLeft: 0,
        scrollTop: 0,
      }),
    });
  });

  expect(renderer!.root.findAllByProps({ "data-tab-transition": "true" })).toHaveLength(1);
  expect(renderer!.root.findAllByProps({ "data-tab-transition-role": "from" })).toHaveLength(1);
  expect(renderer!.root.findAllByProps({ "data-tab-transition-role": "to" })).toHaveLength(1);
  expect(renderer!.root.findAllByProps({ "data-tab-transition-role": "active" })).toHaveLength(0);
});
