import { useCallback } from "react";
import type { ScopedThreadRef } from "@awen/contracts";
import { scopedThreadKey } from "@awen/client-runtime/environment";
import { squashAtomCommandFailure } from "@awen/client-runtime/state/runtime";
import { composerDraftHasUserContent, useComposerDraftStore } from "../composerDraftStore";
import { readThreadDetail, readThreadShell } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../components/ui/toast";

export type AgentCloseReason = "session" | "last-view";
export type WillCloseRevert = () => void;
export interface AgentCloseOptions {
  readonly reason: AgentCloseReason;
  readonly onWillClose?: () => Promise<WillCloseRevert | void> | WillCloseRevert | void;
  readonly hasOpenView?: () => boolean;
}

/** One policy for explicit Session closure and cleanup after its final View closes. */
export function resolveAgentCloseAction(ref: ScopedThreadRef, reason: AgentCloseReason) {
  const shell = readThreadShell(ref);
  const detail = readThreadDetail(ref);
  const drafts = useComposerDraftStore.getState();
  const draftId = drafts.getDraftIdByRef(ref);
  const untouched =
    shell !== null &&
    shell.latestTurn === null &&
    shell.session === null &&
    shell.latestUserMessageAt == null &&
    (detail?.messages.length ?? 0) === 0 &&
    !shell.hasPendingApprovals &&
    !shell.hasPendingUserInput &&
    !shell.backgroundLiveness &&
    !drafts.backgroundSubmissionThreadKeys[scopedThreadKey(ref)] &&
    !composerDraftHasUserContent(drafts.getComposerDraft(ref)) &&
    (draftId === null || !composerDraftHasUserContent(drafts.getComposerDraft(draftId)));
  if (untouched) return "delete";
  return reason === "session" ? "archive" : "keep";
}

// A Session can be closed from multiple Views and the Sidebar in the same frame.
type CloseOutcome = "closed" | "kept" | "failed";
const pendingClosures = new Map<string, Promise<CloseOutcome>>();

export function useAgentSessionLifecycle() {
  const stop = useAtomCommand(threadEnvironment.stopSession, { reportFailure: false });
  const archive = useAtomCommand(threadEnvironment.archive, { reportFailure: false });
  const remove = useAtomCommand(threadEnvironment.delete, { reportFailure: false });

  return useCallback(
    function closeAgent(ref: ScopedThreadRef, options: AgentCloseOptions): Promise<boolean> {
      if (
        options.reason === "last-view" &&
        (options.hasOpenView?.() || resolveAgentCloseAction(ref, options.reason) === "keep")
      )
        return Promise.resolve(true);
      const key = scopedThreadKey(ref);
      const pending = pendingClosures.get(key);
      if (pending)
        return pending.then((outcome) =>
          outcome === "kept" && options.reason === "session"
            ? closeAgent(ref, options)
            : outcome !== "failed",
        );
      const run = async (): Promise<CloseOutcome> => {
        let revert: WillCloseRevert | void = undefined;
        try {
          if (options.reason === "last-view" && options.hasOpenView?.()) return "kept";
          let action = resolveAgentCloseAction(ref, options.reason);
          if (action === "keep") return "kept";
          const input = { environmentId: ref.environmentId, input: { threadId: ref.threadId } };
          const status = readThreadShell(ref)?.session?.status;
          if (options.reason === "session" && (status === "running" || status === "starting")) {
            const result = await stop(input);
            if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          }
          revert = await options.onWillClose?.();
          // Animation and stop RPCs can outlive edits or the first submitted turn.
          if (options.reason === "last-view" && options.hasOpenView?.()) return "kept";
          action = resolveAgentCloseAction(ref, options.reason);
          if (action === "keep") return "kept";
          const result = await (action === "delete" ? remove(input) : archive(input));
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          return "closed";
        } catch (error) {
          revert?.();
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to close agent session",
              description: error instanceof Error ? error.message : String(error),
            }),
          );
          return "failed";
        }
      };
      const promise = run().finally(() => {
        pendingClosures.delete(key);
      });
      pendingClosures.set(key, promise);
      return promise.then((outcome) => outcome !== "failed");
    },
    [stop, archive, remove],
  );
}
