# An explicit close that empties a Tab closes that Tab

**Status: accepted**

When an explicit close removes a Tab's last non-Welcome Pane, the Tab is closed
rather than reset to a standing Welcome Tab. The same rule covers the Sidebar
session lifecycle actions (close/delete, which remove the Session's View from
every Tab) and the Pane close button. A Workbench still always keeps at least
one Tab: when the emptied Tab is the only one, it recovers Welcome in place
(ADR-0013). Background reconciliation keeps its old behavior and still restores
Welcome instead of closing Tabs.

## Context

ADR-0002 modeled the Workbench boundary with a standing Welcome Tab: "opening a
first target replaces that View; closing the last real View restores it." That
read well for the single-Tab default, where the Workbench must always show a
presentation context. As multi-Tab became the norm, the same "restore Welcome"
rule applied per Tab produced orphan Welcome Tabs: closing a Session from the
Sidebar removed its Session View but left an empty Welcome Tab behind
(issue #139). Closing the sole Pane of a Tab through the Pane header had the
same result.

A Session has exactly one Session View across the Workbench (ADR-0010), so a
Sidebar close removes at most one Pane from any one Tab. When that Pane was the
Tab's last View, the Tab had no remaining work to present.

## Decision

- **Explicit close empties a Tab -> close the Tab.** `applyClosePane` (Pane
  header / `closeView`) and `applyRemoveSessionViews` (Sidebar close/delete) now
  remove the emptied Tab instead of clearing it to Welcome.
- **A Session that disappears from the projections is a close.** The Workbench
  observer that removes a vanished Session's Views calls the same
  `applyRemoveSessionViews`, so it closes the orphan Tab too; the Session is
  gone, and its Tab has no work left to present.
- **The Workbench keeps at least one Tab.** When the emptied Tab is the only
  Tab, it recovers Welcome in place, exactly as before. The Tab-closing
  invariant from ADR-0013 is unchanged.
- **Active Tab replacement follows Tab close.** Closing the active Tab focuses
  the survivor at the closed Tab's index, else the last survivor, through the
  shared `activeTabIdAfterClose` rule that `applyCloseTab` also uses. Closing a
  background Tab never changes the active Tab.
- **Closing a sole Welcome Pane stays a no-op.** A Welcome Pane is not real
  work; closing it leaves the Welcome state in place.
- **Non-Session reconciliation is unchanged.** Snapshot Session-View dedupe
  (`applyDedupeSessionViews`), removed-Workspace pruning
  (`applyPruneWorkspaceViews`), and discarding a New Agent Session View
  (`applyRemoveNewAgentSessionViews`) still restore Welcome rather than closing
  Tabs. Only the Session-View removal path (`applyRemoveSessionViews`) and the
  explicit Pane close close Tabs; the emptied-Tab policy is an argument to the
  shared removal helper, defaulting to the old Welcome behavior.
- **Tab/Pane close animation is unchanged.** A Tab removed as a side effect of
  a Pane/Session close unmounts on the state change; the 220ms Topbar
  contraction stays the domain of the direct Tab-close gesture (ADR-0013).
  Per the Workbench invariant, a Tab change caused by closing a Tab lands
  instantly on the canvas.

## Consequences

- The Sidebar and Pane close gestures no longer leave orphan Welcome Tabs, and
  a Session that vanishes from the projections takes its orphan Tab with it.
- ADR-0002's "closing the last real View restores it" now holds only for the
  final Tab and for non-Session reconciliation; this ADR narrows it for Session
  View removal.
- Callers that relied on "close empties -> Welcome" for explicit close paths
  (tests included) must expect the Tab to be gone instead.
- A Session's zero-turn deletion still runs: `closeView` notifies its View
  closures after the state change, whether the close emptied a Pane or a Tab.
