# Right-button layout pan and stacked Tab switch

**Status: accepted**

The Workbench gains a unified horizontal navigation gesture built on the right mouse
button: a right-drag inside the Workbench canvas pans a Scrolling layout, and — once
the layout cannot pan any further (always, in a BSP layout) — continues into a stacked
Tab switch that slides a rigid two-Tab strip under a non-linear scale dip. Shift+wheel
and horizontal trackpad/wheel deltas drive the same Tab switch. Every user-initiated
Tab switch (click, keyboard, gesture) now plays that stacked transition, and the Topbar
expresses the active Tab with a moving theme-color underbar instead of bold text.

## Context

The left mouse button is fully committed inside the Workbench: it focuses content,
selects text, and moves Panes from the Pane header. There was no gesture for navigating
the Workbench as a whole, so wide Scrolling layouts could only be traversed by wheel or
by the edge auto-scroll that runs during a left-drag. Adjacent Tabs had no visual or
gestural relationship: switching Tabs was an instant `display` toggle, so the Workbench
never felt like one surface. ADR-0012 explicitly reserved a seam for a right-button drag
interaction in Issue #108.

A first draft of this interaction (Grill session on Issue #108) considered an elastic
Tab indicator that stretched across two Tabs while dragging. We rejected the stretch:
it made the indicator's width carry gesture state and read as a second animation.

## Decision

- **Right-drag is horizontal-only and lives on the Workbench stage.** A right-pointer
  press anywhere in the Workbench canvas — including Pane content such as terminals and
  editors — arms the gesture. Vertical movement is ignored because the Workbench
  Viewport never scrolls vertically (ADR-0015).
- **Two sequential phases, one gesture.**
  - **Phase 1 — Layout pan** (Scrolling layout only): the pointer delta maps 1:1 onto
    `viewport.scrollLeft`, clamped to `[0, maxScrollLeft]`.
  - **Phase 2 — Stacked Tab switch**: the first pixel of pointer travel that the layout
    cannot consume becomes Tab-switch progress. BSP layouts have no Phase 1 and enter
    Phase 2 directly; a Scrolling layout whose content does not overflow behaves the
    same way.
- **Rigid strip, dip scaling.** The outgoing and incoming Tabs are laid out as two
  full-size cards, one viewport width apart. Progress `p` translates both cards as a
  rigid strip by one viewport width in the switch direction while applying the same
  scale to both, `s(p) = 1 - 0.06 * (1 - |2p - 1|)`: full size at the ends, 94% at the
  midpoint. Cards never change opacity; the gaps opened by the scale reveal the
  Workbench Material Surface behind them, producing the stacked-card depth.
- **The moving cards stay compositing-neutral.** The transition wrapper and cards must
  not introduce `will-change`, `backface-visibility`, `border-radius`, `overflow`, or
  `box-shadow`. Any of these makes the browser build a render surface around the moving
  card, which drops the `mask`/`clip-path` on descendant `backdrop-filter` glass (the
  Chat composer and its attached banners) and paints it as a hard rectangle for the
  duration of the switch. For the same reason, `backdrop-filter` is disabled on every
  descendant while a card is in motion.
- **Direction follows Tab order.** Dragging the pointer left reveals the next Tab
  from the right edge; dragging right reveals the previous Tab from the left edge.
  Tab order is the Topbar's visual order and wraps cyclically.
- **Right-click vs right-drag are separated by displacement.** A right press that
  releases within the drag threshold (5px) opens the Pane context menu when it started
  on a Pane header, and does nothing elsewhere. Crossing the threshold starts the
  gesture and dismisses any open menu. Native `contextmenu` is always suppressed on the
  Workbench stage; menus over Pane content are intentionally not offered.
- **Shift+wheel and horizontal wheel deltas switch Tabs.** Each discrete notch commits
  one full stacked switch; notches during a switch are queued and played in turn.
  Before a wheel gesture is promoted to a Tab switch, every horizontal scroller between
  the wheel target and the Workbench stage — including a Scrolling layout viewport that
  still has room in that direction — is given the gesture. `shiftKey + deltaY` is
  treated as horizontal intent because Windows and Chrome do not always synthesize
  `deltaX`. The Topbar Tab strip keeps its native horizontal scrolling and never
  switches Tabs.
- **All user-initiated switches share the transition.** Clicking a Tab, pressing the
  Tablist arrow keys, focusing an already-open Tab from the Sidebar, a right-drag commit,
  and a wheel notch all play the same 220ms stacked transition with the Apple fluid
  easing (`cubic-bezier(0.22, 1, 0.36, 1)`, `FLUID_MOTION_EASING`). Switches caused by
  creating or closing a Tab stay instant, preserving ADR-0013's zero-latency close
  behaviour; only the Tab indicator animates for those.
- **Commit and cancel.** The gesture commits when progress reaches 50% or the release
  velocity exceeds the flick threshold, and otherwise animates back to 0. Interactive
  progress is linear in pointer travel; the settle to 0 or 1, and the discrete-switch
  ramp, use the Apple easing.
- **Tab indicator replaces bold text.** The active Tab keeps its `bg-foreground/5`
  background but is no longer `font-medium`. A single shared underbar, 2px tall and
  colored `--primary`, is pinned to the bottom edge of the Topbar. Its width tracks the
  active Tab's measured width and it translates as a whole — it never stretches between
  Tabs. It follows gesture progress directly, and animates with the Apple easing when the
  active Tab changes without a transition (including Tab reordering and close/new).
- **Reduced motion skips automatic motion.** When `prefers-reduced-motion: reduce` is
  set, a Tab change lands immediately, the eased settle never runs, and the indicator
  jumps without animation. A right-drag in progress still tracks the pointer directly,
  because that is direct manipulation rather than decorative motion.

## Consequences

- The Workbench reads as one continuous surface: Tabs are cards in a stack, and every
  path to a different Tab shares one motion language.
- Right-button interaction never collides with text selection, terminal input, or Pane
  dragging, all of which remain on the left button.
- Suppressing the native context menu across the Workbench stage is deliberate: Pane
  content does not own a right-click menu (the Pane header menu survives via the
  displacement threshold). Any future content that needs a context menu must claim it
  explicitly rather than inheriting the browser menu.
- The transition keeps every Tab's viewport mounted (ADR "keep-alive"), showing exactly
  two of them during a switch. Scale is a compositor transform, so terminal and editor
  content is not re-laid-out mid-transition.
