import { expect, it } from "vite-plus/test";

import { resolveWorkbenchDropTargetAtPoint, resolveSidebarDropTargetAtPoint } from "./workbenchDrag";

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

it("resolves sidebar session reorder target when dragging inside sidebar within same workspace", () => {
  const rowA = fakeElement({
    dataset: {
      sidebarSessionRow: "true",
      workspaceKey: "local:ws1",
      sessionId: "s1",
    },
    rect: { left: 10, top: 50, width: 200, height: 30 },
  });
  rowA.closest = ((selector: string) =>
    selector === "[data-sidebar-session-row]" ? rowA : null) as Element["closest"];

  const resolver = {
    isOverSidebar: (x: number, y: number) => x >= 0 && x <= 250 && y >= 0 && y <= 600,
    elementFromPoint: (x: number, y: number) => (y >= 50 && y <= 80 ? rowA : null),
  };

  // Dragging s2 over top half of s1 (y = 55, top is 50, height is 30 -> 55 < 65 -> before)
  const beforeRes = resolveSidebarDropTargetAtPoint(50, 55, "local:ws1", "s2", resolver);
  expect(beforeRes).toEqual({
    isOverSidebar: true,
    sidebarDropTarget: {
      workspaceKey: "local:ws1",
      sessionId: "s1",
      position: "before",
    },
  });

  // Dragging s2 over bottom half of s1 (y = 70 -> 70 >= 65 -> after)
  const afterRes = resolveSidebarDropTargetAtPoint(50, 70, "local:ws1", "s2", resolver);
  expect(afterRes).toEqual({
    isOverSidebar: true,
    sidebarDropTarget: {
      workspaceKey: "local:ws1",
      sessionId: "s1",
      position: "after",
    },
  });

  // Dragging s1 over itself: no reorder target
  const selfRes = resolveSidebarDropTargetAtPoint(50, 55, "local:ws1", "s1", resolver);
  expect(selfRes).toEqual({
    isOverSidebar: true,
    sidebarDropTarget: null,
  });

  // Dragging s2 from different workspace: no reorder target
  const otherWsRes = resolveSidebarDropTargetAtPoint(50, 55, "local:ws2", "s2", resolver);
  expect(otherWsRes).toEqual({
    isOverSidebar: true,
    sidebarDropTarget: null,
  });

  // Dragging outside sidebar: isOverSidebar is false
  const outsideRes = resolveSidebarDropTargetAtPoint(300, 55, "local:ws1", "s2", resolver);
  expect(outsideRes).toEqual({
    isOverSidebar: false,
    sidebarDropTarget: null,
  });
});
