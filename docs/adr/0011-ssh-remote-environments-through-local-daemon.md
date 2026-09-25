# Host SSH remote environments through the local daemon

Awen hosts SSH discovery, host-key trust, authentication, deployment, tunnel management, and remote daemon lifecycle in its local Node daemon, while the Tauri shell remains a thin bridge to that daemon. SSH Connections may automatically install the exact desktop-matching Awen daemon version into `~/.awen/runtime/versions/<version>/`, preferring a checksummed GitHub Release download on the remote host and falling back to a checksummed archive uploaded from the local machine; Awen does not install Node.js or Git on the remote host. Direct/Bearer Connections remain peer entry points for already-running daemons and never trigger deployment. Reusing the T3 Code SSH implementation keeps a single Node/Effect transport path and avoids duplicating SSH, SFTP, password prompting, and known-hosts behavior in Rust or the web renderer.

## Status

Accepted.

## Consequences

The remote daemon is versioned separately from its data root, so updates can install to a new runtime directory without rewriting `AWEN_HOME` state. Existing healthy and protocol-compatible remote daemons are reused; active Sessions are never silently restarted during an update attempt.

First contact with a host is gated twice: the desktop UI inspects host-key trust against known_hosts and keyscan (a known matching key proceeds, a new key is confirmed explicitly by the user, a changed key always blocks and is never auto-accepted), and then shows the install plan — host, exact version, install path, package source, and the Linux x64 / Node.js / Git prerequisites — before the first remote write. The connection platform re-checks trust at provisioning time as a fail-safe, and SSH commands pin `StrictHostKeyChecking=yes` so a permissive user `ssh_config` cannot weaken the block on a changed key.

The first-contact prompt displays the scanned key's SHA256 fingerprint and accepts only that same key if a later scan still matches. A read-only SSH preflight reports the actual OS, architecture, Node.js version, Git availability, and whether a recorded daemon responds. The setup confirmation names reuse or installation and covers installation if a responding daemon becomes unavailable before connection completes.

Disconnecting an SSH Connection only tears down the local forwarding; the remote daemon stays alive in the background (detached at launch, rediscovered through its state directory on the next connect) so its Sessions survive. A healthy managed daemon is reused as-is even when the runner script changed — Awen never silently restarts a daemon that may own active Sessions, and only restarts one that is no longer responding. Reuse only adopts a process that answers the public environment descriptor endpoint, so an unrelated server on a recorded port is never treated as a live daemon.

The upload fallback sources the package from the local GitHub-download cache, or — when the prerelease is gone — from a locally built package directory named by `AWEN_SERVER_PACKAGE_DIR` (the output of `scripts/build-server-package.ts`), always through the same SHA256SUMS verification. The fallback never runs when the remote launch failed on SSH authentication, so credential problems surface immediately.

Connection setup failures cross the daemon/renderer boundary as stable codes (`unreachable`, `ssh-authentication`, `host-key-change`, `prerequisite-missing`, `install-download-checksum`, `daemon-start`, `daemon-authentication`, or `protocol-mismatch`) so presentation and retry policy do not parse backend messages. Only package acquisition or verification failures may trigger the local upload fallback.

SSH onboarding reports its current stage through a short-lived, local-daemon operation ID. Downloads report transferred bytes and a percentage only when the response exposes a trustworthy total; SCP samples the remote staging file's byte count and falls back to an indeterminate bar if sampling is unavailable. SSH checks and service startup never show estimated percentages. The dialog stays open during setup and offers explicit best-effort cancellation: local work stops, but remote operations already completed are not rolled back. A later attempt may reuse the remote daemon or retry installation.
