# Product versions and server prereleases

ACode currently uses one product version for the Web client, desktop app, contracts, and daemon. The root `package.json` is the version source; package manifests and the desktop Cargo manifest/lockfile are synchronized copies. Tauri reads the root package version directly. A code commit or merge does not change the version or publish a release.

For a new build, choose a version that has not been used for a different daemon build. From the repository root, run `pnpm version:set <version>`, review the resulting manifest changes, and commit them with the feature or release-preparation PR. `pnpm version:check` verifies that every copy agrees; the pull-request workflow enforces it. Do not reuse a version after changing daemon code: an SSH connection reuses a healthy remote daemon with the same version.

Before publishing, commit the relevant `CHANGELOG.md` entries under the version being released. After that commit is merged and its checks pass, manually run **Release server package** with its exact SHA. The workflow derives the version from the checked-out root manifest, verifies the copies, builds and smoke-tests the Linux x64 package, and publishes `v<version>` as a GitHub prerelease. It does not publish a desktop installer or an npm package. The optional tag input must equal `v<version>`.

The release asset is `acode-server-<version>-linux-x64.tar.gz` with `SHA256SUMS`. SSH onboarding prefers downloading this exact asset on the remote host; if unavailable, it can upload a matching local cache or `ACODE_SERVER_PACKAGE_DIR` build. A previously installed, healthy remote daemon is reused rather than silently replaced. Record user-facing changes in release notes before publishing a stable release.
