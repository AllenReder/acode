# Inactive single-pane tab canvas docking architecture

**Status: accepted**

Awen allows dragging an inactive Tab containing a single Pane from the Topbar Surface
downward into the active Tab's Workbench canvas layout (Issue #109), merging its View
into the active Tab and automatically closing the source Tab.

## Context

Previously, dragging a Tab in the Topbar Surface only supported horizontal reordering
via Apple fluid live displacement (ADR-0012). Moving a Tab downward past 12px froze
horizontal swap to reserve an interaction seam for downstream canvas docking, but canvas
drops produced no valid drop target. Furthermore, pressing pointerdown on an inactive Tab
immediately activated it, which immediately replaced the active Tab's layout on the canvas
and made it impossible to drag an inactive Tab into the current active layout.

Users frequently open standalone tabs (for example, by opening a terminal or agent session
into a new tab) and subsequently want to dock that pane side-by-side into their primary active
layout without having to manually reconstruct panes or reopen sessions.

## Decision

- **Deferred activation for inactive tabs**: Pointerdown on an inactive Tab arms drag detection
  without immediately switching `activeTabId`. The active Tab's canvas remains visible on screen.
  - If the pointer releases without exceeding the drag threshold, `onClick` activates the Tab.
  - If the pointer drags horizontally within the Topbar Surface, tabs live-swap and the dragged
    Tab becomes active upon release.
  - If the pointer drags downward past the Topbar threshold (> 12px below the tab strip), it enters
    canvas docking mode.
- **Strict single-pane and inactive qualification**: Only an inactive Tab with exactly one Pane
  (`tab.panes.size === 1`) can be docked into the Workbench canvas:
  - Dragging the active Tab downward into its own canvas yields no drop target (`target: null`),
    respecting ADR-0010's single-pane invariant.
  - Dragging a Tab with multiple panes (> 1 pane) downward yields no canvas drop target (`target: null`),
    preventing ambiguous tree-merging interactions and cognitive overload.
- **Virtual base layout and 4-directional edge placement**: In canvas docking mode, drop hit-testing
  targets the active Tab's virtual pane geometry with directional-only zones (`left`, `right`,
  `top`, `bottom`). There is no central destructive "replace" zone (respecting ADR-0010).
  In Scrolling layout mode, drops on the trailing canvas area append a new Column (ADR-0015).
- **Welcome View absorption**: If the active Tab contains solely an initial Welcome View
  (`target.kind === "welcome"`), dropping the single-pane Tab replaces the Welcome View directly
  rather than splitting it, keeping the workspace uncluttered.
- **Source Tab lifecycle and focus**: Upon drop commit, the single pane moves into the active Tab's
  layout, the source Tab is closed and removed from `snapshot.tabs`, and focus immediately locks
  onto the newly docked pane.
- **Duplicate Session prevention**: If the active Tab already contains a Session View for the same
  Session identity, the drop target is rejected (`valid: false`, ghost turns red), enforcing Awen's
  core domain invariant that a Session has at most one View per Tab.
- **Slid-out visual state and drag ghost**: When sliding out (> 12px below Topbar), neighboring tabs
  in the Topbar smoothly glide back to their resting positions, the dragged tab stays as a semi-transparent
  placeholder, and the drag ghost displays the specific View icon and title (e.g. Terminal, Agent Session).
  Sliding back up (<= 12px) smoothly reverts to Topbar horizontal reorder mode.

## Consequences

- Users can intuitively consolidate single-pane utility tabs into their active workspace layout.
- Domain invariants are preserved: tabs cannot leak empty states, and duplicate session views in
  the same tab remain strictly forbidden.
- The drag pipeline maintains architectural parity across BSP and Scrolling layouts, reusing the
  synchronized Apple fluid destination indicator and virtual geometry hit-testing.
