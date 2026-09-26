import { afterEach, expect, it, vi } from "vite-plus/test";

import { createPaneRectMotion } from "./paneRectMotion";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps a Pane's visible size continuous when its layout target changes again", () => {
  let time = 0;
  let nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => frames.delete(handle));
  const element = { style: {} } as HTMLElement;
  const motion = createPaneRectMotion(element, { left: 0, top: 0, width: 600, height: 400 });
  motion.retarget({ left: 0, top: 0, width: 300, height: 400 }, false);
  expect(element.style.width).toBe("600px");
  time = 100;
  const first = [...frames.values()];
  frames.clear();
  first.forEach((callback) => callback(time));
  const visibleWidth = Number.parseFloat(element.style.width);
  expect(visibleWidth).toBeGreaterThan(300);
  expect(visibleWidth).toBeLessThan(600);
  motion.retarget({ left: 0, top: 0, width: 450, height: 400 }, false);
  expect(Number.parseFloat(element.style.width)).toBeCloseTo(visibleWidth);
  time = 700;
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(time));
  expect(element.style.width).toBe("450px");
  motion.stop();
});
