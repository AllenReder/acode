# Tab live fluid swap and session reordering architecture

**Status: accepted**

Awen's Topbar Surface arranges Tabs horizontally, and the Sidebar organizes active
Sessions per Workspace. Tabs support direct manual reordering via Apple fluid motion
live displacement, while Sidebar active Sessions reorder via glowing insertion markers
strictly within their owning Workspace boundaries.

## Context

Previously, Tabs in the Topbar Surface acted only as drop targets for incoming Panes;
Tabs themselves could not be dragged or reordered, leaving users stuck with chronological
opening order. In the Sidebar, session drag-and-drop lacked proper boundary enforcement:
expanding the History section contaminated the reorder query with closed sessions, and
sessions could erroneously be dragged across workspace boundaries or onto archived items.

## Decision

- **Topbar Tab live fluid swap**: Tabs in the Topbar Surface can be dragged horizontally
  with the primary mouse button. Neighboring tabs displace dynamically using Apple fluid
  damping (`cubic-bezier(0.22, 1, 0.36, 1)`) with a 220ms duration as the dragged Tab's
  midpoint crosses their centers. Releasing commits the new tab order to the Workbench Store,
  which automatically persists via the existing snapshot persistence pipeline.
- **Seam for downstream canvas docking**: A downward threshold (12px below the Topbar edge)
  pauses horizontal tab swapping, reserving a clean interaction seam for dragging single-pane
  tabs into the Workbench canvas (Issue #109).
- **Control exclusions and activation**: Pointer down on a Tab immediately focuses/activates it.
  Clicks and pointer events originating from the Tab close button ('X') and inline title
  rename input are strictly excluded from initiating drag gestures.
- **Intra-workspace active session boundary**: Sidebar session reordering is strictly
  constrained to active Sessions within the same Workspace. Closed sessions in History are
  non-draggable, reject incoming drops, and are excluded from the reordering DOM collection.
  Cross-workspace drops are rejected, preserving the domain invariant that a Session belongs
  to exactly one Workspace.
- **Visual affordance**: Topbar tabs use live displacement and elevated z-index, while vertical
  Sidebar sessions use glowing blue insertion lines (`before` / `after`) to keep vertical tree
  navigation clear and avoid layout jumpiness.

## Consequences

- Tab and session organization matches native desktop window and browser management expectations.
- Domain invariants remain strictly preserved: sessions cannot leak across workspaces or into
  archived history via drag gestures.
- The drag controller and layout system maintain clean seams for future drag interactions (such
  as right-click drag in Issue #108 and canvas docking in Issue #109).
