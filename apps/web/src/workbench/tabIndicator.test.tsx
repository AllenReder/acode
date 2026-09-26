import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { SidebarProvider } from "../components/ui/sidebar";
import { WorkbenchWindowChrome } from "./WorkbenchWindowChrome";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useTabIndicator } from "./useTabIndicator";
import {
  beginTabTransition,
  setTabTransitionProgress,
  endTabTransition,
  resetTabTransitionForTest,
} from "./tabTransition";
import { applyCreateTab, emptyWorkbenchSnapshot } from "./workbenchState";
import { resetWorkbenchStore } from "./workbenchStore";

beforeEach(() => {
  resetWorkbenchStore();
  resetTabTransitionForTest();
});

it("renders a shared theme underbar and drops bold from the active Tab", () => {
  let n = 0;
  const ids = () => `id-${++n}`;
  const snapshot = applyCreateTab(emptyWorkbenchSnapshot(ids), ids);

  const html = renderToStaticMarkup(
    <SidebarProvider defaultOpen>
      <WorkbenchWindowChrome snapshot={snapshot} projects={[]} />
    </SidebarProvider>,
  );

  expect(html).toContain("data-tab-indicator");
  expect(html).toContain("workbench-tab-indicator");
  expect(html).not.toContain("font-medium");
  expect(html).toContain('data-active-tab="true"');
});

// Exercise the actual hook across a gesture's final frame and completion.

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  resetTabTransitionForTest();
  vi.unstubAllGlobals();
});

it("lands the underbar without replaying the animation when a gesture finishes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  const animate = vi.fn(() => ({ cancel: vi.fn() }));
  const indicator = { style: { transform: "", width: "" }, animate };
  const tabs = [0, 1].map((index) => ({
    dataset: { tabId: String(index) },
    getBoundingClientRect: () => ({ left: index * 100, width: index === 0 ? 100 : 80 }),
  }));
  const strip = {
    scrollLeft: 0,
    getBoundingClientRect: () => ({ left: 0 }),
    querySelectorAll: () => tabs,
    querySelector: (selector: string) => tabs[selector.includes('"1"') ? 1 : 0],
  };
  const ref = { current: strip as unknown as HTMLElement };
  function Indicator({ active }: { active: string }) {
    const indicatorRef = useTabIndicator({
      stripRef: ref,
      activeTabId: active,
      revision: "0,1",
      dragging: false,
    });
    return <span ref={indicatorRef} />;
  }
  await act(() => {
    renderer = create(<Indicator active="0" />, { createNodeMock: () => indicator });
  });
  await act(() =>
    beginTabTransition({ fromTabId: "0", toTabId: "1", fromIndex: 0, toIndex: 1, dir: 1 }),
  );
  await act(() => setTabTransitionProgress(0.5));
  expect(indicator.style.transform).toBe("translateX(50px)");
  expect(indicator.style.width).toBe("100px");
  await act(() => renderer!.update(<Indicator active="1" />));
  await act(() => {
    setTabTransitionProgress(1);
    endTabTransition();
  });
  expect(indicator.style.transform).toBe("translateX(100px)");
  expect(indicator.style.width).toBe("80px");
  expect(animate).not.toHaveBeenCalled();
});
