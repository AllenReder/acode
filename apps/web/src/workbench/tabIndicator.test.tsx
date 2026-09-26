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
import { publishViewportMetrics, resetViewportMetricsForTest } from "./viewportTracking";

beforeEach(() => {
  resetWorkbenchStore();
  resetTabTransitionForTest();
  resetViewportMetricsForTest();
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

/** A strip holding one 200px Tab at offset 40, for Viewport-driven geometry. */
function viewportStrip() {
  const element = {
    dataset: { tabId: "a" },
    getBoundingClientRect: () => ({ left: 140, width: 200 }),
  };
  return {
    scrollLeft: 0,
    getBoundingClientRect: () => ({ left: 100 }),
    querySelectorAll: () => [element],
    querySelector: () => element,
  };
}

/** Drive the real indicator hook against one fixed 200px Tab. */
function viewportIndicator(strip: unknown) {
  const ref = { current: strip as HTMLElement };
  function Indicator() {
    const indicatorRef = useTabIndicator({
      stripRef: ref,
      activeTabId: "a",
      revision: "a",
      dragging: false,
    });
    return <span ref={indicatorRef} />;
  }
  return { Indicator, ref };
}

it("spans the whole active Tab when the Scrolling canvas does not overflow", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  const indicator = { style: { transform: "", width: "" } };
  publishViewportMetrics({ tabId: "a", clientWidth: 800, scrollWidth: 800, scrollLeft: 0 });
  const { Indicator } = viewportIndicator(viewportStrip());
  await act(() => {
    renderer = create(<Indicator />, { createNodeMock: () => indicator });
  });
  expect(indicator.style.transform).toBe("translateX(40px)");
  expect(indicator.style.width).toBe("200px");
});

it("narrows the active Tab's underbar to the Viewport's share of the canvas", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  const indicator = { style: { transform: "", width: "" } };
  publishViewportMetrics({ tabId: "a", clientWidth: 500, scrollWidth: 1000, scrollLeft: 0 });
  const { Indicator } = viewportIndicator(viewportStrip());
  await act(() => {
    renderer = create(<Indicator />, { createNodeMock: () => indicator });
  });
  // Half the canvas is visible, so the bar is half the 200px Tab, at its left edge.
  expect(indicator.style.transform).toBe("translateX(40px)");
  expect(indicator.style.width).toBe("100px");
});

it("travels the underbar across the active Tab as the Viewport scrolls", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  const indicator = { style: { transform: "", width: "" } };
  publishViewportMetrics({ tabId: "a", clientWidth: 500, scrollWidth: 1000, scrollLeft: 0 });
  const { Indicator } = viewportIndicator(viewportStrip());
  await act(() => {
    renderer = create(<Indicator />, { createNodeMock: () => indicator });
  });
  await act(() =>
    publishViewportMetrics({ tabId: "a", clientWidth: 500, scrollWidth: 1000, scrollLeft: 500 }),
  );
  // Fully scrolled right: the 100px bar ends flush with the Tab's right edge.
  expect(indicator.style.transform).toBe("translateX(140px)");
  expect(indicator.style.width).toBe("100px");
});

it("ignores metrics published by a different Tab", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  const indicator = { style: { transform: "", width: "" } };
  publishViewportMetrics({ tabId: "other", clientWidth: 500, scrollWidth: 1000, scrollLeft: 0 });
  const { Indicator } = viewportIndicator(viewportStrip());
  await act(() => {
    renderer = create(<Indicator />, { createNodeMock: () => indicator });
  });
  expect(indicator.style.transform).toBe("translateX(40px)");
  expect(indicator.style.width).toBe("200px");
});
