# ACode v1 runtime baseline

ACode currently packages the T3 Code Web client and daemon as its first
runtime baseline. The Web client talks to a real local daemon through T3's
typed contracts and client-runtime; there is no mock server in this checkout.

## Scope

This ticket imports the Web, server, client-runtime, contracts, shared modules,
SSH helpers, provider helpers, build configuration, and the Ghostty WebAssembly
assets needed by the runtime. Only the Web and server applications are part of
the workspace build. Marketing, mobile, and desktop product entrypoints are
deferred to later ACode tickets.

The ACode guidance files (`AGENTS.md`, `CONTEXT.md`, and `docs/agents/`) remain
authoritative and were not replaced by upstream guidance.

## Requirements

- Node.js 24.13.1
- pnpm 11.10.0
- A provider CLI is optional for boot, but at least one provider must be
  installed and authenticated before starting an agent session.

The checked-in package manager installs the local `vite-plus` tool, so no
global `vp` installation is required.

## Install and run

From the repository root:

```bash
pnpm install
pnpm build
pnpm start
```

Useful development commands:

```bash
pnpm dev          # Web + daemon, with deterministic per-checkout ports
pnpm dev:server   # daemon only
pnpm dev:web      # Web only
```

The development runner keeps runtime state in this checkout's ignored
`.acode/` directory by default. An explicit `--home-dir` may be passed to the
dev runner when a different test directory is required. Port selection is
stable per checkout, and the runner advances to an available pair when needed.

To exercise the real pairing, typed WebSocket handshake, provider capability
catalog, daemon disconnect, and automatic reconnect without touching user data:

```bash
pnpm smoke:connection
```

The smoke command requires `pnpm build`, creates a temporary state directory,
and removes it after the run. Provider/auth status is read from the daemon's
capability catalog; an unavailable or unauthenticated provider is reported as
such rather than treated as success.

Cloud/relay configuration is not needed for local development. `.env.example`
contains the optional public configuration used when testing those features.

## Data and external dependencies

The daemon stores its state below `<base-dir>/userdata/` and writes the
runtime marker to `<base-dir>/userdata/server-runtime.json`. The smoke test
uses its own temporary base directory. Provider credentials remain on the
machine where the daemon runs; this checkout does not copy them.

The local provider CLIs and their authentication are external prerequisites.
`tailscale` is only needed for `pnpm dev:share`; Zig and a Ghostty source
checkout are only needed when rebuilding the vendored terminal WebAssembly.

## Source and license provenance

The imported runtime source is from
[`pingdotgg/t3code@ccf220be205f0e509021dbc8cbda90daa638e20d`](https://github.com/pingdotgg/t3code/commit/ccf220be205f0e509021dbc8cbda90daa638e20d).
See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) and
[`third-party-licenses.config.json`](./third-party-licenses.config.json) for
the consolidated license and notice inventory.

Workspace, Session, ACode layout, SSH/Tauri shell integration, and packaging
are intentionally outside this baseline.
