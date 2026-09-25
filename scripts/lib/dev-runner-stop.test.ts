// @effect-diagnostics nodeBuiltinImport:off - Tests exercise the filesystem control protocol.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  DEV_RUNNER_STOP_VERSION,
  devRunnerStopRequestPath,
  requestDevRunnerStop,
} from "./dev-runner-stop.ts";

describe("dev-runner stop requests", () => {
  it("names a pid-scoped marker under the runtime directory", () => {
    expect(devRunnerStopRequestPath("/tmp/awen", 42)).toBe(
      NodePath.join("/tmp/awen", "runtime", "dev-runner", "42.stop"),
    );
  });

  it("publishes a complete request at the advertised path", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "awen-dev-runner-stop-"));
    try {
      const requestPath = await requestDevRunnerStop(root, 42);

      expect(requestPath).toBe(devRunnerStopRequestPath(root, 42));
      expect(JSON.parse(await NodeFSP.readFile(requestPath, "utf8"))).toEqual({
        pid: 42,
        version: DEV_RUNNER_STOP_VERSION,
      });
    } finally {
      await NodeFSP.rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a pid that cannot name a running process", async () => {
    await expect(requestDevRunnerStop("/tmp/awen", 0)).rejects.toThrow("Invalid dev-runner pid");
  });
});
