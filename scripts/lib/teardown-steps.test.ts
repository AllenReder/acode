// @effect-diagnostics nodeBuiltinImport:off - Tests exercise the filesystem teardown boundary.

import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { removePathWithRetry, runTeardownSteps } from "./teardown-steps.ts";

function failure(code: string): Error & { code: string } {
  return Object.assign(new Error(`${code}: resource busy or locked`), { code });
}

describe("removePathWithRetry", () => {
  it("retries the codes Windows raises while a handle is still open", async () => {
    const codes = ["EBUSY", "EPERM"];
    let attempts = 0;
    const removed: string[] = [];

    const result = await removePathWithRetry("C:\\scratch", {
      remove: async (path) => {
        attempts += 1;
        const code = codes.shift();
        if (code !== undefined) throw failure(code);
        removed.push(path);
      },
      sleep: async () => undefined,
    });

    expect(result).toEqual({ attempts: 3, reason: null, removed: true });
    expect(removed).toEqual(["C:\\scratch"]);
  });

  it("reports the retained path and reason instead of throwing", async () => {
    const result = await removePathWithRetry("C:\\scratch", {
      delaysMs: [1, 1],
      remove: async () => {
        throw failure("EBUSY");
      },
      sleep: async () => undefined,
    });

    expect(result.removed).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.reason).toContain("EBUSY");
  });

  it("stops immediately on a failure that retrying cannot fix", async () => {
    let attempts = 0;

    const result = await removePathWithRetry("C:\\scratch", {
      remove: async () => {
        attempts += 1;
        throw failure("EINVAL");
      },
      sleep: async () => undefined,
    });

    expect(result.removed).toBe(false);
    expect(attempts).toBe(1);
  });

  it("removes a real directory with the default primitive", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "awen-teardown-"));
    await NodeFSP.writeFile(NodePath.join(directory, "state.sqlite"), "x", "utf8");

    const result = await removePathWithRetry(directory);

    expect(result).toEqual({ attempts: 1, reason: null, removed: true });
    await expect(NodeFSP.stat(directory)).rejects.toThrow();
  });
});

describe("runTeardownSteps", () => {
  it("runs every step and collects failures instead of throwing", async () => {
    const ran: string[] = [];

    const failures = await runTeardownSteps([
      { label: "first", run: () => void ran.push("first") },
      {
        label: "second",
        run: () => {
          ran.push("second");
          throw new Error("close failed");
        },
      },
      { label: "third", run: () => void ran.push("third") },
    ]);

    expect(ran).toEqual(["first", "second", "third"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.label).toBe("second");
    expect(failures[0]?.error).toBeInstanceOf(Error);
  });

  it("awaits asynchronous steps in order", async () => {
    const ran: string[] = [];

    const failures = await runTeardownSteps([
      { label: "first", run: async () => void ran.push("first") },
      { label: "second", run: async () => void ran.push("second") },
    ]);

    expect(failures).toEqual([]);
    expect(ran).toEqual(["first", "second"]);
  });
});
