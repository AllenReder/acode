# Base layout virtual geometry for pane dragging and 4-directional edge reordering

**Status: accepted**

ACode's Workbench organizes Views into Panes inside Tabs using either BSP or
Scrolling layout. Dragging an existing Pane within a Tab resolves drop targets
against a virtual geometry grid derived from the layout without the dragged Pane.
Intra-workbench pane drag has no central "replace" zone: it resolves purely to
4-directional edge placement (Left, Right, Top, Bottom) to reorder and split
panes non-destructively.

## Context

Previously, dragging a Pane captured the pre-drag DOM bounding rectangles of
all Panes in the Tab (`paneRegions`). When the pointer moved over the region
originally occupied by the dragged Pane, hit-testing matched the dragged Pane
itself. Because a Pane cannot be dropped onto itself, this returned `null`,
creating a dead zone over the dragged Pane's original area. To place the dragged
Pane back to its original side of an adjacent Pane, the user was forced to
drag all the way into the adjacent Pane's bounding box to hit its outer edge.

In addition, dropping a Pane onto the central ("replace") zone of another Pane
in the same Tab previously executed a destructive replace, deleting the target
Pane from the Tab and destroying its View instance and associated session state.
Even non-destructive swapping in the center created ambiguity with edge splits
and added unnecessary cognitive load.

## Decision

- **Base layout derivation**: When dragging Pane A in Tab T, the drop system
  derives a virtual `baseTab` in memory with Pane A excluded (`removePane` in
  BSP mode, `reconcileColumns` in Scrolling mode).
- **Virtual geometry hit-testing**: Drop regions are computed as a virtual
  geometry grid via `computePaneLayoutRects(baseTab, viewportRect, paneGap)`.
  Pointer coordinates are tested against these virtual rectangles with half-gap
  tolerance rather than animating or stale DOM elements.
- **Continuous preview at t=0**: Because dragging begins from Pane A's header,
  `initialPaneDropTarget` anchors the initial zone to Pane A's original
  neighboring edge, ensuring zero visual jump at drag start.
- **Single-pane invariant**: If a Tab has only one Pane, dragging within the
  Workbench canvas produces no valid drop target (`target: null`). Dropping to
  the Tab strip (creating a new Tab or moving to an existing Tab) remains
  supported.
- **Intra-workbench 4-directional edge reordering**: Intra-workbench pane drag
  has no central "replace" zone. `paneDirectionalZoneFromPoint` maps points
  purely to one of the 4 directional edges (`left`, `right`, `top`, `bottom`).
  Dropping on the opposite side of an adjacent pane cleanly repositions/reorders
  the panes without any central ambiguity. Central "replace" is reserved
  exclusively for external drops from the Sidebar.
- **Layout parity**: Both BSP and Scrolling layout modes share the exact same
  virtual base layout derivation and directional edge placement semantics.
- **Synchronized Apple fluid motion**: Both existing pane frames in the
  Workbench (`.workbench-pane-frame`) and the blue drop destination indicator
  (`.workbench-drop-destination-indicator`) animate with identical Apple fluid
  damping (`cubic-bezier(0.22, 1, 0.36, 1)`) and duration (220ms).
- **Persistent destination indicator identity**: The preview destination
  indicator maintains a stable element key across pointer updates and zone
  transitions, gliding and morphing smoothly between candidate positions
  rather than unmounting and remounting on each target change.
- **Settling lifecycle**: When a drag ends (drop commit or cancel),
  `data-workbench-dragging="settling"` keeps transitions active for 240ms so
  in-flight motions settle gracefully into their final resting positions
  without abrupt snapping or layout jitter.

## Consequences

- Spatial interaction matches user intuition: dragging over the area vacated by
  the dragged Pane immediately targets the adjacent Pane's adjacent edge.
- View and session lifecycles remain completely safe: rearranging Panes within a
  Tab cannot accidentally destroy or close a running Terminal or Agent View.
- Hit-testing is purely mathematical and decoupled from DOM updates, CSS
  transitions, and React component mount lifecycles.
- Workbench reorganization feels fluid and tactile, matching native macOS
  window management and Stage Manager tiling gestures.
