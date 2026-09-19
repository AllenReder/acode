import { targetKey } from "./viewRegistry";
import type { ViewProps } from "./viewRegistry";
import type { WorkspaceCapabilities, WorkspaceSummary, WorkspaceTarget } from "./workspaceViews";

export function WorkspaceView({
  data,
  capabilities,
}: ViewProps<WorkspaceTarget, WorkspaceSummary | null, WorkspaceCapabilities>) {
  if (!data)
    return <p className="p-6 text-sm text-muted-foreground">Workspace is no longer available.</p>;
  return (
    <section
      aria-label="Workspace overview"
      className="flex h-full min-w-0 flex-col gap-2 overflow-auto p-6"
    >
      <p className="text-sm text-muted-foreground">{data.projectTitle}</p>
      <h1 className="text-lg font-medium">{data.title}</h1>
      {data.sessions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No Sessions in this Workspace. Create one from the Sidebar.
        </p>
      )}
      {data.sessions.map(({ title, target }) => {
        return (
          <button
            key={targetKey(target)}
            type="button"
            className="rounded px-3 py-2 text-left text-sm hover:bg-accent"
            onClick={() => capabilities.openSession.execute(target)}
          >
            {title}
          </button>
        );
      })}
    </section>
  );
}
