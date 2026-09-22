# Host SSH remote environments through the local daemon

ACode hosts SSH discovery, host-key trust, authentication, deployment, tunnel management, and remote daemon lifecycle in its local Node daemon, while the Tauri shell remains a thin bridge to that daemon. SSH Connections may automatically install the exact desktop-matching ACode daemon version into `~/.acode/runtime/versions/<version>/`, preferring a checksummed GitHub Release download on the remote host and falling back to a checksummed archive uploaded from the local machine; ACode does not install Node.js or Git on the remote host. Direct/Bearer Connections remain peer entry points for already-running daemons and never trigger deployment. Reusing the T3code SSH implementation keeps a single Node/Effect transport path and avoids duplicating SSH, SFTP, password prompting, and known-hosts behavior in Rust or the web renderer.

## Status

Accepted.

## Consequences

The remote daemon is versioned separately from its data root, so updates can install to a new runtime directory without rewriting `ACODE_HOME` state. Existing healthy and protocol-compatible remote daemons are reused; active Sessions are never silently restarted during an update attempt.

First contact with a host is gated twice: the desktop UI inspects host-key trust against known_hosts and keyscan (a known matching key proceeds, a new key is confirmed explicitly by the user, a changed key always blocks and is never auto-accepted), and then shows the install plan — host, exact version, install path, package source, and the Linux x64 / Node.js / Git prerequisites — before the first remote write. The connection platform re-checks trust at provisioning time as a fail-safe, and SSH commands pin `StrictHostKeyChecking=yes` so a permissive user `ssh_config` cannot weaken the block on a changed key.

Disconnecting an SSH Connection only tears down the local forwarding; the remote daemon stays alive in the background (detached at launch, rediscovered through its state directory on the next connect) so its Sessions survive. A healthy managed daemon is reused as-is even when the runner script changed — ACode never silently restarts a daemon that may own active Sessions, and only restarts one that is no longer responding.
