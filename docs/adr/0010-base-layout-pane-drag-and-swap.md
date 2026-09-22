# Base layout virtual geometry for pane dragging and intra-tab swap

**Status: accepted**

ACode's Workbench organizes Views into Panes inside Tabs using either BSP or
Scrolling layout. Dragging an existing Pane within a Tab now resolves drop
targets against a virtual geometry grid derived from the layout without the
dragged Pane, and dropping onto the center of an existing Pane in the same Tab
swaps their positions non-destructively.

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

## Decision

- **Base layout derivation**: When dragging Pane A in Tab T, the drop system
  derives a virtual `baseTab` in memory with Pane A excluded (`removePane` in
  BSP mode, `reconcileColumns` in Scrolling mode).
- **Virtual geometry hit-testing**: Drop regions are computed as a virtual
  geometry grid via `computePaneLayoutRects(baseTab, viewportRect, paneGap)`.
  Pointer coordinates are tested against these virtual rectangles rather than
  animating or stale DOM elements.
- **Continuous preview at t=0**: Because dragging begins from Pane A's header,
  the initial pointer coordinate naturally maps to the edge of the adjacent
  Pane in `baseTab`. The preview immediately reflects Pane A in its starting
  layout and transitions smoothly as the pointer moves across zones.
- **Single-pane invariant**: If a Tab has only one Pane, dragging within the
  Workbench canvas produces no valid drop target (`target: null`). Dropping to
  the Tab strip (creating a new Tab or moving to an existing Tab) remains
  supported.
- **Intra-tab Swap**: When dropping Pane A into the center ("replace") zone of
  Pane B in the same Tab, the operation executes a non-destructive Swap
  (`swapLeaves` in BSP mode, `swapInColumns` in Scrolling mode). Both View
  instances and their running session states are preserved. Dragging from the
  Sidebar into the center retains the Replace semantics.
- **Layout parity**: Both BSP and Scrolling layout modes share the exact same
  virtual base layout derivation and swap semantics.

## Consequences

- Spatial interaction matches user intuition: dragging over the area vacated by
  the dragged Pane immediately targets the adjacent Pane's adjacent edge.
- View and session lifecycles remain safe: rearranging Panes within a Tab
  cannot accidentally destroy a running Terminal or Agent View.
- Hit-testing is purely mathematical and decoupled from DOM updates, CSS
  transitions, and React component mount lifecycles.
