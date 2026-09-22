# acode

A desktop console for running and driving coding agents. Projects hold
Workspaces; Sessions belong to Workspaces; Views present Workspace or Session
state and are displayed as Panes in Tabs.

## Language

**Environment**:
A connected execution-environment scope backed by one ACode daemon/server. It
scopes Project, Workspace, and Session identities and capabilities; it is not
itself a Project or Sidebar grouping.
_Avoid_: Host, Machine, Daemon

**ACode Deep Link**:
A canonical navigation address that identifies one ACode target by its
Environment- and target-level identities. It opens or focuses a View but is
not the authority for Tab, Pane, focus, or layout state.
_Avoid_: Workbench URL, layout URL, Thread URL

**Project**:
A registered logical project root in acode. It is the canonical top-level
domain identity in the Sidebar; external project records are integration
references and do not replace the ACode Project identity.
_Avoid_: Repo, Repository, Folder (as UI labels)

**Workspace**:
One stable checkout of a Project. It may be the Project's main checkout or a
Git worktree. A Workspace has its own ACode identity independent of its current
branch, commit, or detached-HEAD state. Its display title is Workspace metadata,
not Project identity; renaming a Workspace does not rename its Project, and
renaming a Project does not rename its Workspaces. Sibling Workspaces of one
Project are different checkouts of the same repository.
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

**New Agent Session View**:
A Workbench View for composing the first turn of an Agent session before an
ACode Session identity exists. It is bound to a Workspace and a client-local
draft identity, not a Session; promotion replaces it with the Agent Session
View for the Session created on first send.
_Avoid_: Draft Session, Provisional Session, Thread

**Workspace View**:
A View whose target is a Project or Workspace concern rather than a persistent
Session, such as files, Git state, or plugin-provided workspace content. It
does not require the daemon to hold a long-lived Session.
_Avoid_: Session, Workspace panel

**File View**:
A Workspace View for browsing, previewing, and editing files relative to its
Workspace. Its content is addressed by Workspace path and does not require an
Agent Session or Thread.
_Avoid_: File panel, File browser

**Git View**:
A Workspace View for inspecting Git state and changes in its Workspace. It
presents the checkout's worktree state rather than owning a Session or running
Git operations on the user's behalf.
_Avoid_: Diff panel, Source Control Session

**Application View**:
A View whose target is application-level content rather than a Project,
Workspace, or Session, such as cross-workspace pull requests, issues,
notifications, or account status. It does not depend on a particular Workspace
or Session for its identity.
_Avoid_: Global View, Workspace View, Session View

**View definition**:
The registered kind of a View, with its identity and renderer. A definition
describes what can be opened and may be supplied by acode or a plugin; it is
not one opened occurrence.
_Avoid_: Panel registration, View instance

**View instance**:
One client-owned occurrence of a View definition bound to its target and
referenced by a Pane. Copying or moving an instance changes presentation
references, never Session or Workspace work.
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
each Workspace's Sessions. It is a full-height column ("贯通式") running from
the top of the window to the bottom, and houses primary window and settings
controls when expanded.
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

**Appearance**:
The client presentation preferences governing color scheme, interface contrast,
typography, and desktop window translucency.
_Avoid_: Display settings, Styling preferences

**Theme**:
A coherent set of semantic color tokens mapping canonical UI roles to concrete
color values for light or dark modes.
_Avoid_: Skin, Palette file, CSS style

**Window Glass**:
The desktop-translucent frosted glass effect achieved through native OS window
composition (macOS WindowServer blur or Windows Acrylic/Mica) and client tinting.
_Avoid_: CSS blur, Backdrop filter, Translucency hack

**Glass Stage**:
The native desktop composition layer behind the web view that supplies the
window-wide frosted-glass base. It is a platform capability, not a Theme,
Sidebar, Workbench, or View.
_Avoid_: Glass background, CSS stage, Global blur layer

**Material Surface**:
A user-visible chrome layer that intentionally supplies a background material
over the Glass Stage. Sidebar, Topbar, Workbench, and Overlay are Material
Surfaces; they own their material settings and edges.
_Avoid_: Panel background, Widget background, Arbitrary glass layer

**Content Layer**:
The text, controls, and View content rendered above Material Surfaces. A
Content Layer renders with a transparent base background and does not own the
background material for its containing area.
_Avoid_: Pane background, View background, Opaque content shell

**Workbench Glass**:
The presentation toggle determining whether the Workbench main pane adopts
Window Glass translucency or stays opaque.
_Avoid_: Body glass, Main pane glass

**Topbar Surface**:
The horizontal title and tab chrome above the Workbench, alongside the
full-height Sidebar when expanded. It is a distinct Material Surface whose
visual continuity with the Sidebar does not merge their layout ownership.
_Avoid_: Header, Toolbar, Tab strip

**Workbench Artwork**:
An optional image layer shown beneath all Workbench content and above the
Workbench Material Surface. It belongs to the Workbench rather than any one
View, Session, or Tab.
_Avoid_: Chat wallpaper, Session background, View background

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
- A client-local Agent draft is a New Agent Session View, not a Session; no
  Session identity exists until promotion.
- A Workspace has at most one client-local Agent draft, and each draft has at
  most one New Agent Session View across the Workbench. Different Workspaces
  may have distinct drafts; the same draft cannot appear in multiple Tabs.
  Closing its View retains the draft; discarding it is explicit.
- An ACode Deep Link never targets a New Agent Session View. A draft route is a
  client-local recovery input, and promotion replaces it with the canonical
  Agent Session route.
- A Tab belongs to no Project or Workspace and may display Views from multiple
  Workspaces or Projects.
- A Pane displays exactly one View instance and is never empty.
- A Session may have multiple Session View instances across Tabs, but its
  Session View may appear at most once in any one Tab.
- Closing one Session View only detaches that View; closing a Session removes
  every Session View for it from every Tab while preserving its History entry.
- Terminal Sessions are presented only by Terminal Session Views; an Agent
  Session View does not own or embed a Terminal Session.
- A View may present a Session or Workspace without owning its work lifecycle.
- Multiple Views may reference the same Session.
- Opening an unopened Session or draft from the Sidebar opens it as the sole View in a new Tab (or replaces an active Welcome Tab), rather than adding a Pane to the current Tab.
- Activating a Session that already has an opened Session View focuses that existing View and activates its Tab.
- Splitting within an active Tab is explicit through keyboard modifiers or drag-and-drop.
- Runtime and provider implementation details must not define ACode domain
  identity.
- Provider-native lifecycle commands may implement ACode Session operations,
  but they do not add user-visible Session actions or lifecycle states.
