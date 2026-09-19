import { targetKey } from "./viewRegistry";
import type { ViewProps, ViewTarget } from "./viewRegistry";
import type { WelcomeCapabilities, WelcomeData } from "./workspaceViews";

export function WelcomeView({
  data,
  capabilities,
}: ViewProps<Extract<ViewTarget, { kind: "welcome" }>, WelcomeData, WelcomeCapabilities>) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 overflow-auto p-6 text-center">
      <h1 className="text-lg font-medium">Welcome to ACode</h1>
      <p className="text-sm text-muted-foreground">
        Open a Session from the Sidebar or select a Workspace.
      </p>
      {data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Add a Project from the Sidebar to get started.
        </p>
      )}
      {data.map((workspace) => (
        <button
          key={targetKey(workspace.target)}
          type="button"
          className="rounded px-3 py-2 text-sm hover:bg-accent"
          onClick={() => capabilities.openWorkspace.execute(workspace.target)}
        >
          {workspace.projectTitle} / {workspace.title}
        </button>
      ))}
    </div>
  );
}
