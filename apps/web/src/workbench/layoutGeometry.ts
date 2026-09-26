import type { SplitDir, LayoutNode } from "./layout";
import type { WorkbenchTab } from "./workbenchState";

/** Additional trailing space beyond the final Pane gap in Scrolling layout (ADR 0015). */
export const SCROLLING_TRAILING_PADDING = 0;

export interface ComputedPaneRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ComputedSash {
  readonly id: string;
  readonly label: string;
  readonly dir: SplitDir;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  // BSP specifics
  readonly splitId?: string;
  readonly index?: number;
  readonly totalPx?: number;
  readonly sizes?: readonly number[];
  // Scrolling specifics
  readonly columnId?: string;
  readonly isColumnWidth?: boolean;
  readonly isPaneHeight?: boolean;
  readonly paneIndex?: number;
}

export interface ComputedLayoutResult {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly rects: ReadonlyMap<string, ComputedPaneRect>;
  readonly sashes: ReadonlyArray<ComputedSash>;
}

export function computePaneLayoutRects(
  tab: WorkbenchTab,
  viewportSize: { readonly width: number; readonly height: number },
  paneGap: number,
): ComputedLayoutResult {
  const gap = Math.max(0, paneGap);
  const rects = new Map<string, ComputedPaneRect>();
  const sashes: ComputedSash[] = [];

  if (tab.layoutMode === "scrolling") {
    const columns = tab.columns ?? [];
    if (columns.length === 0) {
      return {
        canvasWidth: viewportSize.width,
        canvasHeight: viewportSize.height,
        rects,
        sashes,
      };
    }

    // Viewport never scrolls vertically; height strictly matches viewport (ADR 0015)
    const canvasHeight = viewportSize.height;

    let currentLeft = gap;
    for (const column of columns) {
      const colLeft = currentLeft;
      const m = column.paneIds.length;
      const totalGapSpace = (m + 1) * gap;
      const usableHeight = Math.max(0, canvasHeight - totalGapSpace);

      let currentTop = gap;
      column.paneIds.forEach((paneId, index) => {
        const share = column.shares[index] ?? (m > 0 ? 1 / m : 1);
        const paneH = share * usableHeight;
        rects.set(paneId, {
          left: colLeft,
          top: currentTop,
          width: column.width,
          height: paneH,
        });

        // Vertical sash between panes in this column
        if (index < m - 1) {
          const sashTop = currentTop + paneH;
          const hitHeight = gap === 0 ? 8 : Math.max(gap, 8);
          const visualOffset = gap === 0 ? -4 : (gap - hitHeight) / 2;
          sashes.push({
            id: `sash-col-${column.id}-pane-${index}`,
            label: "Pane height",
            dir: "down",
            left: colLeft,
            top: sashTop + visualOffset,
            width: column.width,
            height: hitHeight,
            columnId: column.id,
            isPaneHeight: true,
            paneIndex: index,
            totalPx: usableHeight,
          });
        }

        currentTop += paneH + gap;
      });

      // Column width sash to the right of this column
      const colRight = colLeft + column.width;
      const colHitWidth = gap === 0 ? 8 : Math.max(gap, 8);
      const colVisualOffset = gap === 0 ? -4 : (gap - colHitWidth) / 2;
      sashes.push({
        id: `sash-col-width-${column.id}`,
        label: "Column width",
        dir: "right",
        left: colRight + colVisualOffset,
        top: 0,
        width: colHitWidth,
        height: canvasHeight,
        columnId: column.id,
        isColumnWidth: true,
      });

      currentLeft += column.width + gap;
    }

    const canvasWidth = Math.max(viewportSize.width, currentLeft + SCROLLING_TRAILING_PADDING);
    return {
      canvasWidth,
      canvasHeight,
      rects,
      sashes,
    };
  }

  // BSP layout mode
  const canvasWidth = viewportSize.width;
  const canvasHeight = viewportSize.height;
  const rootBox = {
    x: gap,
    y: gap,
    w: Math.max(0, canvasWidth - 2 * gap),
    h: Math.max(0, canvasHeight - 2 * gap),
  };

  function layoutBspNode(node: LayoutNode, box: { x: number; y: number; w: number; h: number }) {
    if (node.type === "leaf") {
      rects.set(node.id, {
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
      });
      return;
    }

    const k = node.children.length;
    if (k === 0) return;
    const row = node.dir === "right";
    const totalGaps = (k - 1) * gap;

    if (row) {
      const availSpan = Math.max(0, box.w - totalGaps);
      let curX = box.x;
      for (let i = 0; i < k; i++) {
        const child = node.children[i];
        if (!child) continue;
        const size = node.sizes[i] ?? 1 / k;
        const childW = size * availSpan;
        const childBox = { x: curX, y: box.y, w: childW, h: box.h };
        layoutBspNode(child, childBox);

        if (i < k - 1) {
          const gapStart = curX + childW;
          const hitWidth = gap === 0 ? 8 : Math.max(gap, 8);
          const offset = gap === 0 ? -4 : (gap - hitWidth) / 2;
          sashes.push({
            id: `sash-bsp-${node.id}-${i}`,
            label: "Pane size",
            dir: "right",
            left: gapStart + offset,
            top: box.y,
            width: hitWidth,
            height: box.h,
            splitId: node.id,
            index: i,
            totalPx: availSpan,
            sizes: node.sizes,
          });
        }
        curX += childW + gap;
      }
    } else {
      const availSpan = Math.max(0, box.h - totalGaps);
      let curY = box.y;
      for (let i = 0; i < k; i++) {
        const child = node.children[i];
        if (!child) continue;
        const size = node.sizes[i] ?? 1 / k;
        const childH = size * availSpan;
        const childBox = { x: box.x, y: curY, w: box.w, h: childH };
        layoutBspNode(child, childBox);

        if (i < k - 1) {
          const gapStart = curY + childH;
          const hitHeight = gap === 0 ? 8 : Math.max(gap, 8);
          const offset = gap === 0 ? -4 : (gap - hitHeight) / 2;
          sashes.push({
            id: `sash-bsp-${node.id}-${i}`,
            label: "Pane size",
            dir: "down",
            left: box.x,
            top: gapStart + offset,
            width: box.w,
            height: hitHeight,
            splitId: node.id,
            index: i,
            totalPx: availSpan,
            sizes: node.sizes,
          });
        }
        curY += childH + gap;
      }
    }
  }

  layoutBspNode(tab.layout, rootBox);

  return {
    canvasWidth,
    canvasHeight,
    rects,
    sashes,
  };
}
