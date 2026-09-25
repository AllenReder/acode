# BSP and Scrolling presentation

The Workbench toolbar selects a layout per Tab. Scrolling arranges first-class
Columns horizontally with independent widths (320–2400 pixels, initially 560).
Each Column owns a stable identity and ordered Pane references with normalized
height shares. The canvas follows the viewport height; vertical scrolling belongs to Pane
content, never the Workbench viewport (ADR-0015). Horizontal trackpad gestures
are captured before terminal wheel handling; vertical gestures remain content
scrolling. A shift-modified vertical wheel is treated as horizontal intent and,
once the layout and any nested scroller are at their horizontal limit, advances
the Workbench Tab switch instead of a Pane Column (ADR-0019).

A Pane edge drop to the left/right creates a Column; top/bottom stacks into the
target Column. Column controls reorder Columns and their Panes, and let users
choose an existing Session for a new Column or stacked Pane. They never create
work. A Session already displayed in that Tab is focused instead of duplicated.
Duplicate pane creates another View in a new Tab; that Tab can use either layout.
Moving a View to a Tab preserves its identity and removes empty source Columns.
Closing the last Pane returns Welcome in the selected layout.

On first BSP → Scrolling conversion, BSP leaf reading order becomes one Column
per Pane. First Scrolling → BSP conversion uses left-to-right Column order and
top-to-bottom Pane order, splitting right of the last leaf. Subsequent switches
restore each mode's previous structure. The current Pane map remains authoritative:
saved structures are filtered for deleted references and new references are added
in current reading order. Layout memory has its own version; unknown memory is
ignored. Invalid Column metadata falls back to one Column per valid reference.
Invalid required Workbench data follows the existing Welcome and backup policy.
Restoration performs no Session creation commands.

Pane content is a flat sibling list keyed by View instance identity, with geometry
computed separately. Layout mutations do not remount content. Terminal resize
continues through the existing focused/visible View gate. The focused Column is
revealed on focus, layout, and viewport changes. Manual scrolling does not change
focus or stop work. Resize uses direct geometry; reordering uses a 220ms transform
animation, disabled by the system's reduced-motion preference. Pointer resize
listeners are removed on completion, cancellation, and unmount.

Drop previews are read-only. The store rejects previews whose source snapshot is
stale; pointer release recomputes the command against current state. Escape or
pointer cancellation makes no presentation change.

Validation: the public Workbench store and persistence tests cover conversion,
stacking, extraction, moves, stale previews, recovery, and close behavior. PaneTree
integration tests preserve an unfinished input through layout mutations. The
Workbench E2E exercises the real terminal emulator, resize, layout switching and
existing drag/drop/session lifecycle regressions. Real provider turns require a
separate smoke with the models allowed by AGENTS.md.

Review notes: the Standards review found no documented-standard breaches. Its
column identity collision and missing focus-reveal dependency findings were fixed,
and the shared width bound was centralized. Spec verification covers store
operations, persistence, stable View mounts, and the real PTY E2E. Native Awen
Dev verification observed shell PID 12265 before and after BSP/Scrolling switches.
A real streaming Agent turn was not run; provider continuity relies on preserving
the existing View component and runtime subscription, with that live-provider
acceptance check remaining a manual follow-up.
