import { describe, expect, it } from "@effect/vitest";
import { deriveSubprocessInspectResult, normalizeChildCommandName } from "./Manager.ts";

describe("normalizeChildCommandName", () => {
  it("normalizes direct binary names", () => {
    expect(normalizeChildCommandName("opencode", "win32")).toBe("opencode");
    expect(normalizeChildCommandName("opencode.exe", "win32")).toBe("opencode");
    expect(normalizeChildCommandName("claude.exe", "win32")).toBe("claude");
    expect(normalizeChildCommandName("C:\\tools\\claude.exe", "win32")).toBe("claude");
    expect(normalizeChildCommandName("/usr/local/bin/claude", "linux")).toBe("claude");
    expect(normalizeChildCommandName("codex", "linux")).toBe("codex");
  });

  it("extracts script name when launched through node, bun, npx, or python", () => {
    expect(
      normalizeChildCommandName(
        '"D:\\Program Files\\nodejs\\node.exe" "C:\\Users\\Administrator\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js"',
        "win32",
      ),
    ).toBe("codex");

    expect(
      normalizeChildCommandName(
        "node /usr/local/lib/node_modules/opencode/bin/opencode.js",
        "linux",
      ),
    ).toBe("opencode");

    expect(normalizeChildCommandName("npx @anthropic-ai/claude-code", "linux")).toBe("claude-code");

    expect(normalizeChildCommandName("bun /app/codex.ts", "darwin")).toBe("codex");

    expect(normalizeChildCommandName("python main.py", "linux")).toBe("main");
  });

  it("handles flags before script", () => {
    expect(normalizeChildCommandName("node --no-warnings /app/opencode.js", "linux")).toBe(
      "opencode",
    );
  });

  it("returns null for empty strings", () => {
    expect(normalizeChildCommandName("", "win32")).toBeNull();
    expect(normalizeChildCommandName("   ", "linux")).toBeNull();
  });
});

describe("deriveSubprocessInspectResult", () => {
  it("treats terminal with only conhost.exe as idle", () => {
    const snapshot = {
      childrenByParent: new Map([[1000, [1001]]]),
      commandById: new Map([
        [1000, "powershell.exe"],
        [1001, "conhost.exe"],
      ]),
    };
    const result = deriveSubprocessInspectResult(snapshot, 1000, "win32");
    expect(result.hasRunningSubprocess).toBe(false);
    expect(result.childCommand).toBeNull();
  });

  it("finds agent command across descendant tree even when wrapped by conhost and cmd", () => {
    const snapshot = {
      childrenByParent: new Map([
        [1000, [1001, 1002]],
        [1002, [1003]],
      ]),
      commandById: new Map([
        [1000, "powershell.exe"],
        [1001, "conhost.exe"],
        [1002, "cmd.exe /c codex.cmd"],
        [
          1003,
          '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\Administrator\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js"',
        ],
      ]),
    };
    const result = deriveSubprocessInspectResult(snapshot, 1000, "win32");
    expect(result.hasRunningSubprocess).toBe(true);
    expect(result.childCommand).toBe("codex");
  });

  it("finds claude-code or opencode directly", () => {
    const snapshot = {
      childrenByParent: new Map([[1000, [1001, 1002]]]),
      commandById: new Map([
        [1000, "pwsh.exe"],
        [1001, "conhost.exe"],
        [1002, "claude.exe"],
      ]),
    };
    const result = deriveSubprocessInspectResult(snapshot, 1000, "win32");
    expect(result.hasRunningSubprocess).toBe(true);
    expect(result.childCommand).toBe("claude");
  });
  it("prefers direct child non-wrapper command over its child process", () => {
    const snapshot = {
      childrenByParent: new Map([
        [1000, [1001]],
        [1001, [1002]],
      ]),
      commandById: new Map([
        [1000, "bash"],
        [1001, "vim"],
        [1002, "git status"],
      ]),
    };
    const result = deriveSubprocessInspectResult(snapshot, 1000, "linux");
    expect(result.hasRunningSubprocess).toBe(true);
    expect(result.childCommand).toBe("vim");
  });

  it("unwraps transparent shell wrapper to find inner child command", () => {
    const snapshot = {
      childrenByParent: new Map([
        [1000, [1001]],
        [1001, [1002]],
      ]),
      commandById: new Map([
        [1000, "powershell.exe"],
        [1001, "cmd.exe /c run.bat"],
        [1002, "vim.exe"],
      ]),
    };
    const result = deriveSubprocessInspectResult(snapshot, 1000, "win32");
    expect(result.hasRunningSubprocess).toBe(true);
    expect(result.childCommand).toBe("vim");
  });
});
