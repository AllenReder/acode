import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind } from "@awen/contracts";
import {
  detectAgentDriverFromCommand,
  resolveAgentIcon,
  resolveAgentSessionStatusAlert,
  resolveTerminalIcon,
  resolveTerminalSessionStatusAlert,
} from "./sidebarSessionPresentation";
import { ClaudeAI, CursorIcon, OpenAI, OpenCodeIcon } from "../Icons";
import { SparklesIcon, TerminalIcon } from "lucide-react";

describe("sidebarSessionPresentation", () => {
  describe("detectAgentDriverFromCommand", () => {
    it("detects known agent CLIs case-insensitively and ignores non-agents", () => {
      expect(detectAgentDriverFromCommand("opencode")).toBe("opencode");
      expect(detectAgentDriverFromCommand("opencode.exe")).toBe("opencode");
      expect(detectAgentDriverFromCommand("OpenCode")).toBe("opencode");
      expect(detectAgentDriverFromCommand("claude")).toBe("claudeAgent");
      expect(detectAgentDriverFromCommand("claude.exe")).toBe("claudeAgent");
      expect(detectAgentDriverFromCommand("claude-code")).toBe("claudeAgent");
      expect(detectAgentDriverFromCommand("codex")).toBe("codex");
      expect(detectAgentDriverFromCommand("codex.exe")).toBe("codex");
      expect(detectAgentDriverFromCommand("cursor")).toBe("cursor");
      expect(detectAgentDriverFromCommand("cursor.exe")).toBe("cursor");
      expect(detectAgentDriverFromCommand("bash")).toBeNull();
      expect(detectAgentDriverFromCommand("node")).toBeNull();
      expect(detectAgentDriverFromCommand(null)).toBeNull();
      expect(detectAgentDriverFromCommand(undefined)).toBeNull();
    });
  });

  describe("resolveAgentSessionStatusAlert", () => {
    it("prioritizes action-required over errors and running turns", () => {
      expect(
        resolveAgentSessionStatusAlert({
          hasPendingUserInput: true,
          hasPendingApprovals: false,
          latestTurn: { state: "error" } as never,
        }),
      ).toBe("action-required");

      expect(
        resolveAgentSessionStatusAlert({
          hasPendingUserInput: false,
          hasPendingApprovals: true,
          latestTurn: { state: "running" } as never,
        }),
      ).toBe("action-required");
    });

    it("resolves error and running states", () => {
      expect(
        resolveAgentSessionStatusAlert({
          hasPendingUserInput: false,
          hasPendingApprovals: false,
          latestTurn: { state: "error" } as never,
        }),
      ).toBe("error");

      expect(
        resolveAgentSessionStatusAlert({
          hasPendingUserInput: false,
          hasPendingApprovals: false,
          latestTurn: { state: "running" } as never,
        }),
      ).toBe("running");

      expect(
        resolveAgentSessionStatusAlert({
          hasPendingUserInput: false,
          hasPendingApprovals: false,
          latestTurn: { state: "completed" } as never,
        }),
      ).toBe("idle");

      expect(
        resolveAgentSessionStatusAlert(
          {
            hasPendingUserInput: false,
            hasPendingApprovals: false,
            latestTurn: { state: "completed" } as never,
          },
          { isFocused: false },
        ),
      ).toBe("completed-unread");

      expect(resolveAgentSessionStatusAlert(null)).toBe("idle");
    });
  });

  describe("resolveTerminalSessionStatusAlert", () => {
    it("prioritizes error over running subprocess", () => {
      expect(
        resolveTerminalSessionStatusAlert({
          hasRunningSubprocess: true,
          status: "error",
          exitCode: 1,
        }),
      ).toBe("error");
    });

    it("resolves running when subprocess is active without errors", () => {
      expect(
        resolveTerminalSessionStatusAlert({
          hasRunningSubprocess: true,
          status: "running",
          exitCode: null,
        }),
      ).toBe("running");
    });

    it("resolves error on error status or non-zero exit code", () => {
      expect(
        resolveTerminalSessionStatusAlert({
          hasRunningSubprocess: false,
          status: "error",
          exitCode: null,
        }),
      ).toBe("error");

      expect(
        resolveTerminalSessionStatusAlert({
          hasRunningSubprocess: false,
          status: "exited",
          exitCode: 1,
        }),
      ).toBe("error");
    });

    it("resolves idle for clean exits or idle shells", () => {
      expect(
        resolveTerminalSessionStatusAlert({
          hasRunningSubprocess: false,
          status: "running",
          exitCode: 0,
        }),
      ).toBe("idle");

      expect(resolveTerminalSessionStatusAlert(null)).toBe("idle");
    });
  });

  describe("resolveTerminalIcon", () => {
    it("returns agent icon when running a detected agent CLI", () => {
      expect(
        resolveTerminalIcon({ hasRunningSubprocess: true, label: "opencode" }),
      ).toBe(OpenCodeIcon);

      expect(
        resolveTerminalIcon({ hasRunningSubprocess: true, label: "claude" }),
      ).toBe(ClaudeAI);

      expect(
        resolveTerminalIcon({ hasRunningSubprocess: true, label: "codex" }),
      ).toBe(OpenAI);

      expect(
        resolveTerminalIcon({ hasRunningSubprocess: true, label: "cursor" }),
      ).toBe(CursorIcon);
    });

    it("falls back to TerminalIcon when idle or running other commands", () => {
      expect(
        resolveTerminalIcon({ hasRunningSubprocess: true, label: "python" }),
      ).toBe(TerminalIcon);

      expect(
        resolveTerminalIcon({ hasRunningSubprocess: false, label: "claude" }),
      ).toBe(TerminalIcon);

      expect(resolveTerminalIcon(null)).toBe(TerminalIcon);
    });
  });

  describe("resolveAgentIcon", () => {
    it("returns corresponding brand icon or falls back to SparklesIcon", () => {
      expect(resolveAgentIcon(ProviderDriverKind.make("codex"))).toBe(OpenAI);
      expect(resolveAgentIcon(ProviderDriverKind.make("claudeAgent"))).toBe(ClaudeAI);
      expect(resolveAgentIcon(ProviderDriverKind.make("opencode"))).toBe(OpenCodeIcon);
      expect(resolveAgentIcon(ProviderDriverKind.make("cursor"))).toBe(CursorIcon);
      expect(resolveAgentIcon(null)).toBe(SparklesIcon);
    });
  });
});
