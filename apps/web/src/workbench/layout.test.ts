import { describe, expect, it } from "vite-plus/test";

import {
  AcodeTab,
  closeLeaf,
  firstLeafId,
  leaf,
  leafIds,
  layoutLeaves,
  layoutSashes,
  movePane,
  neighborLeafId,
  newTab,
  paneDropZoneFromPoint,
  paneEdgeFromPoint,
  placeLayout,
  placePane,
  removePane,
  replaceLeafId,
  replacePaneWithLayout,
  setSplitRatio,
  siblingLeafId,
  splitPane,
  splitSizesAtBoundary,
  type LayoutNode,
} from "./layout";

describe("splitSizesAtBoundary", () => {
  it("moves only the adjacent panes and preserves their total", () => {
    const result = splitSizesAtBoundary([0.2, 0.3, 0.5], 1, 0.7);
    expect(result[0]).toBe(0.2);
    expect(result[1]).toBeCloseTo(0.5);
    expect(result[2]).toBeCloseTo(0.3);
  });

  it("clamps both panes to the minimum size", () => {
    const right = splitSizesAtBoundary([0.5, 0.5], 0, 0.99);
    expect(right[0]).toBeCloseTo(0.92);
    expect(right[1]).toBeCloseTo(0.08);

    const left = splitSizesAtBoundary([0.5, 0.5], 0, 0.01);
    expect(left[0]).toBeCloseTo(0.08);
    expect(left[1]).toBeCloseTo(0.92);
  });

  it("leaves invalid boundaries unchanged", () => {
    const sizes = [0.5, 0.5];
    expect(splitSizesAtBoundary(sizes, 2, 0.5)).toBe(sizes);
  });
});

describe("layoutLeaves", () => {
  it("keeps a single pane filling the tab", () => {
    const leaves = layoutLeaves(leaf("a"));
    expect(leaves).toEqual([{ id: "a", rect: { x: 0, y: 0, w: 1, h: 1 }, axis: "x" }]);
  });

  it("places a right split side by side without changing leaf ids", () => {
    const tree = splitPane(leaf("a"), "a", "right", "b");
    const leaves = layoutLeaves(tree);
    expect(leaves.map((pane) => pane.id)).toEqual(["a", "b"]);
    expect(leaves[0]?.rect).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
    expect(leaves[1]?.rect).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
  });

  it("places a down split stacked vertically", () => {
    const tree = splitPane(leaf("a"), "a", "down", "b");
    const leaves = layoutLeaves(tree);
    expect(leaves[0]?.rect).toEqual({ x: 0, y: 0, w: 1, h: 0.5 });
    expect(leaves[1]?.rect).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
  });
});

describe("layoutSashes", () => {
  it("puts a sash on the shared edge of a right split", () => {
    const tree = splitPane(leaf("a"), "a", "right", "b");
    const sashes = layoutSashes(tree);
    expect(sashes).toHaveLength(1);
    expect(sashes[0]?.index).toBe(0);
    expect(sashes[0]?.dir).toBe("right");
    expect(sashes[0]?.group).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("returns no sashes for a single leaf", () => {
    expect(layoutSashes(leaf("a"))).toEqual([]);
  });
});

describe("splitPane", () => {
  it("creates a balanced split at the focused leaf", () => {
    const tree = splitPane(leaf("a"), "a", "right", "b");
    expect(tree).toMatchObject({
      type: "split",
      dir: "right",
      children: [
        { type: "leaf", id: "a" },
        { type: "leaf", id: "b" },
      ],
      sizes: [0.5, 0.5],
    });
  });

  it("keeps a sibling-axis split grouping panes in the same group", () => {
    const first = splitPane(leaf("a"), "a", "right", "b");
    const second = splitPane(first, "b", "right", "c");
    expect(second.type).toBe("split");
    if (second.type !== "split") throw new Error("expected split");
    expect(second.children.map((child) => (child.type === "leaf" ? child.id : null))).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(second.dir).toBe("right");
    expect(second.children).toHaveLength(3);
  });

  it("nests a perpendicular split inside the focused leaf", () => {
    const first = splitPane(leaf("a"), "a", "right", "b");
    const second = splitPane(first, "b", "down", "c");
    expect(second).toMatchObject({
      type: "split",
      dir: "right",
      children: [
        { type: "leaf", id: "a" },
        { type: "split", dir: "down" },
      ],
    });
  });

  it("leaves the tree structurally unchanged when the focused id is not present", () => {
    const tree = splitPane(leaf("a"), "a", "right", "b");
    const after = splitPane(tree, "missing", "right", "c");
    expect(after).toEqual(tree);
    expect(after).not.toBe(tree);
  });
});

describe("removePane", () => {
  it("returns null when the only leaf is removed", () => {
    expect(removePane(leaf("a"), "a")).toBeNull();
  });

  it("collapses a parent split when one of two leaves is removed", () => {
    const tree = splitPane(leaf("a"), "a", "right", "b");
    const after = removePane(tree, "a");
    expect(after).toEqual(leaf("b"));
  });

  it("keeps siblings and normalizes sizes when a middle leaf is removed", () => {
    let tree: LayoutNode = leaf("a");
    tree = splitPane(tree, "a", "right", "b");
    tree = splitPane(tree, "b", "right", "c");
    const after = removePane(tree, "b");
    expect(after).toMatchObject({
      type: "split",
      dir: "right",
      children: [
        { type: "leaf", id: "a" },
        { type: "leaf", id: "c" },
      ],
    });
    if (after?.type !== "split") throw new Error("expected split");
    const total = after.sizes.reduce((sum, n) => sum + n, 0);
    expect(total).toBeCloseTo(1);
  });
});

describe("closeLeaf", () => {
  it("returns null when closing the last leaf", () => {
    const tab = newTab("a");
    expect(closeLeaf(tab, "a")).toBeNull();
  });

  it("moves focus to the closed leaf's sibling when focused", () => {
    let tab: AcodeTab = newTab("a");
    tab = { ...tab, layout: splitPane(tab.layout, "a", "right", "b"), focusedPaneId: "a" };
    const after = closeLeaf(tab, "a");
    expect(after?.focusedPaneId).toBe("b");
    expect(after?.layout).toEqual(leaf("b"));
  });

  it("keeps focus on the existing focused leaf when a sibling closes", () => {
    let tab: AcodeTab = newTab("a");
    tab = { ...tab, layout: splitPane(tab.layout, "a", "right", "b"), focusedPaneId: "b" };
    const after = closeLeaf(tab, "a");
    expect(after?.focusedPaneId).toBe("b");
  });
});

describe("setSplitRatio", () => {
  it("updates the boundary between two panes in a split", () => {
    const tree = splitPane(leaf("a"), "a", "right", "b");
    const splitId = tree.type === "split" ? tree.id : null;
    expect(splitId).not.toBeNull();
    if (splitId === null) throw new Error("expected split");
    const after = setSplitRatio(tree, splitId, 0, 0.7);
    expect(after.type).toBe("split");
    if (after.type !== "split") throw new Error("expected split");
    expect(after.sizes[0]).toBeCloseTo(0.7);
    expect(after.sizes[1]).toBeCloseTo(0.3);
  });

  it("leaves the tree structurally unchanged when the split id does not match", () => {
    const tree = splitPane(leaf("a"), "a", "right", "b");
    const after = setSplitRatio(tree, "missing", 0, 0.7);
    expect(after).toEqual(tree);
    expect(after).not.toBe(tree);
  });
});

describe("replaceLeafId", () => {
  it("swaps the leaf id", () => {
    const tree = splitPane(leaf("a"), "a", "right", "b");
    expect(replaceLeafId(tree, "a", "x")).toMatchObject({
      type: "split",
      children: [
        { type: "leaf", id: "x" },
        { type: "leaf", id: "b" },
      ],
    });
  });

  it("returns the same tree when from === to", () => {
    const tree = leaf("a");
    expect(replaceLeafId(tree, "a", "a")).toBe(tree);
  });
});

describe("leafIds / firstLeafId", () => {
  it("returns the single id for a leaf", () => {
    expect(leafIds(leaf("a"))).toEqual(["a"]);
    expect(firstLeafId(leaf("a"))).toBe("a");
  });

  it("walks the tree depth-first, left-to-right", () => {
    let tree: LayoutNode = leaf("a");
    tree = splitPane(tree, "a", "right", "b");
    tree = splitPane(tree, "b", "down", "c");
    expect(leafIds(tree)).toEqual(["a", "b", "c"]);
    expect(firstLeafId(tree)).toBe("a");
  });
});

describe("neighborLeafId", () => {
  it("finds the right neighbor sharing vertical overlap", () => {
    let tree: LayoutNode = leaf("a");
    tree = splitPane(tree, "a", "right", "b");
    expect(neighborLeafId(tree, "a", "right")).toBe("b");
    expect(neighborLeafId(tree, "b", "left")).toBe("a");
  });

  it("returns null when no neighbor exists in that direction", () => {
    const tree = leaf("a");
    expect(neighborLeafId(tree, "a", "right")).toBeNull();
  });
});

describe("siblingLeafId", () => {
  it("returns the immediate sibling inside the same split", () => {
    let tree: LayoutNode = leaf("a");
    tree = splitPane(tree, "a", "right", "b");
    tree = splitPane(tree, "b", "right", "c");
    expect(siblingLeafId(tree, "b")).toBe("a");
    expect(siblingLeafId(tree, "a")).toBe("b");
  });

  it("returns null for the only leaf", () => {
    expect(siblingLeafId(leaf("a"), "a")).toBeNull();
  });
});

describe("paneEdgeFromPoint", () => {
  it("chooses the dominant horizontal axis", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(paneEdgeFromPoint(10, 50, rect)).toBe("left");
    expect(paneEdgeFromPoint(90, 50, rect)).toBe("right");
  });

  it("chooses the dominant vertical axis", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(paneEdgeFromPoint(50, 10, rect)).toBe("top");
    expect(paneEdgeFromPoint(50, 90, rect)).toBe("bottom");
  });
});

describe("paneDropZoneFromPoint", () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };

  it("uses the outer 30% bands for split edges", () => {
    expect(paneDropZoneFromPoint(29, 50, rect)).toBe("left");
    expect(paneDropZoneFromPoint(71, 50, rect)).toBe("right");
    expect(paneDropZoneFromPoint(50, 29, rect)).toBe("top");
    expect(paneDropZoneFromPoint(50, 71, rect)).toBe("bottom");
  });

  it("uses the central 40% by 40% area for replacement", () => {
    expect(paneDropZoneFromPoint(50, 50, rect)).toBe("replace");
    expect(paneDropZoneFromPoint(30, 50, rect)).toBe("replace");
    expect(paneDropZoneFromPoint(70, 50, rect)).toBe("replace");
    expect(paneDropZoneFromPoint(50, 30, rect)).toBe("replace");
    expect(paneDropZoneFromPoint(50, 70, rect)).toBe("replace");
  });

  it("chooses the nearest edge in corner bands", () => {
    expect(paneDropZoneFromPoint(5, 10, rect)).toBe("left");
    expect(paneDropZoneFromPoint(10, 5, rect)).toBe("top");
    expect(paneDropZoneFromPoint(95, 90, rect)).toBe("right");
    expect(paneDropZoneFromPoint(90, 95, rect)).toBe("bottom");
  });
});

describe("movePane / placePane / placeLayout / replacePaneWithLayout", () => {
  it("movePane reorders siblings within the same split", () => {
    let tree: LayoutNode = leaf("a");
    tree = splitPane(tree, "a", "right", "b");
    tree = splitPane(tree, "b", "right", "c");
    const after = movePane(tree, "a", "c", "right");
    expect(leafIds(after)).toEqual(["b", "c", "a"]);
  });

  it("placePane opens a brand-new leaf on a target edge", () => {
    const tree = leaf("a");
    const after = placePane(tree, "b", "a", "right");
    expect(leafIds(after)).toEqual(["a", "b"]);
    expect(after.type).toBe("split");
  });

  it("placeLayout wraps a sub-tree in a perpendicular split", () => {
    const tree = leaf("a");
    const subtree = leaf("x");
    const after = placeLayout(tree, subtree, "a", "right");
    expect(leafIds(after)).toEqual(["a", "x"]);
  });

  it("replacePaneWithLayout swaps one leaf for a sub-tree", () => {
    const tree = splitPane(leaf("a"), "a", "right", "b");
    const subtree = splitPane(leaf("x"), "x", "down", "y");
    const after = replacePaneWithLayout(tree, "a", subtree);
    expect(leafIds(after)).toEqual(["x", "y", "b"]);
  });
});

describe("newTab", () => {
  it("starts with a single leaf and that leaf focused", () => {
    const tab = newTab("a");
    expect(tab.layout).toEqual(leaf("a"));
    expect(tab.focusedPaneId).toBe("a");
  });
});
