# View definitions

The Workbench's in-process extension seam lives in
`apps/web/src/workbench/viewRegistry.ts`. Built-ins register in
`viewDefinitions.ts`; there is no plugin discovery or dynamic loading.

A `ViewTarget` contains an Awen Project, Workspace, Agent Session, or Terminal
Session identity, scoped to an environment. Welcome has no work target.
`definitionId` optionally selects a registered renderer; otherwise the target
kind selects the built-in definition. Project and Workspace definitions can
coexist for the same target. Session uniqueness applies across the whole
Workbench and only to Session Views: opening an already displayed Session
focuses its existing View, and an explicit split or drop moves that View
rather than replacing a renderer or creating a second Session View. File, Git,
and Project Views keep their own per-Tab coexistence rules (ADR-0008).

A `ViewDefinition<Target, Data, Capabilities>` provides:

- A stable id, label, and `accepts` type guard. Dispatch checks both id and guard.
- A trusted host `bind(target)` adapter that supplies a typed `ViewDataSource`
  and explicit `ViewCapability` commands. Binding must not acquire resources;
  subscription owns acquisition and returns cleanup.
- A renderer receiving target, Pane identity, focus, measured content size,
  the current data snapshot, and granted commands. The renderer does not
  receive the store, registry, RPC client, or PTY.

`ViewDataSource.getSnapshot` must return the same immutable object until the
snapshot changes. `subscribe` notifies on updates and returns an unsubscribe
function. React owns subscriptions, including cleanup on View replacement,
Tab switches, and close. Size is initially zero until the Pane is measured;
subsequent content-box changes propagate through `ResizeObserver`.

Commands expose a typed `execute(input)` operation. A host adapter must bind
the operation to its allowed scope and revalidate current targets at execution
time. Types do not sandbox arbitrary JavaScript; registration and binding are
trusted application code. A future plugin permission system is separate work.

`createWorkspaceViewDefinitions` demonstrates this contract with Welcome and
Workspace overview. The production adapter projects the existing runtime
Workspace read model to titles and Awen targets, excluding Thread bindings,
execution paths, PTYs, and service handles. Welcome can open an available
Workspace. Its overview can open a Session only from that Workspace's current
snapshot; unavailable targets return `false` and cause no navigation. Neither
command creates or stops underlying work.

Agent and Terminal content remain the existing trusted runtime adapters.
They receive empty extension data/capability bindings for now; migrating their
runtime content to dedicated data sources is separate from this initial seam.
