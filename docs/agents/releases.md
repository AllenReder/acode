# Versions and releases

Awen uses one SemVer version for the web app, Windows/macOS desktop installers,
and Linux x64 daemon. The root `package.json` is authoritative; the version
script synchronizes package manifests and the desktop Cargo/Tauri versions.
Changing the version also increments the numeric macOS bundle build number.
Ordinary commits and merges never publish artifacts.

## Choose the next version

During the pre-1.0 alpha, use `0.1.0-alpha.N` for planned feature releases.
Increment `N` for another build in the same prerelease series. Use a new
`0.1.x-alpha.1` series for a separately versioned patch line only after
`0.1.0` has shipped; while `0.1.0` is still in alpha, bug-fix builds are
`0.1.0-alpha.2`, `alpha.3`, and so on. After `0.1.0`, a backward-compatible
bug fix increments the patch (`0.1.1`), a compatible feature release
increments the minor (`0.2.0`), and a breaking release increments the major.

Set and verify the product version from the repository root:

```bash
pnpm version:set 0.1.0-alpha.1
pnpm version:check
```

Review and commit those manifest changes with the release candidate. The CI
workflow checks version consistency, typechecks, lints, tests, and builds the
web/server workspace, compiles the desktop shell, and builds a Windows NSIS
installer on pull requests and pushes to `main`.

## Publish

After the version commit is on `main` and CI passes, push the matching tag:

```bash
git tag v0.1.0-alpha.1
git push origin v0.1.0-alpha.1
```

The tag starts the release workflow. It verifies that the tag exactly matches
all product versions, bundles the daemon and Node runtime with the desktop
installers on Windows and both macOS architectures, builds and smoke-tests the Linux x64 daemon package,
and publishes all assets with GitHub-generated release notes. A SemVer version
containing a prerelease suffix becomes a GitHub prerelease; a version without a
suffix becomes a stable release. The workflow never moves a shared channel or
publishes an npm package.

Prereleases use the Windows NSIS `.exe` installer. WiX `.msi` requires a
numeric-only prerelease identifier, so it cannot bundle versions such as
`0.1.0-alpha.2`. Stable releases build both installer formats.

Assets use `Awen-<version>-windows-x64.*`,
`Awen-<version>-macos-{arm64,x64}.dmg`, and
`awen-server-<version>-linux-x64.tar.gz`. The daemon archive includes its own
`SHA256SUMS`; the release also includes checksums covering every installer and
archive.

Windows installers are unsigned. With no Apple credentials, macOS DMGs are
ad-hoc signed; users must explicitly allow the app in macOS Privacy & Security.
This does not guarantee that an app reporting “damaged” is safe or intact:
verify the release checksum and code signature first. To publish a Developer ID
signed and notarized DMG, set `APPLE_CERTIFICATE` (base64 `.p12`),
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific),
`APPLE_TEAM_ID`, and `KEYCHAIN_PASSWORD` as repository secrets.
