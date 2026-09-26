# OpenCode provider supports v2 only

**Status: accepted**

Awen's OpenCode Provider forks T3 Code's integration, which targeted the OpenCode
v1 server contract. OpenCode 2 changed the server startup banner, enabled
authentication by default, and replaced the v1 HTTP and event API surface. Rather
than carry a v1/v2 compatibility boundary that upstream has repeatedly declined to
merge, Awen targets the native OpenCode v2 server contract only and raises its
minimum supported OpenCode version to `2.0.12`. The v1 adapter, the CLI-parser
inventory fallback, and the v1 JavaScript SDK dependency are removed.

## Context

Issue #125 reports that the OpenCode Provider is "Unavailable" on Windows while the
same account works on macOS. The Windows machine runs OpenCode `2.0.18`, which
prints `server listening on …` (not the v1 `opencode server listening …`), serves its
API under `/api/*`, and requires a server password. Awen waited for the v1 banner,
called v1 root routes, and assumed no authentication, so every managed server start
ended in `Timed out waiting for OpenCode server start after 30000ms`.

Upstream T3 Code's only merged change for this is a two-line ready-line regex
(`pingdotgg/t3code#13651`); it does not move the API surface or handle v2
authentication. Complete implementations exist only as unmerged upstream pull
requests and a merged pull request in a downstream fork (`gidorah/t3code#3`,
adapting `pingdotgg/t3code#13008`; stacked and hardened in `pingdotgg/t3code#13452`).
No upstream implementation preserves v2 while keeping v1 behind a compatibility
boundary.

## Considered Options

- **Support v1 and v2 with a compatibility boundary.** Rejected: no upstream
  implementation exists, and Awen would own two protocol surfaces indefinitely.
- **Keep v1, gate v2 as unsupported with guidance.** Rejected: leaves OpenCode users
  on current CLIs unable to use the provider on any platform.
- **Target native v2 only (chosen).** Matches the only proven implementation, keeps a
  single integration surface, and accepts a hard minimum version.

## Decision

- The OpenCode Provider speaks the native OpenCode v2 server contract for both
  daemon-managed local servers and configured external server URLs.
- The minimum supported OpenCode version becomes `2.0.12`; OpenCode 1.x is
  unsupported and is rejected with an explicit "upgrade" provider status.
- A daemon-managed local server is started with a generated server password, and the
  client authenticates with it. A user-configured server password still takes
  precedence.
- Awen no longer depends on the OpenCode v1 JavaScript SDK; it depends on the
  official OpenCode v2 client package.

## Consequences

- Machines running OpenCode 1.x (including `1.18.x`) must upgrade before the provider
  works. This is the intended cost of the support-matrix reversal.
- The v1 CLI-parser inventory fallback and its tests are deleted, shrinking the
  server's production code.
- Future OpenCode API drift is handled by moving to newer v2 minor versions, not by
  re-adding a v1 path. A data-driven provider compatibility advisory was considered
  and deliberately deferred.
