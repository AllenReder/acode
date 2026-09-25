# Unified Session Status and Focus-Acknowledged Unread Completion

A Session row's status becomes a focus-independent `Session Status`
(`approval` / `input` / `plan` / `working` / `monitoring` / `failed` / `ready`)
shared by Agent and Terminal sessions, and a separate `Unread Completion`
decoration on `ready` rows is the only signal focus acknowledges, cleared by a
client-side `lastVisitedAt` timestamp.

## Status

Accepted. Supersedes the session-row status derivation and alert dismissal of
[ADR-0018](./0018-sidebar-session-tab-state-and-terminal-agent-detection.md);
the Status Gutter, the four Session Row Tab States, and zero-config terminal
agent detection there still stand.

## Context

ADR-0018's Status Gutter shipped five alert states derived in
`resolveAgentSessionStatusAlert` / `resolveTerminalSessionStatusAlert`, with a
`SessionRow` dismissal keyed on a string built from the _resolved_ alert. Because
`isFocused` was an input to that resolver, focusing a completed session produced
the key `idle:…` while blurring produced `completed-unread:…`; the recorded
dismissal never matched, so the green dot returned the moment focus left. The
same `isDismissed = isFocused || …` term also hid every other alert while a
session was focused, so a pending approval or a live error vanished if the user
was looking at it.

A repository audit found a second, already-working model:
`resolveSidebarThreadStatus` (`apps/web/src/components/Sidebar.logic.ts`) derives
`approval / input / working / monitoring / failed / ready` from server fields with
no focus input, and `hasUnseenCompletion` compares `latestTurn.completedAt` to a
client-side `lastVisitedAt`. Reference projects agree on the split: paseo's
terminal `attention` and orca's reader-side acknowledgement both keep status
authoritative and unread reader-made.

## Decision

1. **One focus-independent Session Status.** A single resolver derives it for
   both Agent and Terminal rows, and the pre-existing
   `resolveSidebarThreadStatus` delegates to it. Priority, highest first:
   `approval`, `input`, `working` (`session.status` of `starting`/`running`; a
   running terminal subprocess), `failed` (`session.status === "error"`, or a
   terminal error / non-zero exit), `plan` (plan-mode settled turn with an
   actionable proposed plan, not an error), `working`
   (`backgroundLiveness === "working"`), `monitoring`, then `ready`. Terminal
   maps `hasRunningSubprocess → working` and nothing else this slice. Consumers
   that used `resolveSidebarThreadStatus` observe `plan` as a distinct state, so
   thread notifications treat it as attention, not completion.

2. **Focus acknowledges only Unread Completion.** All Session Status values
   render regardless of focus. Only the green dot is cleared, and only by the
   session becoming the focused pane of the active Tab.

3. **Unread Completion is a timestamp comparison, not a focus predicate.** It is
   true when the session is `ready` and `latestTurn.completedAt > lastVisitedAt`,
   treating a missing marker as unread. Focusing stamps `lastVisitedAt` at
   `completedAt` (never backwards), so the acknowledgement survives blur and a
   later completion lights the dot again. It reuses
   `uiStateStore.threadLastVisitedAtById`, keyed by `environmentId:threadId`.

4. **Failures, approvals, input, and live work are never suppressed by focus.**
   They clear only when the server state changes.

5. **Terminal rich states arrive later through an ingest channel.** This slice
   gives terminals the same vocabulary through process detection only, with no
   Unread Completion (process exit cannot distinguish a finished agent turn from
   any other command). A follow-up ticket adds an `awen` CLI / OSC ingest that
   writes into one authoritative per-host Terminal status store, ranked
   `hook/CLI > OSC > process detection`, with unknown never collapsed to idle.
   Agent sessions keep the provider stream and do not take hooks.

## Considered options

- **Keep focus as an input to the status resolver** (the ADR-0018 shape). Rejected:
  it is the defect — focus both hides the current alert and rewrites the identity
  used to remember the acknowledgement.
- **Keep the string state-key dismissal store** (`sessionAlertStore`), merely
  removing `statusAlert` from the key. Rejected: still a mutable in-memory key per
  `sessionId` that collides across Environments; the timestamp model already
  exists and is persisted.
- **Track read state on the server.** Rejected: unread is a reader fact and
  differs per client; orca and t3code both keep it reader-side.
- **Give terminals Unread Completion now by inferring completion from an agent
  subprocess stopping.** Rejected: it misfires on ordinary commands and cannot
  tell a completed turn from an interrupt.

## Consequences

- Focusing a session and switching away leaves the green dot cleared, which is the
  reported defect's fix; pending approvals, running work, and failures stay
  visible while focused.
- `sessionAlertStore` and both `resolve*SessionStatusAlert` functions are
  removed, so the Session row runs one status cascade instead of two. The
  command palette's `resolveThreadStatusPill` stays a separate presentation
  mapping over the same fields and is not unified here.
- `ChatView`'s visit effect must stamp only while its pane is focused, otherwise a
  completion inside a kept-alive background Tab would be acknowledged unseen.
- Terminal rows gain no richer signal until the ingest channel lands; the
  provider icon from foreground-command detection is unchanged.
