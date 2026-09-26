# One checkout owns one dev data root and port set

**Status: accepted**

For development, one checkout owns exactly one Awen data root (`<checkout>/.awen`)
and one resolved port set. `pnpm dev` (browser client plus web-mode server) and
`pnpm dev:desktop` / `pnpm dev:app` (Tauri window plus managed daemon) resolve
their ports through one shared authority, so they either agree or fail loudly.
Running both stacks in the same checkout is unsupported; concurrent desktop dev
happens across git worktrees, each with its own `.awen` and its own path-derived
port offset.

## Context

Dev had two entry points that resolved ports independently. The dev-runner
(`scripts/dev-runner.ts`) resolved an offset as `AWEN_PORT_OFFSET` →
`AWEN_DEV_INSTANCE` → a hash of the checkout path (`+ 1`, modulo 3000) → `0`.
The desktop wrapper (`apps/desktop/scripts/run-tauri.mjs`) read
`resolveDesktopDevPorts` from `@awen/shared/daemonPort`, which knew only
`AWEN_PORT_OFFSET` / `AWEN_DAEMON_PORT` / `AWEN_PORT` and defaulted to offset `0`.
In one checkout the two therefore targeted different ports while sharing
`<checkout>/.awen`.

That shared data root made the disagreement fatal rather than merely confusing.
The web-mode server persists a `server-runtime.json` with no `daemonManaged`
marker, so `parseLocalDaemonDiscovery` classifies it as `invalid` *before* any
liveness check. When the desktop launcher then asked to start a managed daemon in
the same root, `startLocalDaemon` refused (`discovery-invalid`) instead of
replacing the leftover descriptor, no daemon bound the port the window proxied
to, and the client surfaced a generic `PrimaryEnvironmentRequestError`. Two
worktrees could not run desktop dev side by side either, because both fixed
offset `0` and collided on 5733 / 13773.

Port resolution had already drifted once before (issue #87, where the wrapper
read only two of the four daemon-port keys and a developer's `AWEN_DAEMON_PORT`
was shadowed). That fix unified the *keys* but left the checkout-path fallback
outside the shared contract.

## Decision

- **One shared offset authority.** The full offset rule
  (`AWEN_PORT_OFFSET` → `AWEN_DEV_INSTANCE` → checkout path hash → `0`) moves into
  `@awen/shared/daemonPort`, which dev-runner and the desktop wrapper both
  consume. The shared module stays free of transitive runtime dependencies so the
  daemon launcher can keep importing it.
- **One checkout, one data root, one port set.** Browser dev and desktop dev in
  the same checkout share the web dev server and the daemon, so they are mutually
  exclusive; a second stack fails on the shared ports with a named error rather
  than silently dialing a dead one. A standalone web dev server is the shared
  resource, not just the browser client as a whole.
- **Concurrency is across worktrees.** Each worktree keeps its own `.awen` and
  gets a distinct path-hash offset, so several desktop dev sessions coexist.
- **The native shell still owns starting the managed daemon.** Only port
  resolution is unified; the browser stack's web-mode server is not promoted to a
  managed daemon.
- **Reconciliation follows port reachability and ownership, not descriptor
  claims.** The launcher may bind the requested port: then a stale or non-managed
  descriptor is replaced and a fresh managed daemon starts. The port is taken by
  our managed daemon: then it attaches. The port is taken by anything else: then
  it refuses with an error that names the conflict. A descriptor's PID liveness
  alone never decides whether to connect or to take over.

## Considered options

- **Give desktop dev its own `AWEN_HOME`** so both stacks can coexist in one
  checkout. Rejected: it splits a developer's Projects and Sessions across two
  data roots, so the browser and desktop clients stop showing the same work.
- **Document "one desktop dev at a time" and change nothing.** Rejected: it
  abandons the cross-worktree isolation the runner's path-hash rule was built
  for, and leaves the shared-descriptor failure in place.

## Consequences

- The README's claim that the desktop wrapper uses port offset `0`
  (`README.md`, "Desktop shell") is no longer true; the offset is derived from
  the checkout path unless explicitly overridden.
- A developer who insists on running browser and desktop dev in one checkout
  gets a loud port conflict instead of a dead proxy, and is directed to a
  worktree.
- The launcher gains a reconciliation rule with data-safety weight: it may
  discard a descriptor only when the port is actually free, and must never
  signal or replace a process it did not start.
