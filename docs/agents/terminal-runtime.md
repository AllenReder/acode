# Terminal runtime boundary

Issue #5 keeps the donor terminal chain intact: the server owns the real PTY
and bounded history, the typed WebSocket contracts expose lifecycle operations,
and the web client renders the stream with Ghostty's virtual-terminal ABI.
There is one terminal identity per `(threadId, terminalId)` pair. `terminalId`
is always chosen by the client; `term-1` is only the conventional first id.

## Public operations

`TerminalManager` is the server-side public seam used by the WebSocket handlers.
The matching contracts are in `packages/contracts/src/terminal.ts` and
`packages/contracts/src/rpc.ts`.

- `open` starts a terminal lazily or returns the existing session for the same
  pair. A PTY startup failure is represented by an `error` snapshot and event;
  the event message includes the shells that were attempted.
- `attach` opens or reuses the session and streams an initial snapshot followed
  by live output, exit, error, clear, restart, and activity events. Detaching
  removes only the client listener; it does not kill the PTY.
- `write` sends input bytes to the running PTY. `resize` forwards settled
  columns and rows to the PTY. The shell can observe the new size through
  `stty`/its native console API.
- `clear` clears retained history, `restart` replaces the PTY in place, and
  `close` explicitly releases the session and optionally deletes its history.

The server retains up to 5,000 lines and 8 MiB per terminal. The client keeps a
separate bounded output buffer and replays the snapshot into Ghostty without
sending historical terminal replies back to the live shell.

## Renderer and resize behavior

`ThreadTerminalDrawer` attaches through `useAttachedTerminalSession` and sends
input and resize through `terminalEnvironment`. `GhosttyTerminalSurface` owns
the canvas, ANSI state, cursor, selection, alternate screen, and terminal
replies; React does not interpret terminal frames.

Hidden drawers remain mounted so their PTY can continue running, but
`GhosttyTerminalSurface.setVisible(false)` stops fitting and painting. The
drawer also suppresses its fit/resize effects while hidden, so a hidden view
does not continuously send meaningless resize RPCs. Re-showing the drawer fits
once and reports the settled grid.

## Ownership handoff

For this ticket, `threadId` is the existing donor/provider thread identity. It
is not an ACode `Workspace` or `Session`, and this ticket does not invent a
hidden Agent session to host a terminal. The future ownership adapter must map
an ACode terminal Session to the same `(threadId, terminalId)` lifecycle
without creating a second terminal state store. Closing a View, Pane, or Tab
must remain distinct from calling `close`; thread deletion is the existing
server-side cleanup boundary.

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
pnpm --filter t3 exec vp test run src/terminal/Manager.test.ts src/terminal/NodePtyAdapter.test.ts src/terminal/OutputProtocol.test.ts
pnpm --filter @t3tools/client-runtime exec vp test run src/state/terminalSession.test.ts
pnpm --filter @t3tools/web exec vp test run --project unit src/terminal/ghostty/core.test.ts src/terminal/ghostty/keyCodes.test.ts src/terminal/ghostty/renderer.test.ts src/terminal/ghostty/runtimeAbi.test.ts src/terminal/ghostty/surface.test.ts
```

The smoke is intentionally separate from the fake-PTY unit tests: a passing
string replay cannot substitute for a real shell and native PTY.

## Recorded evidence

Observed on 2026-09-18 in this checkout:

- `pnpm smoke:terminal` passed on `darwin` using `/bin/zsh`; it reported a real
  PTY, resize `100x32`, shell exit `7`, ANSI/Unicode output, an interactive
  alternate-screen child that accepted input and restored the screen, live
  output after restore, detach/attach history reuse, and invalid cwd errors.
- The local v1 client was opened with `pnpm dev` on checkout
  `codex/implement-5`. The terminal drawer accepted `printf` input, rendered
  `ACODE_UI` and `ACODE_UI_RED 中文`, and restored both lines after the drawer
  was hidden and shown again. This exercised the typed client path named above;
  no agent turn was sent during this check.
- The existing Ghostty ABI/surface suite covered selection/copy isolation,
  alternate-screen state, cursor/input handling, and hidden-surface behavior;
  the smoke validates the PTY wire and the UI check validates the visible
  renderer rather than claiming raw escape bytes alone prove canvas rendering.
- The structured startup-failure case is covered by
  `reports every attempted shell when terminal startup cannot succeed` in
  `apps/server/src/terminal/Manager.test.ts`.
- Full regression finished with 330 server test files (4,785 passed, 10
  skipped) and 388 web test files (5,022 passed); the other workspace package
  suites also passed. The repository's existing Effect suggestions and local
  storage/SQLite runtime warnings remained non-fatal.
