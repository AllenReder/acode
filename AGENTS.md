## Reference projects

See the open-source projects in `_refs/` for reference. They are read-only,
gitignored, and not part of the build.

The current `main` branch is the clean-slate ACode v1 implementation line.
Prefer adopting and adapting mature implementations from reference projects
over reimplementing equivalent infrastructure from scratch. Do not restore
pre-v1 implementation patterns unless a ticket or current architecture
decision explicitly requires them.

## Commits

Conventional Commits, `type(scope): subject`:

```text
feat(shell): add the pane layout tree
fix(ui): keep window controls on macOS
docs: record the token split
```

- Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`,
  `chore`, `revert`.
- Scope names the area touched and is optional. Prefer scopes that correspond
  to the current v1 codebase, such as `shell`, `ui`, `domain`, `runtime`,
  `server`, `contracts`, `ci`, or `docs`. Do not assume legacy directory or
  crate names still exist.
- The body states what changed and why. A fixed defect gets its own bullet
  naming the mechanism, so a later reader cannot reintroduce it.
- Before every commit, check and maintain the Codex worktree setup and cleanup scripts as the repository changes.
- A breaking change takes `!` before the colon, plus a `BREAKING CHANGE:`
  footer naming what callers must do.

## Computer Use

Use Computer Use when correctness depends on the real desktop UI: inspect or
operate the running app, reproduce a GUI-only bug, or verify menus, window
controls, focus, and visual behavior. Use shell and structured tools for code,
files, tests, logs, and terminal commands.

Use the desktop development command, runner, application path, and bundle
identity defined by the current v1 implementation. Do not assume legacy
commands such as `scripts/dev-app.sh`, legacy Tauri configuration, or a
particular bundle id exist unless they are present in the current tree.

When a registered `.app` runner is available on macOS, its path must be
absolute. In the prompt, mention `@Computer` or the exact `acode` app and name
the window, flow, and expected visible result. After every UI action, read a
fresh accessibility tree before choosing the next element.

Frontend-only changes should use the current development server's hot reload
when available. Native shell or runtime changes should rebuild the relevant
native process. On macOS, grant Computer Use Screen Recording and
Accessibility permissions when prompted.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `AllenReder/acode`, driven by the
`gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles map to identically-named labels:
`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.
See `docs/agents/triage-labels.md`.

### Domain docs

single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See
`docs/agents/domain.md`.
