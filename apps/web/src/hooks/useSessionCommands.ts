import { useCallback } from "react";
import type { EnvironmentId, ThreadId, WorkspaceId } from "@awen/contracts";
import { scopeThreadRef } from "@awen/client-runtime/environment";
import { squashAtomCommandFailure } from "@awen/client-runtime/state/runtime";
import { requestDestructiveConfirmation } from "../lib/destructiveConfirmation";
import { readThreadShell, useAwenAgentSessionShell } from "../state/entities";
import { terminalEnvironment } from "../state/terminal";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { runtimeTerminalIdForTarget } from "../workbench/sessionTarget";
import { targetKey, type ViewTarget } from "../workbench/viewRegistry";
import { getActiveTab, findPaneBySessionTarget, type SplitDir } from "../workbench/workbenchState";
import { useWorkbenchStore } from "../workbench/workbenchStore";

export type SessionTarget = Extract<ViewTarget, { kind: "agentSession" | "workspaceTerminal" }>;

function failureToast(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

export type WillCloseRevert = () => void;

export function useSessionCommands(
  target: SessionTarget,
  options?: {
    readonly onWillClose?: () => Promise<WillCloseRevert | void> | WillCloseRevert | void;
  },
) {
  const store = useWorkbenchStore();
  const stopThreadSession = useAtomCommand(threadEnvironment.stopSession, { reportFailure: false });
  const archiveThread = useAtomCommand(threadEnvironment.archive, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const closeTerminal = useAtomCommand(terminalEnvironment.close, { reportFailure: false });

  const agentSession = useAwenAgentSessionShell(
    target.kind === "agentSession" ? target.environmentId : null,
    target.kind === "agentSession" ? target.workspaceId : null,
    target.kind === "agentSession" ? target.agentSessionId : null,
  );

  const openSession = useCallback(() => {
    store.openTarget(target);
  }, [store, target]);

  const focusSession = useCallback(() => {
    const tab = getActiveTab(store);
    const existingPaneId = findPaneBySessionTarget(tab, target);
    if (existingPaneId !== null) {
      store.setFocused(existingPaneId);
      return;
    }
    store.openTarget(target);
  }, [store, target]);

  const splitSession = useCallback(
    (dir: SplitDir) => {
      store.splitFocused(target, dir);
    },
    [store, target],
  );

  const handleCloseSession = useCallback(async () => {
    if (target.kind === "agentSession") {
      const threadId = agentSession?.threadId;
      if (!threadId) {
        failureToast(
          "Failed to close agent session",
          new Error("Agent session thread is not loaded."),
        );
        return;
      }
      const threadShell = readThreadShell(scopeThreadRef(target.environmentId, threadId));
      if (threadShell?.session && threadShell.session.status === "running") {
        const stopResult = await stopThreadSession({
          environmentId: target.environmentId,
          input: { threadId },
        });
        if (stopResult._tag === "Failure") {
          failureToast("Failed to stop agent session", squashAtomCommandFailure(stopResult));
          return;
        }
      }
      let revert: WillCloseRevert | void = undefined;
      if (options?.onWillClose) {
        revert = await options.onWillClose();
      }
      const isZeroTurn = Boolean(threadShell && !threadShell.latestTurn && !threadShell.session);
      if (isZeroTurn) {
        const deleteResult = await deleteThread({
          environmentId: target.environmentId,
          input: { threadId },
        });
        if (deleteResult._tag === "Failure") {
          revert?.();
          failureToast("Failed to close agent session", squashAtomCommandFailure(deleteResult));
          return;
        }
        store.removeSessionViews(target);
        return;
      }
      const archiveResult = await archiveThread({
        environmentId: target.environmentId,
        input: { threadId },
      });
      if (archiveResult._tag === "Failure") {
        revert?.();
        failureToast("Failed to close agent session", squashAtomCommandFailure(archiveResult));
        return;
      }
      store.removeSessionViews(target);
      toastManager.add({ type: "success", title: "Agent session closed" });
    } else {
      const terminalId = runtimeTerminalIdForTarget(target);
      if (!terminalId) {
        failureToast(
          "Failed to close terminal session",
          new Error("Terminal id could not be resolved."),
        );
        return;
      }
      let revert: WillCloseRevert | void = undefined;
      if (options?.onWillClose) {
        revert = await options.onWillClose();
      }
      const result = await closeTerminal({
        environmentId: target.environmentId,
        input: { workspaceId: target.workspaceId, terminalId, deleteHistory: false },
      });
      if (result._tag === "Failure") {
        revert?.();
        failureToast("Failed to close terminal session", squashAtomCommandFailure(result));
        return;
      }
      store.removeSessionViews(target);
      toastManager.add({ type: "success", title: "Terminal session closed" });
    }
  }, [
    agentSession?.threadId,
    archiveThread,
    closeTerminal,
    options,
    stopThreadSession,
    store,
    target,
  ]);

  const handleDeleteSession = useCallback(
    async (sessionTitle?: string) => {
      const title =
        sessionTitle ??
        (target.kind === "agentSession"
          ? (agentSession?.title ?? "Agent Session")
          : "Terminal Session");
      const confirmed = await requestDestructiveConfirmation({
        message: [
          `Delete session "${title}"?`,
          "This permanently clears all conversation and output history for this session.",
        ].join("\n"),
        onFailure: (error) => failureToast("Failed to confirm session deletion", error),
      });
      if (!confirmed) return;
      let revert: WillCloseRevert | void = undefined;
      if (options?.onWillClose) {
        revert = await options.onWillClose();
      }

      if (target.kind === "agentSession") {
        const threadId = agentSession?.threadId;
        if (!threadId) {
          revert?.();
          failureToast(
            "Failed to delete agent session",
            new Error("Agent session thread is not loaded."),
          );
          return;
        }
        const threadShell = readThreadShell(scopeThreadRef(target.environmentId, threadId));
        if (threadShell?.session && threadShell.session.status !== "stopped") {
          await stopThreadSession({
            environmentId: target.environmentId,
            input: { threadId },
          });
        }
        const deleteResult = await deleteThread({
          environmentId: target.environmentId,
          input: { threadId },
        });
        if (deleteResult._tag === "Failure") {
          revert?.();
          failureToast("Failed to delete agent session", squashAtomCommandFailure(deleteResult));
          return;
        }
        store.removeSessionViews(target);
        toastManager.add({ type: "success", title: "Agent session deleted" });
      } else {
        const terminalId = runtimeTerminalIdForTarget(target);
        if (!terminalId) {
          revert?.();
          failureToast(
            "Failed to delete terminal session",
            new Error("Terminal id could not be resolved."),
          );
          return;
        }
        const result = await closeTerminal({
          environmentId: target.environmentId,
          input: { workspaceId: target.workspaceId, terminalId, deleteHistory: true },
        });
        if (result._tag === "Failure") {
          revert?.();
          failureToast("Failed to delete terminal session", squashAtomCommandFailure(result));
          return;
        }
        store.removeSessionViews(target);
        toastManager.add({ type: "success", title: "Terminal session deleted" });
      }
    },
    [
      agentSession?.threadId,
      agentSession?.title,
      closeTerminal,
      deleteThread,
      stopThreadSession,
      store,
      target,
    ],
  );

  return {
    openSession,
    focusSession,
    splitSession,
    closeSession: handleCloseSession,
    deleteSession: handleDeleteSession,
  };
}
