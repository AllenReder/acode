# acode

A desktop console for running and driving coding agents. Projects hold
Workspaces; Sessions belong to Workspaces; Views present Workspace or Session
state and are displayed as Panes in Tabs.

## Language

**Project**:
A registered logical project root in acode. It is the canonical top-level
domain identity in the Sidebar; external project records are integration
references and do not replace the ACode Project identity.
_Avoid_: Repo, Repository, Folder (as UI labels)

**Workspace**:
One stable checkout of a Project. It may be the Project's main checkout or a
Git worktree. A Workspace has its own ACode identity independent of its current
branch, commit, or detached-HEAD state. Sibling Workspaces of one Project are
different checkouts of the same repository.
_Avoid_: Session, Checkout. Not paseo's Workspace, which is a `cwd` that
happens to carry a branch.

**Session**:
A persistent unit of work belonging to exactly one Workspace. Agent sessions
and terminal sessions are the current Session kinds; each has an ACode identity
independent of the runtime process or provider-native session currently backing
it. A Session may be active, stopped, resumable, or closed according to its
kind and provider capabilities, and Sessions are listed at the third level of
the left sidebar. A Session is not itself the content shown in the main area.
_Avoid_: Task, Job, Run. Not paseo's per-client connection, and not the
provider's own session log.

**View**:
A client-owned presentation bound to a Workspace or Session: for example an
agent conversation, terminal, file browser, git status, or content contributed
by a plugin. A View is the content shown in the main area; the Sidebar exposes
navigation references to the underlying Project, Workspace, and Session. A View
has no independent work lifecycle; opening, moving, copying, or closing a View
does not create or terminate the underlying Session or Workspace work.
_Avoid_: Panel, Surface, Tool, Widget

**Workbench**:
The client-owned organizer of Tabs and their View instances. It accepts
navigation requests from the Sidebar and manages presentation focus and
layout, but it does not own the lifecycle of Projects, Workspaces, or Sessions.
_Avoid_: Shell, Session manager, Navigator

**Session View**:
A View whose target is an Agent session or Terminal session and which presents
that Session's current work. A Session View may be opened in multiple Tabs, but
the same Session has at most one Session View in any one Tab.
_Avoid_: Session, Runtime panel

**Workspace View**:
A View whose target is a Project or Workspace concern rather than a persistent
Session, such as files, Git state, or plugin-provided workspace content. It
does not require the daemon to hold a long-lived Session.
_Avoid_: Session, Workspace panel

**View definition**:
The registered kind of a View, with its identity and renderer. A definition
describes what can be opened and may be supplied by acode or a plugin; it is
not one opened occurrence.
_Avoid_: Panel registration, View instance

**View instance**:
One client-owned occurrence of a View definition bound to its target Workspace
or Session and referenced by a Pane. Copying or moving an instance changes
presentation references, never Session or Workspace work.
_Avoid_: Session, process, daemon entity

**Workspace path**:
A normalized path relative to a Workspace root, used by file and Git Views as
the stable file identity. Absolute machine paths and provider-native paths are
not Workspace paths.
_Avoid_: cwd, absolute path, repository path

**View data source**:
The typed source of snapshots and updates consumed by a View. It hides whether
the data came from a client plugin, runtime RPC, or another implementation
detail. A View uses typed capabilities for commands; it does not own the
lifecycle of the data it presents.
_Avoid_: DaemonApi, wire message, local filesystem

**View capability**:
A bounded, typed operation that a View or plugin may request for its target,
such as opening, renaming, stopping, or deleting a Session. A capability
grants an operation, not ownership of the target's lifecycle.
_Avoid_: Global store access, daemon handle, unrestricted command

**Welcome View**:
The ordinary initial View shown when a Workbench has no opened Session. It may
offer actions such as adding a Project, selecting a Workspace, or creating a
Session, but it does not represent or own a Session.
_Avoid_: Empty pane, Start session

**Tab**:
A working area, created by the user or supplied as the default initial area,
that arranges Panes. A Tab belongs to no Project and no Workspace: its Panes
may display Views from any Workspace of any Project.
_Avoid_: Workspace, Group, Deck, Page. A Tab is not paseo's Tab, which is a
view inside one Workspace.

**Pane**:
The smallest functional window in a Tab, holding exactly one View instance.
Panes and Tabs are layout concepts; a Pane is never an empty or standalone
Session state.
_Avoid_: Panel, Widget, Window, Split

**Pane content**:
The presentation of the View held by one Pane. It is independent of the
Sidebar, Tab, and layout tree, and adapts to the Pane's available size and
focus state.
_Avoid_: Pane layout, Shell, Global panel

**Sidebar**:
The client-owned navigation tree that exposes Projects, their Workspaces, and
each Workspace's Sessions.
It is a navigator for work and references, not another Tab or Pane.
_Avoid_: Rail, Workspace panel

**Tab title**:
The user-visible name of a Tab. It is derived from the first Pane until the
user overrides and locks it manually.
_Avoid_: Workspace name, Window title

**History**:
The complete, Workspace-grouped index of `closed` Agent and Terminal Sessions
that remain resumable when supported after their active runtime process is
released. History is an ACode concept; provider or T3 archival states are only
integration details.
_Avoid_: Archive, Deleted sessions

**BSP layout**:
A Tab layout that recursively divides its available rectangle along stored
horizontal or vertical axes; each leaf is one Pane. It is inspired by
Hyprland's Dwindle interaction, but is acode's own stable split model.
_Avoid_: Dwindle (unless referring to Hyprland)

**Scrolling layout**:
A Tab layout whose Panes are arranged in an ordered horizontal strip of
Columns; each Column stacks Panes vertically and the strip can move
horizontally beyond the viewport.
_Avoid_: Scroll bar, scrolling Split

**Column**:
A first-class unit inside a Scrolling layout. It owns one width policy and a
vertically ordered set of Panes whose shares fill the Column's height.
_Avoid_: Split (when referring to a Scrolling layout Column)

**Agent session**:
A Session representing one agent conversation: one provider, one model
selection, one Workspace, and one transcript. Its ACode identity is distinct
from any provider-native runtime or thread identifier.
_Avoid_: Agent, Task, Job, Run

**Terminal session**:
A Session representing one Workspace-owned terminal work context, including its
terminal history and resumable state when supported. Its ACode identity is
independent of the current PTY process and terminal emulator instance.
_Avoid_: Terminal, Terminal pane, PTY

**Provider**:
An agent runtime integration such as Codex, Claude Code, or OpenCode that can
create and drive Agent sessions through a common provider capability catalog.
_Avoid_: Harness (as the only provider identity), CLI, Model

**Provider capability catalog**:
The registry exposed to the client describing available providers, provider
instances, models, authentication state, and supported operations. The client
discovers capabilities instead of hard-coding a provider list.
_Avoid_: HarnessId union, Provider menu, Model list

**Daemon sidecar**:
A local runtime process used by the desktop application to host provider
runtimes, active Session execution, PTYs, and persistence behind typed
contracts. Its transport, supervision mechanism, and provider-native runtime
identities are implementation details and do not define ACode domain identity.
_Avoid_: Tauri command, Renderer process, Pane runtime

**Agent timeline**:
The structured presentation of an Agent session's turns and runtime events,
including user/agent text, reasoning, tool activity, approvals, and failures.
It is distinct from terminal output and provider-native protocol details.
_Avoid_: Raw transcript, Terminal output, Provider protocol

**Terminal emulator**:
A Pane content that interprets a Terminal Session's PTY stream as a terminal
screen with ANSI styling, cursor state, alternate-screen behavior, selection,
scrollback, and responsive dimensions.
_Avoid_: Terminal text, Preformatted output, Agent timeline

## Core invariants

- A Project owns zero or more Workspaces.
- A Workspace belongs to exactly one Project.
- Workspace identity is independent of Git branch, commit, or HEAD state.
- A Session belongs to exactly one Workspace.
- The current Session kinds are Agent session and Terminal session; other
  main-area content is a View, not a Session.
- Session identity is independent of its runtime process and provider-native
  session identity.
- Closing a View, Pane, or Tab does not by itself stop or delete a Session;
  Session lifecycle actions are explicit.
- A Workbench may contain multiple Tabs, and each Tab owns its own Pane and
  Session View uniqueness rules.
- A Workbench with no opened Session shows a Welcome View rather than an empty
  Pane.
- A Tab belongs to no Project or Workspace and may display Views from multiple
  Workspaces or Projects.
- A Pane displays exactly one View instance and is never empty.
- A Session may have multiple Session View instances across Tabs, but its
  Session View may appear at most once in any one Tab.
- Closing one Session View only detaches that View; closing a Session removes
  every Session View for it from every Tab while preserving its History entry.
- A View may present a Session or Workspace without owning its work lifecycle.
- Multiple Views may reference the same Session.
- Runtime and provider implementation details must not define ACode domain
  identity.
