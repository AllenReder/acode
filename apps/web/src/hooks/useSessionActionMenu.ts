import { useCallback } from "react";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { readLocalApi } from "../localApi";
import { getActiveTab, isSameSessionTarget } from "../workbench/workbenchState";
import { useWorkbenchStore } from "../workbench/workbenchStore";
import {
  buildSessionActionMenuItems,
  type SessionActionMenuId,
  type SessionActionMenuState,
} from "../components/sidebar/sessionActionMenu.logic";
import { useSessionCommands, type SessionTarget } from "./useSessionCommands";

export function useSessionActionMenu(input: {
  readonly target: SessionTarget;
  readonly isClosed?: boolean | undefined;
  readonly sessionTitle?: string | undefined;
  readonly onStartRename?: (() => void) | undefined;
}) {
  const { target, isClosed = false, sessionTitle, onStartRename } = input;
  const store = useWorkbenchStore();
  const commands = useSessionCommands(target);

  const openMenu = useCallback(
    (position: { x: number; y: number }) => {
      void (async () => {
        const api = readLocalApi();
        if (!api) return;

        const tab = getActiveTab(store);
        let isOpenInActiveTab = false;
        let isFocusedInActiveTab = false;

        for (const [paneId, view] of tab.panes) {
          if (isSameSessionTarget(view.target, target)) {
            isOpenInActiveTab = true;
            if (paneId === tab.focusedPaneId) {
              isFocusedInActiveTab = true;
            }
            break;
          }
        }

        const state: SessionActionMenuState = {
          kind: target.kind === "agentSession" ? "agent" : "terminal",
          isClosed,
          isOpenInActiveTab,
          isFocusedInActiveTab,
          canRename: target.kind === "agentSession" && onStartRename !== undefined,
          canClose: true,
          canDelete: true,
        };

        const items = buildSessionActionMenuItems(state);
        const clicked = await settlePromise(() => api.contextMenu.show(items, position));
        if (clicked._tag === "Failure" || clicked.value === null) return;

        const action: SessionActionMenuId = clicked.value;
        switch (action) {
          case "open":
            commands.openSession();
            return;
          case "focus":
            commands.focusSession();
            return;
          case "split:right":
            commands.splitSession("right");
            return;
          case "split:down":
            commands.splitSession("down");
            return;
          case "rename":
            onStartRename?.();
            return;
          case "copy:identity":
            commands.copySessionIdentity();
            return;
          case "close-session":
            void commands.closeSession();
            return;
          case "delete-session":
            void commands.deleteSession(sessionTitle);
            return;
        }
      })();
    },
    [commands, isClosed, onStartRename, sessionTitle, store, target],
  );

  return { openMenu };
}
