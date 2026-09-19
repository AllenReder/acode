import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const desktopRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = NodePath.resolve(desktopRoot, "../..");
const developmentHome =
  process.env.ACODE_HOME?.trim() || NodePath.resolve(repositoryRoot, ".acode");
const devConfig = NodePath.resolve(desktopRoot, "src-tauri/tauri.dev.conf.json");

const environment = {
  ...process.env,
  ACODE_HOME: developmentHome,
  T3CODE_HOME: process.env.T3CODE_HOME?.trim() || developmentHome,
  T3CODE_PORT_OFFSET: process.env.T3CODE_PORT_OFFSET?.trim() || "0",
};

const build = NodeChildProcess.spawnSync(
  "pnpm",
  ["exec", "tauri", "build", "--debug", "--config", devConfig],
  {
    cwd: desktopRoot,
    env: environment,
    stdio: "inherit",
  },
);

if (build.error) {
  console.error(`Unable to build the ACode Dev app: ${build.error.message}`);
  process.exitCode = 1;
} else if (build.status !== 0) {
  process.exitCode = build.status ?? 1;
} else {
  const bundleRoot = NodePath.resolve(desktopRoot, "src-tauri/target/debug/bundle/macos");
  const preferredAppPath = NodePath.join(bundleRoot, "ACode Dev.app");
  if (!NodeFS.existsSync(preferredAppPath)) {
    console.error(`The ACode Dev app bundle was not found under ${bundleRoot}.`);
    process.exitCode = 1;
  } else {
    const appPath = preferredAppPath;
    const executable = NodePath.join(appPath, "Contents/MacOS/acode-desktop");
    if (!NodeFS.existsSync(executable)) {
      console.error(`The ACode Dev executable was not found at ${executable}.`);
      process.exitCode = 1;
    } else {
      const child = NodeChildProcess.spawn(executable, [], {
        cwd: repositoryRoot,
        env: environment,
        detached: true,
        stdio: "inherit",
      });
      child.unref();
      console.log(`Started ACode Dev: ${appPath}`);
    }
  }
}
