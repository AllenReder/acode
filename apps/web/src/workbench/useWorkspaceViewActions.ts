import type { EnvironmentId, WorkspaceId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback } from "react";

import { nextWorkspaceTerminalId } from "../components/Sidebar.logic";
import { toastManager } from "../components/ui/toast";
import { terminalEnvironment } from "../state/terminal";
import { useAtomCommand } from "../state/use-atom-command";
import { terminalTargetForRuntime } from "./sessionTarget";
import type { ViewTarget } from "./viewRegistry";
import { useWorkbenchStore } from "./workbenchStore";

export interface WorkspaceViewActionsInput {
  readonly environmentId: EnvironmentId;
  readonly workspaceId: WorkspaceId;
  readonly paneId: string;
}

export function useWorkspaceViewActions({
  environmentId,
  workspaceId,
  paneId,
}: WorkspaceViewActionsInput) {
  const openTerminal = useAtomCommand(terminalEnvironment.open);

  const onBrowseFiles = useCallback(() => {
    const fileTarget: ViewTarget = {
      kind: "workspace",
      definitionId: "fileView",
      environmentId,
      workspaceId,
    };
    useWorkbenchStore.getState().splitPane(paneId, fileTarget, "right");
  }, [environmentId, paneId, workspaceId]);

  const onNewTerminalSession = useCallback(() => {
    const terminalId = nextWorkspaceTerminalId();
    void openTerminal({
      environmentId,
      input: { workspaceId, terminalId },
    }).then((result) => {
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const failure = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Unable to create terminal",
            description: failure instanceof Error ? failure.message : "An error occurred.",
          });
        }
        return;
      }
      const terminalTarget = terminalTargetForRuntime({
        environmentId,
        workspaceId,
        terminalId,
      });
      useWorkbenchStore.getState().splitPane(paneId, terminalTarget, "right");
    });
  }, [environmentId, openTerminal, paneId, workspaceId]);

  return { onBrowseFiles, onNewTerminalSession };
}
