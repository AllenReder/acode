import { afterEach, expect, it, vi } from "vite-plus/test";

import { createSidebarPresentation } from "./sidebarPresentation";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("makes a 25ms Sidebar setting visibly faster than 400ms", () => {
  let now = 0;
  let handle = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++handle, callback);
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("document", { documentElement: { dataset: {} } });

  const exposedWidthAfter30ms = (durationMs: number) => {
    now = 0;
    frames.clear();
    const properties = new Map<string, string>();
    const wrapper = {
      style: {
        setProperty: (name: string, value: string) => properties.set(name, value),
      },
    } as unknown as HTMLElement;
    const presentation = createSidebarPresentation(wrapper, true, false);
    presentation.update({ open: false, enabled: true, width: 300, durationMs });
    presentation.update({ open: true, enabled: true, width: 300, durationMs });
    now = 30;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(now));
    const exposed = Number.parseFloat(properties.get("--sidebar-exposed-width") ?? "0");
    presentation.dispose();
    return exposed;
  };

  const fast = exposedWidthAfter30ms(25);
  const slow = exposedWidthAfter30ms(400);
  expect(fast).toBeGreaterThan(slow + 100);
});
