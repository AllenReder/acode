import { lazy, Suspense, useEffect, useState } from "react";
import { useAcodeWorkspace } from "../state/entities";
import type { ViewTarget } from "./viewRegistry";
import { Spinner } from "~/components/ui/spinner";

const FilePreviewPanel = lazy(() => import("../components/files/FilePreviewPanel"));

export interface WorkspaceFileViewProps {
  readonly target: Extract<ViewTarget, { kind: "workspace" }>;
  readonly paneId: string;
  readonly focused: boolean;
  readonly focusRequestId?: number;
  readonly availableSize: { readonly width: number; readonly height: number };
}

export function WorkspaceFileView({
  target,
  paneId,
  focused: _focused,
  focusRequestId: _focusRequestId = 0,
  availableSize: _availableSize,
}: WorkspaceFileViewProps) {
  const workspace = useAcodeWorkspace(target.environmentId, target.workspaceId);
  const [selectedPath, setSelectedPath] = useState<string | null>(
    "initialPath" in target && typeof target.initialPath === "string" ? target.initialPath : null,
  );
  const [revealLine, setRevealLine] = useState<number | null>(
    "revealLine" in target && typeof target.revealLine === "number" ? target.revealLine : null,
  );
  const [revealRequestId, setRevealRequestId] = useState(1);

  useEffect(() => {
    if ("initialPath" in target && typeof target.initialPath === "string") {
      setSelectedPath(target.initialPath);
      setRevealLine(
        "revealLine" in target && typeof target.revealLine === "number" ? target.revealLine : null,
      );
      setRevealRequestId((r) => r + 1);
    }
  }, [target]);

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
      data-testid="workspace-file-view"
    >
      <Suspense
        fallback={
          <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
            <Spinner className="size-5" />
          </div>
        }
      >
        <FilePreviewPanel
          environmentId={target.environmentId}
          cwd={workspace.workspaceRoot}
          projectName={workspace.title}
          relativePath={selectedPath}
          revealLine={revealLine}
          revealRequestId={revealRequestId}
          onOpenFile={(relativePath) => {
            setSelectedPath(relativePath);
            setRevealLine(null);
            setRevealRequestId((r) => r + 1);
          }}
          paneId={paneId}
          explicitSave
          workspaceMutationId={null}
        />
      </Suspense>
    </div>
  );
}
