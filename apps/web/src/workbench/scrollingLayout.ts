import {
  leaf,
  newTab,
  leafIds,
  placePane,
  removePane,
  type LayoutNode,
  type PaneDropZone,
  type PaneEdge,
} from "./layout";

export type LayoutMode = "bsp" | "scrolling";
export interface Column {
  readonly id: string;
  readonly width: number;
  readonly paneIds: readonly string[];
  readonly shares: readonly number[];
}
export const MIN_COLUMN_WIDTH = 320;
export const MAX_COLUMN_WIDTH = 2400;
export const DEFAULT_COLUMN_WIDTH = 560;
export const MIN_PANE_HEIGHT = 140;
export const LAYOUT_VERSION = 1;
export interface LayoutMemory {
  readonly version: number;
  readonly bsp?: LayoutNode;
  readonly columns?: readonly Column[];
}
const normalize = (shares: readonly number[]) => {
  const sum = shares.reduce((a, b) => a + b, 0);
  return shares.map((value) => value / sum);
};
export function newColumn(paneId: string): Column {
  return { id: newTab(paneId).id, width: DEFAULT_COLUMN_WIDTH, paneIds: [paneId], shares: [1] };
}
/** Filter stale references; new panes follow current visual reading order. */
export function reconcileColumns(columns: readonly Column[], ids: readonly string[]): Column[] {
  const remaining = new Set(ids);
  const result: Column[] = [];
  for (const column of columns) {
    const paneIds: string[] = [];
    const shares: number[] = [];
    column.paneIds.forEach((id, index) => {
      if (!remaining.delete(id)) return;
      paneIds.push(id);
      shares.push(column.shares[index] ?? 1);
    });
    if (paneIds.length) result.push({ ...column, paneIds, shares: normalize(shares) });
  }
  for (const id of remaining) result.push(newColumn(id));
  return result;
}
export function columnsTree(columns: readonly Column[]): LayoutNode {
  const children: LayoutNode[] = columns.map((column) =>
    column.paneIds.length === 1
      ? leaf(column.paneIds[0]!)
      : {
          type: "split",
          id: column.id,
          dir: "down",
          children: column.paneIds.map(leaf),
          sizes: [...column.shares],
        },
  );
  if (children.length === 1) return children[0]!;
  return {
    type: "split",
    id: "columns",
    dir: "right",
    children,
    sizes: normalize(columns.map((c) => c.width)),
  };
}
export function adjacentScrollingPaneTarget(
  columns: readonly Column[],
  tabId: string,
  paneId: string,
): { kind: "pane"; tabId: string; paneId: string; zone: PaneEdge } | null {
  for (let cIdx = 0; cIdx < columns.length; cIdx++) {
    const col = columns[cIdx]!;
    const pIdx = col.paneIds.indexOf(paneId);
    if (pIdx < 0) continue;
    if (col.paneIds.length > 1) {
      const neighborId = pIdx > 0 ? col.paneIds[pIdx - 1]! : col.paneIds[pIdx + 1]!;
      const zone: PaneEdge = pIdx === 0 ? "top" : "bottom";
      return { kind: "pane", tabId, paneId: neighborId, zone };
    }
    const neighborCol = cIdx > 0 ? columns[cIdx - 1]! : columns[cIdx + 1];
    if (!neighborCol || neighborCol.paneIds.length === 0) return null;
    const neighborId = neighborCol.paneIds[0]!;
    const zone: PaneEdge = cIdx === 0 ? "left" : "right";
    return { kind: "pane", tabId, paneId: neighborId, zone };
  }
  return null;
}

export function placeInColumns(
  columns: readonly Column[],
  paneId: string,
  targetId: string,
  zone: PaneDropZone,
): Column[] {
  const cleaned = reconcileColumns(
    columns,
    columns.flatMap((c) => c.paneIds).filter((id) => id !== paneId),
  );
  const index = cleaned.findIndex((c) => c.paneIds.includes(targetId));
  const column = cleaned[index];
  if (!column) return cleaned;
  if (zone === "left" || zone === "right") {
    cleaned.splice(index + (zone === "right" ? 1 : 0), 0, newColumn(paneId));
  } else {
    const paneIds = [...column.paneIds];
    const shares = [...column.shares];
    const at = paneIds.indexOf(targetId);
    if (zone === "replace") paneIds[at] = paneId;
    else {
      const half = shares[at]! / 2;
      shares[at] = half;
      paneIds.splice(at + (zone === "bottom" ? 1 : 0), 0, paneId);
      shares.splice(at + (zone === "bottom" ? 1 : 0), 0, half);
    }
    cleaned[index] = { ...column, paneIds, shares };
  }
  return cleaned;
}
export function reconcileBsp(saved: LayoutNode | undefined, ids: readonly string[]): LayoutNode {
  let tree = saved ?? null;
  for (const id of tree ? leafIds(tree) : [])
    if (!ids.includes(id)) tree = tree && removePane(tree, id);
  for (const id of ids) {
    if (!tree) tree = leaf(id);
    else if (!leafIds(tree).includes(id))
      tree = placePane(tree, id, leafIds(tree).at(-1)!, "right");
  }
  return tree!;
}
