# Fluid closing and layout compensation animation architecture

**Status: accepted**

Closing a Tab in the Topbar Surface or an active Session in the Sidebar triggers
a 220ms dimension contraction and fade-out animation. Neighboring items slide smoothly
into vacated slots via natural flexbox layout flow rather than jumping abruptly.

## Context

Previously, closing a Tab or Session immediately removed its data record from state,
causing an instantaneous DOM unmount. Subsequent items snapped immediately into their
new coordinates with zero transition, creating visual disorientation and causing
miss-clicks during rapid successive closures.

## Decision

- **Dimension contraction over manual sibling FLIP**: Rather than computing artificial
  FLIP translation coordinates for every surviving sibling, the closing item contracts
  its physical layout dimension in the DOM flow (horizontal width/padding to 0px for Tabs,
  vertical height/padding to 0px for Sessions) alongside opacity fade to 0 using Apple
  fluid damping (`cubic-bezier(0.22, 1, 0.36, 1)`, 220ms). Surviving siblings naturally
  and smoothly slide into place driven by the CSS layout engine.
- **Zero-latency active context switching**: When the active Tab is closed, the main
  Workbench viewport immediately (0ms) switches to the adjacent Tab to avoid perceived
  interface latency, while the closed Tab gracefully executes its 220ms collapse in the
  Topbar chrome before unmounting.
- **Concurrent non-blocking closing queue**: Each closing item tracks its own collapse
  state independently. Rapid consecutive clicks on multiple close buttons contract
  concurrently without artificial lockouts or dropped clicks.
- **Pointer event isolation**: Collapsing elements immediately receive `pointer-events: none`
  to prevent double-triggers or accidental interactions during the exit transition.
- **Single Tab domain invariant**: The close action is disabled when only one Tab remains,
  preserving the domain rule that a Workbench always displays at least one presentation context.

## Consequences

- Tab and session dismissals match native macOS desktop windowing and browser polish.
- Layout flow remains mathematically sound and resilient across variable screen widths and
  tab counts without complex JavaScript coordinate tracking.
- Rapid tab cleanup workflows feel responsive and fluid.
- The single-Tab invariant only binds the final Tab: an explicit Pane or Session
  close that empties a non-final Tab closes it (ADR-0023).
