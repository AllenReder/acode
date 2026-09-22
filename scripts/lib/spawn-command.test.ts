// @effect-diagnostics nodeBuiltinImport:off - Tests exercise the Node child-process launch boundary.

import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  nodeEntryInvocation,
  packageManagerInvocation,
  resolvePackageEntry,
  withNodeModulesBin,
} from "./spawn-command.ts";

const tempDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3code-spawn-"));
  tempDirectories.push(directory);
  return directory;
}

async function writeFile(path: string, contents: string): Promise<void> {
  await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
  await NodeFSP.writeFile(path, contents, "utf8");
}

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => NodeFSP.rm(directory, { force: true, recursive: true })),
  );
});

describe("nodeEntryInvocation", () => {
  it("runs an entry point with the current Node executable and no shell", () => {
    expect(nodeEntryInvocation("/repo/scripts/dev-runner.ts", ["dev:web"])).toEqual({
      command: process.execPath,
      args: ["/repo/scripts/dev-runner.ts", "dev:web"],
      shell: false,
    });
  });

  it("defaults to an empty argument vector", () => {
    expect(nodeEntryInvocation("/repo/scripts/entry.mjs")).toEqual({
      command: process.execPath,
      args: ["/repo/scripts/entry.mjs"],
      shell: false,
    });
  });
});

describe("resolvePackageEntry", () => {
  it("resolves an entry point from the package that depends on it", async () => {
    const root = await createTemporaryDirectory();
    const packageDirectory = NodePath.join(root, "fixture-app");
    const entryPath = NodePath.join(root, "node_modules", "fixture-cli", "cli.js");
    await writeFile(entryPath, "export {};\n");
    await writeFile(
      NodePath.join(root, "node_modules", "fixture-cli", "package.json"),
      `${JSON.stringify({ name: "fixture-cli", version: "1.0.0", bin: { fixture: "./cli.js" } })}\n`,
    );
    await writeFile(
      NodePath.join(packageDirectory, "package.json"),
      `${JSON.stringify({ name: "fixture-app", version: "1.0.0" })}\n`,
    );

    expect(resolvePackageEntry("fixture-cli/cli.js", packageDirectory)).toBe(entryPath);
  });

  it("explains how to fix a missing entry point", async () => {
    const root = await createTemporaryDirectory();
    const packageDirectory = NodePath.join(root, "fixture-app");
    await writeFile(
      NodePath.join(packageDirectory, "package.json"),
      `${JSON.stringify({ name: "fixture-app", version: "1.0.0" })}\n`,
    );

    expect(() => resolvePackageEntry("missing-cli/cli.js", packageDirectory)).toThrow(
      /Could not resolve missing-cli\/cli\.js .*pnpm install/,
    );
  });
});

describe("packageManagerInvocation", () => {
  it("runs the manager's JavaScript entry without a shell when npm_execpath is set", async () => {
    const root = await createTemporaryDirectory();
    const entryPath = NodePath.join(root, "pnpm.mjs");
    await writeFile(entryPath, "export {};\n");

    expect(
      packageManagerInvocation(["install", "--frozen-lockfile"], {
        environment: { npm_execpath: entryPath },
      }),
    ).toEqual({
      command: process.execPath,
      args: [entryPath, "install", "--frozen-lockfile"],
      shell: false,
    });
  });

  it("falls back to a single shell command line when npm_execpath is unusable", () => {
    expect(
      packageManagerInvocation(["install", "--frozen-lockfile"], {
        environment: { npm_execpath: "/missing/manager.cmd" },
      }),
    ).toEqual({
      command: "pnpm install --frozen-lockfile",
      args: [],
      shell: true,
    });
    expect(packageManagerInvocation(["exec", "node"], { environment: {} })).toEqual({
      command: "pnpm exec node",
      args: [],
      shell: true,
    });
  });

  it("refuses an argument a shell would reinterpret", () => {
    expect(() =>
      packageManagerInvocation(["exec", "node", "C:\\Users\\Jane Doe\\a.mjs"], {
        environment: {},
      }),
    ).toThrow(/Refusing to pass "C:\\\\Users\\\\Jane Doe\\\\a\.mjs"/);
  });
});

describe("withNodeModulesBin", () => {
  const repoBin = NodePath.join("/repo", "node_modules", ".bin");
  const desktopBin = NodePath.join("/repo", "apps", "desktop", "node_modules", ".bin");

  it("prepends the workspace bin directories to PATH", () => {
    const environment = withNodeModulesBin({ PATH: "/usr/bin" }, ["/repo", "/repo/apps/desktop"]);

    expect(environment.PATH?.split(NodePath.delimiter)).toEqual([repoBin, desktopBin, "/usr/bin"]);
  });

  it("preserves the key a Windows environment block uses", () => {
    const environment = withNodeModulesBin({ Path: "C:\\Windows" }, ["C:\\repo"]);

    expect(environment).toEqual({
      Path: [NodePath.join("C:\\repo", "node_modules", ".bin"), "C:\\Windows"].join(
        NodePath.delimiter,
      ),
    });
  });

  it("adds PATH when the environment has none", () => {
    expect(withNodeModulesBin({}, ["/repo"])).toEqual({ PATH: repoBin });
  });

  it("does not repeat a bin directory that is already inherited", () => {
    const environment = withNodeModulesBin(
      { PATH: ["/usr/bin", repoBin].join(NodePath.delimiter) },
      ["/repo"],
    );

    expect(environment.PATH?.split(NodePath.delimiter)).toEqual([repoBin, "/usr/bin"]);
  });
});
