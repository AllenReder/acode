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

To exercise the real `node-pty` terminal path on the current host, including
ANSI/alternate-screen output, Unicode, resize, detach/attach history, shell
exit status, and invalid working-directory errors:

```bash
pnpm smoke:terminal
```

The command reports the host OS and shell used for the validation. See
[`docs/agents/terminal-runtime.md`](./docs/agents/terminal-runtime.md) for the
terminal ownership boundary and related regression commands.

Cloud/relay configuration is not needed for local development. `.env.example`
contains the optional public configuration used when testing those features.

## Desktop shell

ACode's desktop target is a small Tauri host around the same T3 Web client.
The host owns the native window, resource loading, constrained external-link
opening, and desktop connection bootstrap; agent execution, PTY state,
provider credentials, and persistence remain in the existing daemon. The
Monocode React application is not copied into this checkout.

The desktop shell asks the local daemon launcher to attach to or start the
daemon for this checkout. The daemon is detached from the window lifecycle, so
closing the desktop shell leaves work running. The wrapper uses port offset `0`
and this checkout's `.acode` directory by default:

```bash
# Tauri window, Web development server on 5733, and the local daemon launcher
pnpm dev:desktop
```

The bundled Ghostty terminal fetches same-origin WASM assets. Desktop CSP must
allow `'self'` in `connect-src` and `'wasm-unsafe-eval'` in production
`script-src`; permitting the daemon's localhost endpoint alone does not permit
bundled terminal assets. The browser smoke checks both desktop policies with
the production Ghostty loader and ensures packaged JavaScript `eval` stays
blocked:

```bash
pnpm --filter @t3tools/scripts exec playwright install chromium
pnpm smoke:desktop-terminal
# Optional WebKit coverage (install its system dependencies on Linux):
pnpm --filter @t3tools/scripts exec playwright install webkit
pnpm smoke:desktop-terminal --webkit
```

This headless check complements native desktop UI verification; it does not
launch the Tauri application or establish macOS UI acceptance.

The Workbench cutover E2E starts an isolated daemon and Web client, pairs a
headless browser, and exercises the real Sidebar, routes, BSP panes, PTY, and
session lifecycle. It never sends a provider turn:

```bash
pnpm test:e2e:workbench

# Reuse the installed Chrome instead of Playwright's browser download.
PLAYWRIGHT_USE_SYSTEM_CHROME=1 pnpm test:e2e:workbench

# Keep the temporary ACODE_HOME and failure screenshot for inspection.
WORKBENCH_E2E_KEEP_TEMP=1 pnpm test:e2e:workbench
```

The explicit CLI stop is separate from closing the window:

```bash
pnpm --dir apps/server exec node src/bin.ts daemon stop --base-dir "$PWD/.acode" --confirm
```

The desktop reads the live daemon endpoint from
`<ACODE_HOME>/userdata/server-runtime.json` (or `dev/server-runtime.json`).
For a daemon that requires authentication, provide a short-lived bootstrap
credential or an already-issued bearer token to the desktop process:

```bash
ACODE_DESKTOP_BOOTSTRAP_TOKEN=<pairing-token> pnpm dev:desktop
# or
ACODE_DESKTOP_BEARER_TOKEN=<bearer-token> pnpm dev:desktop
```

`ACODE_DESKTOP_HTTP_URL` and `ACODE_DESKTOP_WS_URL` may explicitly override
runtime-marker discovery; the C02 shell accepts loopback endpoints only. The
desktop build embeds `apps/web/dist`, so it does not require a Web development
server at runtime:

```bash
pnpm build:desktop
ACODE_HOME="$PWD/.acode" ACODE_DESKTOP_BEARER_TOKEN=<bearer-token> \
  apps/desktop/src-tauri/target/release/bundle/macos/ACode.app/Contents/MacOS/acode-desktop
```

The generated release application identifier is `com.allenreder.acode`; the
development shell uses the separate `com.allenreder.acode.dev` identity. Native
desktop integration currently covers local daemon discovery and supervision;
workspaces, sessions, and the Monocode-derived workbench are follow-up tickets.

## Data and external dependencies

The daemon stores its state below `<base-dir>/userdata/` and writes the
runtime marker to `<base-dir>/userdata/server-runtime.json`. The smoke test
uses its own temporary base directory. Provider credentials remain on the
machine where the daemon runs; this checkout does not copy them.

The local provider CLIs and their authentication are external prerequisites.
`tailscale` is only needed for `pnpm dev:share`; Zig and a Ghostty source
checkout are only needed when rebuilding the vendored terminal WebAssembly.

## Codex worktree hooks

Codex can run the checked-in scripts when it creates and removes a worktree.
The setup script installs the locked dependency graph in the new checkout. The
cleanup script removes only checkout-local ACode state, generated files, and
build output; it does not remove shared package caches or user-home data.

For the default, macOS, or Linux command fields, use:

```bash
node "$CODEX_WORKTREE_PATH/scripts/codex-worktree-setup.mjs"
node "$CODEX_WORKTREE_PATH/scripts/codex-worktree-cleanup.mjs"
```

For the Windows command fields, use:

```bat
node "%CODEX_WORKTREE_PATH%\scripts\codex-worktree-setup.mjs"
node "%CODEX_WORKTREE_PATH%\scripts\codex-worktree-cleanup.mjs"
```

Both scripts fall back to the current directory when run manually from a
checkout root.

## Source and license provenance

The imported runtime source is from
[`pingdotgg/t3code@ccf220be205f0e509021dbc8cbda90daa638e20d`](https://github.com/pingdotgg/t3code/commit/ccf220be205f0e509021dbc8cbda90daa638e20d).
See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) and
[`third-party-licenses.config.json`](./third-party-licenses.config.json) for
the consolidated license and notice inventory.

Workspace, Session, ACode layout, SSH/Tauri shell integration, and packaging
are intentionally outside this baseline.
