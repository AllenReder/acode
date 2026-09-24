// @effect-diagnostics nodeBuiltinImport:off - Tests exercise root env file precedence directly.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { loadRepoEnv } from "./public-config.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadRepoEnv", () => {
  it("merges root env, local env, and process env in precedence order", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(NodePath.join(repoRoot, ".env"), "A=from-root\nB=root-only\n");
    NodeFS.writeFileSync(NodePath.join(repoRoot, ".env.local"), "A=from-local\nC=local-only\n");

    expect(loadRepoEnv({ baseEnv: { A: "from-process", D: "process-only" }, repoRoot })).toEqual({
      A: "from-process",
      B: "root-only",
      C: "local-only",
      D: "process-only",
    });
  });

  it("returns process environment variables when no env files exist", () => {
    const repoRoot = makeTemporaryDirectory();
    expect(loadRepoEnv({ baseEnv: { AWEN_HOME: "/tmp/awen" }, repoRoot })).toEqual({
      AWEN_HOME: "/tmp/awen",
    });
  });
});

function makeTemporaryDirectory() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "awen-public-config-"));
  temporaryDirectories.push(directory);
  return directory;
}
