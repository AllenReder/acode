import { describe, expect, it } from "@effect/vitest";
import { normalizeChildCommandName } from "./Manager.ts";

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

    expect(
      normalizeChildCommandName("npx @anthropic-ai/claude-code", "linux"),
    ).toBe("claude-code");

    expect(
      normalizeChildCommandName("bun /app/codex.ts", "darwin"),
    ).toBe("codex");

    expect(
      normalizeChildCommandName("python main.py", "linux"),
    ).toBe("main");
  });

  it("handles flags before script", () => {
    expect(
      normalizeChildCommandName("node --no-warnings /app/opencode.js", "linux"),
    ).toBe("opencode");
  });

  it("returns null for empty strings", () => {
    expect(normalizeChildCommandName("", "win32")).toBeNull();
    expect(normalizeChildCommandName("   ", "linux")).toBeNull();
  });
});
