# Adopt Monocode's BSP layout primitives, then prune

The ACode workbench splits a single Tab into BSP Panes. We adopted `hardbeat920/monocode@25dd57e599e33a1878ce7e45a3187f7863b8d74f`'s `src/lib/layout.ts` verbatim into `apps/web/src/workbench/layout.ts` and removed the parts that couple the layout to Monocode's tab model (`EditorPane`, `terminalPanes`, `FilePaneTab`, `PlanTabSource`, `AgentTabSource`, `CommitTabSource`, `ReleaseNotesTabSource`, `SessionChangesSource`, plus every constructor/open function that referenced them). What we kept is the BSP split tree, sash geometry, drop-edge math, and the pure operations (`splitPane`, `removePane`, `setSplitRatio`, `leafIds`, `siblingLeafId`, `placePane`, `movePane`, etc.) — the part C12 (cross-pane drag-and-drop) and C13–C14 (Scrolling layout) will reuse.

## Status

Accepted (C10).

## Context

A clean-slate BSP workbench needs a few hundred lines of geometry that Monocode had already shipped, tested in production, and stabilized over multiple releases. Rewriting that code from scratch (option B in the C10 grill Q1) would re-create the bugs Monocode fixed, cost implementation time we want to spend on the ACode-specific View layer, and delay C12/C13 which share most of the same primitives. The D-series decisions already established that we prefer adopting mature implementations over reimplementing equivalent infrastructure.

## Considered Options

- **Adopt verbatim and prune.** Take Monocode's `src/lib/layout.ts` as a starting point, then delete the editor/terminal/orchestration concepts that don't apply to v1. Keep Monocode's pure-function tests (renamed/restructured where the surface changed). Document the prunings so future readers understand which lines of the donor code map to nothing.
- **Rewrite from scratch.** Re-design `LayoutNode` and the operations with the same surface (`splitPane`, `removePane`, …) but ~200 lines scoped exactly to ACode's needs.
- **Adopt verbatim and keep everything.** Use Monocode's full `WorkspaceTab` model, including `editorPanes` and `terminalPanes`. Would force the ACode workbench into Monocode's notion of "tab" (one file-editing surface + N terminal panes), which is the wrong shape for C10.

## Decision

Adopt verbatim and prune. Concretely:

- The kept core (`LayoutNode`, `splitDir`, `splitPane`, `removePane`, `setSplitRatio`, `splitSizesAtBoundary`, `leafIds`, `firstLeafId`, `siblingLeafId`, `layoutLeaves`, `layoutSashes`, `paneEdgeFromPoint`, `movePane`, `placePane`, `placeLayout`, `replacePaneWithLayout`) maps directly onto the BSP workbench and onto C12–C14's needs.
- The pruned concepts (`EditorPane`, `terminalPanes`, `FilePaneTab`, `PlanTabSource`, `AgentTabSource`, `CommitTabSource`, `ReleaseNotesTabSource`, `SessionChangesSource`, `SurfaceKind`, `withSurfacePanes`, `surfacePanes`, all `is<Tab>` guards, all `new<Role>` constructors) belong to Monocode's editor/terminal/orchestration shell, which v1 does not adopt.
- The kept tests live in `apps/web/src/workbench/layout.test.ts`; tests that referenced the pruned concepts were dropped, not ported.
- Strict-mode fixes (`noUncheckedIndexedAccess`) were applied to the kept code paths to match the ACode TypeScript baseline. These were the only behavioral edits — the geometry itself is unchanged.

## Consequences

- A future maintainer reading `layout.ts` will see comments noting the donor and what was pruned. Without this ADR they might assume the BSP code is original ACode work and reach for `git blame` expecting to find ACode authors.
- The file carries an explicit `import type { ReleaseNotesTabSource } from "./releaseNotes";`-free header explaining the adopted-from / pruned-of split. If we later re-import a Monocode file (e.g., to pull in their `paneDrop.ts`), that header should be updated.
- Strict-mode fixes (the `child === undefined` guards inside `for` loops) are ACode-specific patches on top of Monocode's code; they are necessary for `tsc --noEmit` to pass and do not change semantics. If we sync the file from upstream, these guards must be reapplied.
- The kept pure functions are reused in C12 (drag-drop), C13 (Scrolling layout), and C14 (Scrolling layout refinements). Pulling in Monocode now means those tickets won't need a second adoption pass.