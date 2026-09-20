# Make ACode Session and View the workbench boundary

**Status: accepted**

ACode uses Project → Workspace → Session as its durable work model, with Agent
Session and Terminal Session as the current Session kinds. The Workbench owns
Tabs, Panes, and View instances; it does not own Session lifecycle. T3 Project,
Thread, provider runtime state, and PTY identity remain integration details
behind typed adapters rather than product-level navigation identities.

## Decision

- ACode Project is the canonical project identity. A Workspace is a stable
  checkout belonging to exactly one Project. A Session belongs to exactly one
  Workspace and is independent of its runtime process.
- A Workspace has an independent, mutable display title. Creating a Workspace
  may seed that title from its Project, but Project and Workspace renames do
  not rename each other.
- The main area renders Views, never raw Sessions. A Session View targets an
  Agent or Terminal Session; a Workspace View targets Project/Workspace content
  without requiring a daemon-held Session.
- File and Git presentation are Workspace Views. Existing file
  browsing/preview/editing and diff content may be reused, but their ownership
  must not depend on an Agent Session, a Thread, or the thread-scoped right
  panel.
- A Tab is independent of Project and Workspace. A Pane is a layout leaf that
  contains exactly one View instance. A Session View may occur once per Tab and
  may occur in multiple Tabs.
- The default Tab contains a Welcome View. Opening a first target replaces that
  View; closing the last real View restores it. Empty Panes are not a product
  state.
- Sidebar actions issue Workbench commands (`open`, `focus`, `split`, and
  `closeView`); URLs are ACode-identity deep links and are not the Workbench's
  sole state authority. Legacy Thread URLs are compatibility inputs only.
- `closeView` detaches one View instance. `closeSession` explicitly ends the
  Agent runtime or Terminal PTY, preserves identity/history, and removes every
  Session View for that Session from every Tab. Deletion is a separate
  destructive command.
- View definitions may be supplied by plugins. In the first extension seam,
  Views use typed data sources and bounded capabilities; plugins do not receive
  unrestricted store, PTY, or daemon access and do not create new Session kinds.

## Consequences

The existing Agent timeline, composer, tool/approval/error presentation, and
Ghostty terminal emulator remain reusable content. The refactor removes their
parallel T3 route, Sidebar portal, and global selected-thread ownership, and
puts T3 Thread access behind Agent data adapters. Terminal metadata must gain a
typed ACode identity and join the Workspace Session projection. The Workbench
state must explicitly model Tabs, Panes, and View instances so uniqueness and
cross-Tab close behavior are enforceable.

Provider-native thread archive, delete, stop, and metadata-update commands may
implement ACode Close, Delete, Stop, and Rename through an Agent adapter. They
do not become parallel product actions: the ACode Session command surface owns
the user-visible lifecycle. Pin, snooze, and settle are not part of that
boundary unless an explicit ACode Session model decision adds them later.
