import { expect, it } from "vite-plus/test";

import { resolveWorkbenchDropTargetAtPoint } from "./workbenchDrag";

function fakeElement(input: {
  readonly dataset?: Record<string, string>;
  readonly rect?: { left: number; top: number; width: number; height: number };
  readonly closest?: (selector: string) => Element | null;
  readonly descendants?: ReadonlyArray<Element>;
}): Element {
  return {
    dataset: input.dataset ?? {},
    getBoundingClientRect: () => input.rect ?? { left: 0, top: 0, width: 0, height: 0 },
    closest: input.closest ?? (() => null),
    querySelectorAll: () => input.descendants ?? [],
  } as unknown as Element;
}

it("resolves Pane edge and replacement zones from the element under the pointer", () => {
  const pane = fakeElement({
    dataset: { workbenchPaneDrop: "", workbenchTabId: "tab-a", paneId: "pane-a" },
    rect: { left: 100, top: 100, width: 200, height: 200 },
  });
  pane.closest = ((selector: string) =>
    selector === "[data-workbench-pane-drop]" ? pane : null) as Element["closest"];
  const resolve = (x: number, y: number) =>
    resolveWorkbenchDropTargetAtPoint(x, y, {
      elementFromPoint: () => pane,
      tabCount: () => 0,
    });

  expect(resolve(110, 200)).toEqual({
    kind: "pane",
    tabId: "tab-a",
    paneId: "pane-a",
    zone: "left",
  });
  expect(resolve(200, 200)).toEqual({
    kind: "pane",
    tabId: "tab-a",
    paneId: "pane-a",
    zone: "replace",
  });
});

it("resolves existing Tabs and blank tab-strip drops", () => {
  const first = fakeElement({
    dataset: { workbenchTabDrop: "tab-a" },
    rect: { left: 0, top: 0, width: 100, height: 32 },
  });
  const second = fakeElement({
    dataset: { workbenchTabDrop: "tab-b" },
    rect: { left: 100, top: 0, width: 100, height: 32 },
  });
  const strip = fakeElement({
    dataset: { workbenchTabStripDrop: "" },
    descendants: [first, second],
  });
  strip.closest = ((selector: string) => {
    if (selector === "[data-workbench-tab-strip-drop]") return strip;
    if (selector === "[data-workbench-tab-drop]") return null;
    return null;
  }) as Element["closest"];
  second.closest = ((selector: string) =>
    selector === "[data-workbench-tab-drop]" ? second : null) as Element["closest"];
  let hit: Element = second;
  const resolver = {
    elementFromPoint: () => hit,
    tabCount: () => 2,
  };

  expect(resolveWorkbenchDropTargetAtPoint(120, 16, resolver)).toEqual({
    kind: "existingTab",
    tabId: "tab-b",
  });

  hit = strip;
  expect(resolveWorkbenchDropTargetAtPoint(80, 16, resolver)).toEqual({
    kind: "newTab",
    index: 1,
  });
  expect(resolveWorkbenchDropTargetAtPoint(240, 16, resolver)).toEqual({
    kind: "newTab",
    index: 2,
  });
});
