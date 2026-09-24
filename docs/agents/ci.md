# Continuous integration

Two workflows run the pipeline:

- `.github/workflows/ci.yml` — pull requests and pushes to `main`.
- `.github/workflows/release.yml` — `v*` tags, plus a manual dry run.

Both call `.github/workflows/build-installers.yml`, so the installers a release
publishes are the installers a pull request already built. Keep it that way: the
only workflow that may stage the desktop runtime, build a DMG, or build an NSIS
installer is `build-installers.yml`.

## What CI proves

- `quality` — version consistency, typecheck, lint, and the web/server build.
- `tests` — `apps/server` and `apps/web` sharded two ways, plus every other
  workspace package through `pnpm test:packages`.
- `desktop-shell` — the Tauri crate compiles on Linux and `cargo fmt --check`
  passes.
- `installers` — the Linux daemon package (built and smoke-tested), the Windows
  installer, and both macOS DMGs, each uploaded as an artifact for three days.
- `gate` — the single `CI gate` status check that branch protection should
  require.

`scripts/ci-workflows.test.ts` enforces the structural rules above: no Apple
variable at job level, Apple secrets read only by the signing step, credentials
exported only after the ad-hoc path exits, a timeout on every job that runs
steps, every action pinned to a commit SHA with its version in a comment, and no
second copy of the installer builds.

## macOS signing

The signing step checks six secrets as one group. With none of them set — which
is what every pull request and fork build sees — the DMGs are ad-hoc signed.
With all of them set, the workflow imports the Developer ID certificate, signs,
notarizes, and staples. Never move those variables to a job-level `env:` block:
Tauri treats an empty `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID` as "notarize
this", which is how the `0.1.0-alpha.3` release failed.

## Local equivalents

```bash
pnpm test              # every workspace package, the way a developer runs it
pnpm test:server       # the sharded groups CI runs, without the shard flag
pnpm test:web
pnpm test:packages
node scripts/stage-desktop-runtime.ts --target x86_64-apple-darwin
```

`stage-desktop-runtime.ts --target` downloads the official Node build for the
Rust target triple, checks it against the published `SHASUMS256.txt`, and stages
it as the desktop runtime, which is what lets an Apple Silicon runner build the
x86_64 DMG. Without `--target` the script copies the local Node binary.
