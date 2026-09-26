# Scrolling layout trailing drop, edge auto-scrolling, and viewport scroll invariants

**Status: accepted**

In Awen's Workbench, Tabs arrange Panes using either BSP or Scrolling layout.
This decision establishes that the Workbench Viewport never scrolls vertically,
treating vertical scrolling as the exclusive responsibility of individual Pane
Content Layers. In Scrolling layout, the Trailing Canvas Area beyond the
rightmost Column is a first-class drop target that appends a new Column at the
far right, supported by bidirectional edge auto-scrolling during drag.

## Context

In Scrolling layout, Columns are laid out horizontally. When the total width of
rendered Columns is narrower than the Viewport, the space between the rightmost
Column and the Viewport boundary previously formed a dead zone: dragging a Pane
or Sidebar Session into this unoccupied space produced no drop target, reverting
the preview to its initial position. Placing a Pane as a new column at the far
right required users to unnaturally hover over the right half of the existing
rightmost Pane.

Additionally, when multiple Panes stacked within a single Column, minimum pane
height constraints previously expanded the calculated `canvasHeight` beyond the
Viewport height. Coupled with `.workbench-viewport`'s `overflow: auto` style,
this generated Viewport-level vertical scrollbars in certain configurations.
This conflicted with desktop window management intuition, where Panes act as
self-contained viewport windows whose internal editors, terminals, or timelines
manage their own vertical scrolling.

## Decision

- **Elimination of Viewport vertical scrolling**:
  - `computePaneLayoutRects` locks `canvasHeight` strictly to `viewportSize.height`
    across both BSP and Scrolling layouts.
  - Column shares distribute the available height (`canvasHeight - totalGapSpace`)
    proportionately among stacked Panes.
  - `.workbench-viewport` enforces `overflow-y: hidden` (BSP mode uses
    `overflow: hidden`; Scrolling mode uses `overflow-x: auto; overflow-y: hidden`).
  - Viewport-level vertical scroll reveal logic is removed; focus transitions scroll
    only horizontally (`targetLeft`).
- **Trailing Canvas Area drop target**:
  - In Scrolling layout, any pointer location extending from the right edge of the
    rightmost Column (`rect.left + rect.width + halfGap`) to the right boundary of
    the Viewport resolves as a drop target targeting the rightmost Column's pane
    with `zone = "right"`.
  - In the underlying `placeInColumns` operation, this automatically splices a new
    Column at the end of the strip (`index + 1`).
  - This applies uniformly across all drag sources: intra-tab Pane reordering,
    cross-tab Pane transfer, and Sidebar Session opens.
  - Single-pane invariant (ADR 0010) is preserved: dragging within a Tab with
    only 1 Pane produces no valid drop target (`target: null`).
- **Trailing canvas width**:
  - Scrolling canvas does not append extra padding beyond the final Pane gap.
    When Columns are narrower than the Viewport, the unused Viewport area remains
    a valid drop target; when Columns overflow, the canvas ends at the last Column's
    trailing gap.
- **Bidirectional edge auto-scrolling during drag**:
  - A 56px trigger zone is established on both left and right edges of the Viewport.
  - When dragging enters an edge zone, an active `requestAnimationFrame` loop
    smoothly scrolls `viewport.scrollLeft` (variable velocity 3px–20px/frame based
    on penetration depth).
  - Drop targets and preview indicators continuously update on each frame as
    `scrollLeft` shifts.
  - The loop terminates immediately upon pointer release, cancel, exiting the
    edge zone, or while the pointer is over the Sidebar. Sidebar drags resolve their
    own drop targets, so workbench edge auto-scrolling suspends for as long as the
    pointer stays over the Sidebar and resumes when it returns to the Viewport.

## Consequences

- Dragging Panes and Sessions to the open right canvas feels natural and immediate,
  matching spatial layout intuition without requiring micro-precision splits.
- Workbench Viewports never hitch or toggle vertical scrollbars, preventing layout
  shifts across tab switching, resizing, and deep pane stacking.
- Horizontal navigation across wide multi-column layouts is effortless via
  continuous edge auto-scroll during drag.
