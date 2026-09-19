import { useCallback } from "react";
import type { EnvironmentId, ThreadId, WorkspaceId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { readLocalApi } from "../localApi";
import { readThreadShell, useAcodeAgentSessionShell } from "../state/entities";
import { terminalEnvironment } from "../state/terminal";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useCopyToClipboard } from "./useCopyToClipboard";
import { runtimeTerminalIdForTarget } from "../workbench/sessionTarget";
import { targetKey, type ViewTarget } from "../workbench/viewRegistry";
import { getActiveTab, isSameSessionTarget, type SplitDir } from "../workbench/workbenchState";
import { useWorkbenchStore } from "../workbench/workbenchStore";

export type SessionTarget = Extract<ViewTarget, { kind: "agentSession" | "workspaceTerminal" }>;

export function useSessionCommands(target: SessionTarget) {
  const store = useWorkbenchStore();
  const stopThreadSession = useAtomCommand(threadEnvironment.stopSession, { reportFailure: false });
  const archiveThread = useAtomCommand(threadEnvironment.archive, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const closeTerminal = useAtomCommand(terminalEnvironment.close, { reportFailure: false });

  const agentSession = useAcodeAgentSessionShell(
    target.kind === "agentSession" ? target.environmentId : null,
    target.kind === "agentSession" ? target.workspaceId : null,
    target.kind === "agentSession" ? target.agentSessionId : null,
  );

  const { copyToClipboard } = useCopyToClipboard<{ identity: string }>({
    onCopy: ({ identity }) => {
      toastManager.add({
        type: "success",
        title: "Session identity copied",
        description: identity,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy identity",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });

  const openSession = useCallback(() => {
    store.openTarget(target);
  }, [store, target]);

  const focusSession = useCallback(() => {
    const tab = getActiveTab(store);
    for (const [paneId, view] of tab.panes) {
      if (isSameSessionTarget(view.target, target)) {
        store.setFocused(paneId);
        return;
      }
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
        store.removeSessionViews(target);
        return;
      }
      const threadShell = readThreadShell(scopeThreadRef(target.environmentId, threadId));
      if (threadShell?.session?.status === "running" && threadShell.session.activeTurnId != null) {
        const stopResult = await stopThreadSession({
          environmentId: target.environmentId,
          input: { threadId },
        });
        if (stopResult._tag === "Failure") {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to stop agent session",
              description:
                squashAtomCommandFailure(stopResult) instanceof Error
                  ? (squashAtomCommandFailure(stopResult) as Error).message
                  : "An error occurred.",
            }),
          );
          return;
        }
      }
      const archiveResult = await archiveThread({
        environmentId: target.environmentId,
        input: { threadId },
      });
      if (archiveResult._tag === "Failure") {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to close agent session",
            description:
              squashAtomCommandFailure(archiveResult) instanceof Error
                ? (squashAtomCommandFailure(archiveResult) as Error).message
                : "An error occurred.",
          }),
        );
        return;
      }
      store.removeSessionViews(target);
      toastManager.add({ type: "success", title: "Agent session closed" });
    } else {
      const terminalId = runtimeTerminalIdForTarget(target);
      if (!terminalId) return;
      const result = await closeTerminal({
        environmentId: target.environmentId,
        input: { workspaceId: target.workspaceId, terminalId, deleteHistory: false },
      });
      if (result._tag === "Failure") {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to close terminal session",
            description:
              squashAtomCommandFailure(result) instanceof Error
                ? (squashAtomCommandFailure(result) as Error).message
                : "An error occurred.",
          }),
        );
        return;
      }
      store.removeSessionViews(target);
      toastManager.add({ type: "success", title: "Terminal session closed" });
    }
  }, [agentSession?.threadId, archiveThread, closeTerminal, stopThreadSession, store, target]);

  const handleDeleteSession = useCallback(
    async (sessionTitle?: string) => {
      const title =
        sessionTitle ??
        (target.kind === "agentSession"
          ? (agentSession?.title ?? "Agent Session")
          : "Terminal Session");
      const localApi = readLocalApi();
      if (localApi) {
        const confirmed = await settlePromise(() =>
          localApi.dialogs.confirm(
            [
              `Delete session "${title}"?`,
              "This permanently clears all conversation and output history for this session.",
            ].join("\n"),
            { variant: "destructive" },
          ),
        );
        if (confirmed._tag === "Failure" || !confirmed.value) return;
      }

      if (target.kind === "agentSession") {
        const threadId = agentSession?.threadId;
        if (!threadId) return;
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
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to delete agent session",
              description:
                squashAtomCommandFailure(deleteResult) instanceof Error
                  ? (squashAtomCommandFailure(deleteResult) as Error).message
                  : "An error occurred.",
            }),
          );
          return;
        }
        store.removeSessionViews(target);
        toastManager.add({ type: "success", title: "Agent session deleted" });
      } else {
        const terminalId = runtimeTerminalIdForTarget(target);
        if (!terminalId) return;
        const result = await closeTerminal({
          environmentId: target.environmentId,
          input: { workspaceId: target.workspaceId, terminalId, deleteHistory: true },
        });
        if (result._tag === "Failure") {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to delete terminal session",
              description:
                squashAtomCommandFailure(result) instanceof Error
                  ? (squashAtomCommandFailure(result) as Error).message
                  : "An error occurred.",
            }),
          );
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

  const copySessionIdentity = useCallback(() => {
    const identity = targetKey(target);
    copyToClipboard(identity, { identity });
  }, [copyToClipboard, target]);

  return {
    openSession,
    focusSession,
    splitSession,
    closeSession: handleCloseSession,
    deleteSession: handleDeleteSession,
    copySessionIdentity,
  };
}
