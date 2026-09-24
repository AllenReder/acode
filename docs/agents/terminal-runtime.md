# Terminal runtime boundary

Issue #5 keeps the donor terminal chain intact: the server owns the real PTY
and bounded history, the typed WebSocket contracts expose lifecycle operations,
and the web client renders the stream with xterm.js (`@xterm/xterm`).
There is one terminal identity per `(workspaceId, terminalId)` pair. The
`terminalId` is always chosen by the client; `term-1` is only the conventional
first id. The old `(threadId, terminalId)` shape remains a decode-compatible
adapter for donor/setup clients and is not the Awen ownership path.

## Public operations

`TerminalManager` is the server-side public seam used by the WebSocket handlers.
The matching contracts are in `packages/contracts/src/terminal.ts` and
`packages/contracts/src/rpc.ts`.

- `open` starts a terminal lazily or returns the existing session for the same
  Workspace pair. Workspace-owned opens resolve `cwd` from the persisted
  Workspace on the daemon; callers cannot redirect them by sending another cwd.
  A PTY startup failure is represented by an `error` snapshot and event;
  the event message includes the shells that were attempted.
- `attach` attaches an existing Workspace session and streams an initial
  snapshot followed by live output, exit, error, clear, restart, and activity
  events. It does not create a missing Workspace session. Detaching removes
  only the client listener; it does not kill the PTY.
- `write` sends input bytes to the running PTY. `resize` forwards settled
  columns and rows to the PTY. The shell can observe the new size through
  `stty`/its native console API.
- `rename` sets a persistent user-owned title for an existing session.
  Terminal sessions also follow OSC 0/1/2 title updates emitted by the PTY
  until the user renames them; a manual title takes precedence thereafter.
- `clear` clears retained history, `restart` replaces the PTY in place, and
  `close` explicitly releases the session and optionally deletes its history.

The server retains up to 5,000 lines and 8 MiB per terminal. The client keeps a
separate bounded output buffer and replays the snapshot into the renderer with
replies suppressed, so restored history never answers a query against the live
shell.

## Renderer and resize behavior

`ThreadTerminalDrawer` attaches through `useAttachedTerminalSession` and sends
input and resize through `terminalEnvironment`. `XtermTerminalSurface` owns the
screen, ANSI state, cursor, selection, alternate screen, and terminal replies;
React does not interpret terminal frames.

Hidden drawers remain mounted so their PTY can continue running. The drawer
suppresses its fit/resize effects while hidden, so a hidden view does not
continuously send meaningless resize RPCs. Re-showing the drawer fits once and
reports the settled grid.

### Who answers terminal protocol queries

The renderer answers them, because it is the only component holding the state
they describe. Its replies reach the PTY through `onData`, the same path as
typed input:

- OSC 10/11/12 (foreground/background/cursor) come back with the colors the
  surface was told to paint, so the answer is right in both light and dark
  themes. While this went unanswered, Claude Code fell back to an inherited
  `COLORFGBG`, chose the light theme, and painted black text onto a dark pane.
- DSR 5/6 and DA1 come back with this screen's status, cursor position, and
  device attributes.

The daemon deliberately answers none of these. It runs no emulator, so it could
only invent a cursor position, and it cannot know which theme the client is
painting. Paseo answers them in its daemon because that daemon hosts a headless
xterm; Awen's daemon does not.

`createTerminalSpawnEnv` therefore drops an inherited `COLORFGBG` rather than
guessing an appearance, and declares the PTY it actually provides:
`TERM=xterm-256color`, `TERM_PROGRAM=awen`, `COLORTERM=truecolor`. An explicit
per-session `env` from the client still overrides those defaults.

## Workspace ownership

The Awen path maps a Terminal Session to the persisted Workspace and keeps
the PTY state in the single `TerminalManager`. The terminal summary exposes
`kind: "terminal"`, `workspaceId`, and a monotonically increasing `generation`.
The daemon persists the Session index beside terminal history. On daemon
restart, a former live generation is reported as `exited`; reopening starts a
new generation rather than pretending the old shell was recovered. Closing an
Agent or its View does not close a Workspace terminal.

Session identity remains the stable `(workspaceId, terminalId)` pair; title
changes never alter it. Workspace-created terminals receive creation-order
defaults (`Terminal 1`, `Terminal 2`, ...). A terminal-provided title is
persisted and restored until the next PTY publishes a title. A manually
renamed title takes precedence and is equally durable across that boundary.

Closing a View, Pane, or Tab remains distinct from calling `close`; `close` is
reserved for explicit terminal termination. The Sidebar can create a terminal
directly under a Workspace, including when it has no Agent Sessions.

## Validation

The real-PTY validation entry point is:

```bash
pnpm smoke:terminal
```

It uses the live `node-pty` adapter and the current host shell, then checks
ANSI color, cursor/alternate-screen control sequences, Chinese output, PTY
resize visibility, shell exit code, detach/attach history reuse, and invalid
cwd errors. It prints the host OS and shell so the evidence is tied to the
machine that ran it.

The smoke's `issue-5-terminal-smoke` id is disposable server-seam input, not
an ownership model. The donor ownership path is checked separately through the
visible Web client: `ThreadTerminalDrawer` → `useAttachedTerminalSession` →
`terminalEnvironment` → typed WebSocket contracts → `TerminalManager`.

Related regression commands:

```bash
pnpm --filter awen exec vp test run src/terminal/Manager.test.ts src/terminal/NodePtyAdapter.test.ts src/terminal/OutputProtocol.test.ts
pnpm --filter @awen/client-runtime exec vp test run src/state/terminalSession.test.ts
pnpm --filter @awen/web exec vp test run --project unit src/terminal/xterm/surface.test.ts
pnpm smoke:desktop-terminal
```

The smoke is intentionally separate from the fake-PTY unit tests: a passing
string replay cannot substitute for a real shell and native PTY. The desktop
smoke is the opposite kind of check: it drives the shipped renderer in a real
browser, because "the surface answers a color query" is a DOM behaviour that no
node-side test can observe.

## Recorded evidence

Observed on 2026-09-18 in this checkout:

- `pnpm smoke:terminal` passed on `darwin` using `/bin/zsh`; it reported a real
  PTY, resize `100x32`, shell exit `7`, ANSI/Unicode output, an interactive
  alternate-screen child that accepted input and restored the screen, live
  output after restore, detach/attach history reuse, and invalid cwd errors.
- The local v1 client was opened with `pnpm dev` on checkout
  `codex/implement-5`. The terminal drawer accepted `printf` input, rendered
  `AWEN_UI` and `AWEN_UI_RED 中文`, and restored both lines after the drawer
  was hidden and shown again. This exercised the typed client path named above;
  no agent turn was sent during this check.
- `pnpm smoke:desktop-terminal` failed on Chromium when the renderer's protocol
  replies were suppressed and passed once they were restored, so the check is
  load-bearing rather than decorative. It also fails if a replayed snapshot
  answers a query.
- The structured startup-failure case is covered by
  `reports every attempted shell when terminal startup cannot succeed` in
  `apps/server/src/terminal/Manager.test.ts`.
- Full regression finished with 330 server test files (4,785 passed, 10
  skipped) and 388 web test files (5,022 passed); the other workspace package
  suites also passed. The repository's existing Effect suggestions and local
  storage/SQLite runtime warnings remained non-fatal.
