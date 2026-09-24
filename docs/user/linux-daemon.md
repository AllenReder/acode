# Running Awen Daemon on Headless Linux

This guide describes how to install, run, and manage the Awen daemon on a headless Linux x64 server without a graphical desktop environment.

## Requirements

The Linux server requires:

- Linux x64 (glibc 2.28+ or equivalent)
- Node.js >= 22.16 (Node.js 24 LTS recommended)
- Git (for repository and worktree management)

Verify the environment before running:

```bash
node --version # Must be >= v22.16.0
git --version
```

## Packaging and Installation

### 1. Build the Distribution Package

On a build machine or in CI, produce the headless server archive:

```bash
pnpm run build:server-package
```

This outputs `release-server/awen-server-<version>-linux-x64.tar.gz` and
`release-server/SHA256SUMS`:

```bash
sha256sum --check SHA256SUMS
```

Releases are created by pushing the matching `v<version>` git tag. The release
workflow builds and publishes the Linux x64 daemon alongside the Windows and
macOS desktop installers. See [versions and releases](../agents/releases.md)
for the version and tagging steps.

### 2. Transfer and Extract

Transfer the archive to your target Linux server and extract it:

```bash
mkdir -p ~/awen-server
tar -xzf awen-server-*.tar.gz -C ~/awen-server --strip-components=1
cd ~/awen-server
```

The extracted directory contains:

- `bin/awen`: Launcher executable verifying Node version and invoking the server.
- `bin/awen`: Compatibility alias.
- `dist/bin.mjs`: Bundled Awen server application.
- `node_modules/`: Runtime dependencies and native binary addons.

Verify the extracted binary:

```bash
./bin/awen --version
```

## Running the Daemon

### Background Daemon (Recommended)

To start the daemon in the background detached from the current terminal:

```bash
./bin/awen daemon start
```

Output:

```text
Local daemon ready (pid 12345, http://127.0.0.1:3773/).
```

The daemon runs as an independent session leader (`detached: true`, `unref()`). When you exit or disconnect your SSH session, the daemon continues running unaffected.

### Querying Status

Inspect the running daemon:

```bash
./bin/awen daemon status
```

Output:

```text
Local daemon: running (pid 12345, http://127.0.0.1:3773/)
```

With `--json`, it emits machine-readable status without exposing secrets:

```bash
./bin/awen daemon status --json
```

### Stopping the Daemon

Explicitly stop the daemon:

```bash
./bin/awen daemon stop --confirm
```

If active work (such as live agent execution or active terminal session) is running, omitting `--confirm` warns you and prompts for confirmation.

### Foreground Debugging

For interactive troubleshooting and inspecting logs in real-time:

```bash
./bin/awen serve --port 3773 --host 127.0.0.1
```

In foreground mode, the server prints the connection URL, QR code, and one-time bootstrap token directly to the console.

## Authentication and Remote Connection

By default, the daemon binds exclusively to loopback (`127.0.0.1`) for security. External traffic must connect through an SSH tunnel (configured in Awen Desktop via SSH Connection).

### Generating Client Pairing Tokens

To connect from Awen desktop over an SSH tunnel, generate a single-use pairing token:

```bash
./bin/awen auth pairing create --json
```

Output:

```json
{
  "id": "123b80ea-f835-40a0-ad41-6f580ade760b",
  "credential": "EXAMPLE_TOKEN",
  "scopes": ["orchestration:read", "orchestration:operate", "terminal:operate", "review:write"],
  "expiresAt": "2026-09-21T13:00:00.000Z"
}
```

The desktop client exchanges this credential for an authenticated bearer session.

### Reading Local Bootstrap Credential

To inspect the persistent local credential from within an authorized SSH session:

```bash
./bin/awen daemon token
```

The bootstrap token is stored under `~/.awen/userdata/secrets/desktop-bootstrap.token` with restrictive `0600` file permissions.

## Data Directory and Logs

The daemon uses the following paths by default (configurable via `AWEN_HOME`, defaulting to `~/.awen`):

- **Data Root**: `~/.awen/userdata`
- **Discovery Record**: `~/.awen/userdata/server-runtime.json`
- **Secrets**: `~/.awen/userdata/secrets/` (0700 permissions)
- **Launch Lock**: `~/.awen/userdata/daemon-launch.lock`
- **Daemon Log**: `~/.awen/userdata/logs/daemon.log`
- **Server Trace**: `~/.awen/userdata/logs/server.trace.ndjson`

To inspect recent server logs:

```bash
tail -n 100 ~/.awen/userdata/logs/daemon.log
```

## Optional System Service (systemd)

For production servers where Awen daemon should start automatically at system boot and restart on system reboot, configure a systemd user unit:

1. Create `~/.config/systemd/user/awen.service`:

```ini
[Unit]
Description=Awen Daemon
After=network.target

[Service]
Type=simple
WorkingDirectory=%h
Environment=AWEN_HOME=%h/.awen
ExecStart=%h/awen-server/bin/awen serve --no-browser --host 127.0.0.1 --port 3773
Restart=always
RestartSec=5
KillMode=mixed
OOMPolicy=continue
StandardOutput=append:%h/.awen/userdata/logs/daemon.log
StandardError=append:%h/.awen/userdata/logs/daemon.log

[Install]
WantedBy=default.target
```

2. Enable lingering so user services run even when no SSH session is active:

```bash
loginctl enable-linger "$(id -un)"
```

3. Enable and start the service:

```bash
systemctl --user daemon-reload
systemctl --user enable --now awen.service
systemctl --user status awen.service
```

## Diagnostics and Troubleshooting

- **Node version too low**: The launcher aborts with `Error: Node.js version 22+ is required (found v...)`. Upgrade Node.js via your distribution package manager, `fnm`, or `nvm`.
- **Port Conflict**: `AWEN_DAEMON_PORT` and `AWEN_DAEMON_PORT` are requirements, not preferences. If the port they name is occupied, `daemon start` fails and names the port instead of binding a different one, because the runtime descriptor and every client address the daemon by the configured port. `AWEN_PORT` (and `AWEN_PORT`) stay preferences and still fall back to a free port when busy. Free the port or choose another number with `AWEN_DAEMON_PORT=<port>`. The failure carries the code `daemon-port-unavailable` with `--json`; without it, the same message is printed as plain text.
- **Stale Discovery**: If the server machine crashed unexpectedly, `awen daemon status` detects whether the recorded PID is dead and reports `stale`. Running `awen daemon start` safely clears stale locks and launches a fresh daemon.
