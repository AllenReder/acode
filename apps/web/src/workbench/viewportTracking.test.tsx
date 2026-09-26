import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import {
  getViewportMetrics,
  resetViewportMetricsForTest,
  subscribeViewportMetrics,
  usePublishViewportMetrics,
} from "./viewportTracking";

/** Observed ResizeObserver stubs, so a test can drive a canvas resize. */
const observers: Array<{ callback: () => void }> = [];

function makeResizeObserverStub() {
  return class {
    callback: () => void;
    constructor(callback: () => void) {
      this.callback = callback;
      observers.push({ callback });
    }
    observe() {}
    disconnect() {}
  };
}

/** A fake Scrolling Viewport whose readings the test drives directly. */
function fakeViewport(input: { clientWidth: number; scrollWidth: number; scrollLeft: number }) {
  const scrollListeners = new Set<() => void>();
  const element = {
    clientWidth: input.clientWidth,
    scrollWidth: input.scrollWidth,
    scrollLeft: input.scrollLeft,
    firstElementChild: null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    addEventListener: (type: string, listener: () => void) => {
      if (type === "scroll") scrollListeners.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      if (type === "scroll") scrollListeners.delete(listener);
    },
  };
  return {
    element: element as unknown as HTMLElement,
    scrollTo(scrollLeft: number) {
      element.scrollLeft = scrollLeft;
      for (const listener of scrollListeners) listener();
    },
    resize(next: { clientWidth: number; scrollWidth: number }) {
      element.clientWidth = next.clientWidth;
      element.scrollWidth = next.scrollWidth;
      for (const observer of observers) observer.callback();
    },
  };
}

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  observers.length = 0;
  vi.stubGlobal("ResizeObserver", makeResizeObserverStub());
  resetViewportMetricsForTest();
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

function Host(props: { viewport: HTMLElement; tabId: string; active: boolean }) {
  usePublishViewportMetrics({
    ref: { current: props.viewport },
    tabId: props.tabId,
    active: props.active,
  });
  return null;
}

it("publishes the active Viewport's readings on mount", async () => {
  const viewport = fakeViewport({ clientWidth: 500, scrollWidth: 1000, scrollLeft: 0 });
  await act(() => {
    renderer = create(<Host viewport={viewport.element} tabId="a" active />, {
      createNodeMock: () => null,
    });
  });
  expect(getViewportMetrics()).toEqual({
    tabId: "a",
    clientWidth: 500,
    scrollWidth: 1000,
    scrollLeft: 0,
  });
});

it("updates the published scroll offset as the Viewport scrolls", async () => {
  const viewport = fakeViewport({ clientWidth: 500, scrollWidth: 1000, scrollLeft: 0 });
  await act(() => {
    renderer = create(<Host viewport={viewport.element} tabId="a" active />, {
      createNodeMock: () => null,
    });
  });
  const seen: number[] = [];
  const unsubscribe = subscribeViewportMetrics(() => {
    seen.push(getViewportMetrics()?.scrollLeft ?? -1);
  });
  await act(() => viewport.scrollTo(250));
  expect(getViewportMetrics()?.scrollLeft).toBe(250);
  expect(seen).toEqual([250]);
  unsubscribe();
});

it("does not notify when a scroll event reports the same offset", async () => {
  const viewport = fakeViewport({ clientWidth: 500, scrollWidth: 1000, scrollLeft: 120 });
  await act(() => {
    renderer = create(<Host viewport={viewport.element} tabId="a" active />, {
      createNodeMock: () => null,
    });
  });
  let notifications = 0;
  const unsubscribe = subscribeViewportMetrics(() => {
    notifications += 1;
  });
  await act(() => viewport.scrollTo(120));
  expect(notifications).toBe(0);
  unsubscribe();
});

it("publishes nothing for an inactive Tab", async () => {
  const viewport = fakeViewport({ clientWidth: 500, scrollWidth: 1000, scrollLeft: 90 });
  await act(() => {
    renderer = create(<Host viewport={viewport.element} tabId="a" active={false} />, {
      createNodeMock: () => null,
    });
  });
  expect(getViewportMetrics()).toBeNull();
});

it("withdraws the reading when the Tab stops being active", async () => {
  const viewport = fakeViewport({ clientWidth: 500, scrollWidth: 1000, scrollLeft: 0 });
  await act(() => {
    renderer = create(<Host viewport={viewport.element} tabId="a" active />, {
      createNodeMock: () => null,
    });
  });
  expect(getViewportMetrics()).not.toBeNull();
  await act(() => renderer!.update(<Host viewport={viewport.element} tabId="a" active={false} />));
  expect(getViewportMetrics()).toBeNull();
});

it("stops listening once the Tab is no longer active", async () => {
  const viewport = fakeViewport({ clientWidth: 500, scrollWidth: 1000, scrollLeft: 0 });
  await act(() => {
    renderer = create(<Host viewport={viewport.element} tabId="a" active />, {
      createNodeMock: () => null,
    });
  });
  await act(() => renderer!.update(<Host viewport={viewport.element} tabId="a" active={false} />));
  await act(() => viewport.scrollTo(400));
  expect(getViewportMetrics()).toBeNull();
});

it("re-reads the Viewport's box when the canvas resizes", async () => {
  const viewport = fakeViewport({ clientWidth: 500, scrollWidth: 1000, scrollLeft: 0 });
  await act(() => {
    renderer = create(<Host viewport={viewport.element} tabId="a" active />, {
      createNodeMock: () => null,
    });
  });
  // A Column resize widens the canvas without scrolling.
  viewport.resize({ clientWidth: 500, scrollWidth: 1400 });
  expect(getViewportMetrics()?.scrollWidth).toBe(1400);
});
