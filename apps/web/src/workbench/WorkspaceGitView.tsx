import { lazy, Suspense } from "react";
import { useAcodeWorkspace } from "../state/entities";
import type { ViewTarget } from "./viewRegistry";
import { Spinner } from "~/components/ui/spinner";

const DiffPanel = lazy(() => import("../components/DiffPanel"));

export interface WorkspaceGitViewProps {
  readonly target: Extract<ViewTarget, { kind: "workspace" }>;
  readonly paneId: string;
  readonly focused: boolean;
  readonly focusRequestId?: number;
  readonly availableSize: { readonly width: number; readonly height: number };
}

export function WorkspaceGitView({
  target,
  paneId: _paneId,
  focused: _focused,
  focusRequestId: _focusRequestId = 0,
  availableSize: _availableSize,
}: WorkspaceGitViewProps) {
  const workspace = useAcodeWorkspace(target.environmentId, target.workspaceId);

  if (workspace === null) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6 text-sm text-muted-foreground">
        Workspace is no longer available.
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-1 overflow-hidden"
      data-testid="workspace-git-view"
    >
      <Suspense
        fallback={
          <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
            <Spinner className="size-5" />
          </div>
        }
      >
        <DiffPanel
          mode="embedded"
          workspaceScope={{
            environmentId: target.environmentId,
            workspaceId: target.workspaceId,
            cwd: workspace.workspaceRoot,
          }}
          initialGitScope="unstaged"
          workspaceMutationId={null}
        />
      </Suspense>
    </div>
  );
}
