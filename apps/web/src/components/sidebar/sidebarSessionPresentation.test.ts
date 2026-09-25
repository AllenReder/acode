import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind } from "@awen/contracts";
import {
  detectAgentDriverFromCommand,
  isUnreadCompletion,
  resolveAgentIcon,
  resolveAgentSessionStatus,
  resolveTerminalIcon,
  resolveTerminalSessionStatus,
} from "./sidebarSessionPresentation";
import { ClaudeAI, CursorIcon, OpenAI, OpenCodeIcon } from "../Icons";
import { SparklesIcon, TerminalIcon } from "lucide-react";

const agent = (overrides: Record<string, unknown> = {}) =>
  ({
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    interactionMode: "default",
    latestTurn: null,
    session: null,
    backgroundLiveness: null,
    ...overrides,
  }) as never;

const runningSession = { status: "running" } as never;
const settledTurn = {
  turnId: "t1",
  state: "completed",
  startedAt: "2026-03-09T10:00:00.000Z",
  completedAt: "2026-03-09T10:05:00.000Z",
} as never;

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

  describe("resolveAgentSessionStatus", () => {
    it("prioritizes approval over input and running work", () => {
      expect(
        resolveAgentSessionStatus(
          agent({ hasPendingApprovals: true, hasPendingUserInput: true, session: runningSession }),
        ),
      ).toBe("approval");
    });

    it("prioritizes awaiting input over running work", () => {
      expect(
        resolveAgentSessionStatus(agent({ hasPendingUserInput: true, session: runningSession })),
      ).toBe("input");
    });

    it("reports working for running and starting sessions, and for background liveness", () => {
      expect(resolveAgentSessionStatus(agent({ session: runningSession }))).toBe("working");
      expect(resolveAgentSessionStatus(agent({ session: { status: "starting" } }))).toBe("working");
      expect(resolveAgentSessionStatus(agent({ backgroundLiveness: "working" }))).toBe("working");
    });

    it("reports failed whenever the session status is error", () => {
      expect(resolveAgentSessionStatus(agent({ session: { status: "error" } }))).toBe("failed");
      // A failed session outranks lingering background liveness.
      expect(
        resolveAgentSessionStatus(
          agent({ session: { status: "error" }, backgroundLiveness: "working" }),
        ),
      ).toBe("failed");
    });

    it("falls back to a failed latest turn when the session is absent", () => {
      expect(
        resolveAgentSessionStatus(
          agent({ session: null, latestTurn: { state: "error" } as never }),
        ),
      ).toBe("failed");
    });

    it("reports plan for a settled plan-mode turn with an actionable plan", () => {
      expect(
        resolveAgentSessionStatus(
          agent({
            interactionMode: "plan",
            hasActionableProposedPlan: true,
            latestTurn: settledTurn,
          }),
        ),
      ).toBe("plan");
    });

    it("never reports plan on an error turn or an unsettled turn", () => {
      expect(
        resolveAgentSessionStatus(
          agent({
            interactionMode: "plan",
            hasActionableProposedPlan: true,
            latestTurn: { state: "error", startedAt: "x", completedAt: "y" } as never,
          }),
        ),
      ).toBe("failed");
      expect(
        resolveAgentSessionStatus(
          agent({
            interactionMode: "plan",
            hasActionableProposedPlan: true,
            latestTurn: { state: "completed", startedAt: "x", completedAt: null } as never,
          }),
        ),
      ).toBe("ready");
    });

    it("reports monitoring for watch-loop liveness and ready otherwise", () => {
      expect(resolveAgentSessionStatus(agent({ backgroundLiveness: "monitoring" }))).toBe(
        "monitoring",
      );
      expect(resolveAgentSessionStatus(agent())).toBe("ready");
      expect(resolveAgentSessionStatus(null)).toBe("ready");
      expect(resolveAgentSessionStatus(undefined)).toBe("ready");
    });
  });

  describe("resolveTerminalSessionStatus", () => {
    it("reports working while a foreground subprocess runs", () => {
      expect(resolveTerminalSessionStatus({ hasRunningSubprocess: true, status: "running" })).toBe(
        "working",
      );
    });

    it("reports failed on an error status or a non-zero exit code", () => {
      expect(
        resolveTerminalSessionStatus({ hasRunningSubprocess: false, status: "error", exitCode: 1 }),
      ).toBe("failed");
      expect(
        resolveTerminalSessionStatus({
          hasRunningSubprocess: false,
          status: "exited",
          exitCode: 1,
        }),
      ).toBe("failed");
    });

    it("reports ready for a clean exit or an idle shell", () => {
      expect(
        resolveTerminalSessionStatus({
          hasRunningSubprocess: false,
          status: "running",
          exitCode: 0,
        }),
      ).toBe("ready");
      expect(resolveTerminalSessionStatus(null)).toBe("ready");
    });
  });

  describe("isUnreadCompletion", () => {
    const completedTurn = { state: "completed", completedAt: "2026-03-09T10:05:00.000Z" };

    it("is unread for a completed ready session with no visit marker", () => {
      expect(
        isUnreadCompletion({
          status: "ready",
          latestTurn: completedTurn,
          lastVisitedAt: undefined,
        }),
      ).toBe(true);
    });

    it("is unread when the completion postdates the last visit", () => {
      expect(
        isUnreadCompletion({
          status: "ready",
          latestTurn: completedTurn,
          lastVisitedAt: "2026-03-09T10:04:00.000Z",
        }),
      ).toBe(true);
    });

    it("is read once the visit reaches the completion", () => {
      expect(
        isUnreadCompletion({
          status: "ready",
          latestTurn: completedTurn,
          lastVisitedAt: "2026-03-09T10:05:00.000Z",
        }),
      ).toBe(false);
    });

    it("is never unread for a non-ready session or a non-completed turn", () => {
      expect(
        isUnreadCompletion({
          status: "working",
          latestTurn: completedTurn,
          lastVisitedAt: undefined,
        }),
      ).toBe(false);
      expect(
        isUnreadCompletion({
          status: "ready",
          latestTurn: { state: "error", completedAt: "2026-03-09T10:05:00.000Z" },
          lastVisitedAt: undefined,
        }),
      ).toBe(false);
      expect(
        isUnreadCompletion({
          status: "ready",
          latestTurn: { state: "completed" },
          lastVisitedAt: undefined,
        }),
      ).toBe(false);
    });

    it("treats a malformed visit marker as never visited", () => {
      expect(
        isUnreadCompletion({
          status: "ready",
          latestTurn: completedTurn,
          lastVisitedAt: "not-a-date",
        }),
      ).toBe(true);
    });
  });

  describe("resolveTerminalIcon", () => {
    it("returns agent icon when running a detected agent CLI", () => {
      expect(resolveTerminalIcon({ hasRunningSubprocess: true, label: "opencode" })).toBe(
        OpenCodeIcon,
      );

      expect(resolveTerminalIcon({ hasRunningSubprocess: true, label: "claude" })).toBe(ClaudeAI);

      expect(resolveTerminalIcon({ hasRunningSubprocess: true, label: "codex" })).toBe(OpenAI);

      expect(resolveTerminalIcon({ hasRunningSubprocess: true, label: "cursor" })).toBe(CursorIcon);
    });

    it("falls back to TerminalIcon when idle or running other commands", () => {
      expect(resolveTerminalIcon({ hasRunningSubprocess: true, label: "python" })).toBe(
        TerminalIcon,
      );

      expect(resolveTerminalIcon({ hasRunningSubprocess: false, label: "claude" })).toBe(
        TerminalIcon,
      );

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
