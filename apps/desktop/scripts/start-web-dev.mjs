import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import {
  nodeEntryInvocation,
  spawnInherited,
  withNodeModulesBin,
} from "../../../scripts/lib/spawn-command.ts";

const desktopRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = NodePath.resolve(desktopRoot, "../..");
const devRunnerEntry = NodePath.join(repositoryRoot, "scripts/dev-runner.ts");

// Tauri runs this as the `beforeDevCommand` of the dev configuration, and the
// web dev server is the root `dev:web` script. Run the runner that script
// points at with this Node executable - `pnpm dev:web` cannot work on Windows,
// where Node refuses to spawn the `.cmd` shim without a shell - and add the
// workspace `.bin` directories that a package-manager script run would add,
// because `scripts/dev-runner.ts` resolves `vp` from `PATH`.
spawnInherited(nodeEntryInvocation(devRunnerEntry, ["dev:web"]), {
  cwd: repositoryRoot,
  env: withNodeModulesBin(process.env, [desktopRoot, repositoryRoot]),
  failureLabel: "Unable to start the Awen web development server",
});
