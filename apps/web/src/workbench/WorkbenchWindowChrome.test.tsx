import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vite-plus/test";
import type {
  AcodeProjectId,
  AgentSessionId,
  EnvironmentId,
  TerminalSessionId,
  WorkspaceId,
} from "@t3tools/contracts";
import type { EnvironmentAcodeProject } from "@t3tools/client-runtime/state/models";

import { SidebarProvider } from "../components/ui/sidebar";
import { WorkbenchWindowChrome } from "./WorkbenchWindowChrome";
import { applyCreateTab, applyOpenTarget, emptyWorkbenchSnapshot } from "./workbenchState";
import type { ViewTarget } from "./viewRegistry";

const environmentId = "env-a" as EnvironmentId;
const workspaceId = "ws-a" as WorkspaceId;
const projectId = "project-a" as AcodeProjectId;
const agentSessionId = "agent-a" as AgentSessionId;
const now = "2026-09-20T00:00:00.000Z";

const agentTarget = {
  kind: "agentSession",
  environmentId,
  workspaceId,
  agentSessionId,
} satisfies ViewTarget;

const terminalTarget = {
  kind: "workspaceTerminal",
  environmentId,
  workspaceId,
  terminalSessionId: "terminal-a" as TerminalSessionId,
} satisfies ViewTarget;

const projects: ReadonlyArray<EnvironmentAcodeProject> = [
  {
    id: projectId,
    environmentId,
    title: "ACode",
    createdAt: now,
    updatedAt: now,
    workspaces: [
      {
        id: workspaceId,
        projectId,
        t3ProjectId: "t3-project-a" as never,
        title: "Main",
        workspaceRoot: "/workspace",
        role: "main",
        createdAt: now,
        updatedAt: now,
        sessions: [
          {
            kind: "agent",
            id: agentSessionId,
            workspaceId,
            title: "Implement tabs",
            status: "open",
            createdAt: now,
            updatedAt: now,
            threadId: "thread-a" as never,
          },
          {
            kind: "terminal",
            id: terminalTarget.terminalSessionId,
            workspaceId,
            title: "Dev server",
            status: "open",
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    ],
  },
];

function createTestSnapshot() {
  const ids = (() => {
    let n = 0;
    return () => `id-${++n}`;
  })();
  let snapshot = applyOpenTarget(emptyWorkbenchSnapshot(ids), agentTarget, ids);
  snapshot = applyCreateTab(snapshot, ids);
  return applyOpenTarget(snapshot, terminalTarget, ids);
}

it("renders the selected compact tab strip with real titles and a new-tab action", () => {
  const snapshot = createTestSnapshot();

  const html = renderToStaticMarkup(
    <SidebarProvider defaultOpen>
      <WorkbenchWindowChrome snapshot={snapshot} projects={projects} />
    </SidebarProvider>,
  );

  expect(html).toContain("data-workbench-window-chrome");
  expect(html).toContain("data-tauri-drag-region");
  expect(html).toContain("Dev server");
  expect(html).toContain('aria-label="Open Implement tabs"');
  expect(html).toContain('aria-label="New tab"');
  expect(html).not.toContain("T3 Code");
});

it("does not render window controls in WorkbenchWindowChrome when sidebar is expanded", () => {
  const snapshot = createTestSnapshot();

  const html = renderToStaticMarkup(
    <SidebarProvider defaultOpen={true}>
      <WorkbenchWindowChrome snapshot={snapshot} projects={projects} />
    </SidebarProvider>,
  );

  expect(html).not.toContain('data-testid="workbench-settings-button"');
});

it("renders traffic-light offset and settings button when sidebar is collapsed", () => {
  const snapshot = createTestSnapshot();

  const html = renderToStaticMarkup(
    <SidebarProvider defaultOpen={false}>
      <WorkbenchWindowChrome snapshot={snapshot} projects={projects} />
    </SidebarProvider>,
  );

  expect(html).toContain('data-testid="workbench-settings-button"');
  expect(html).toContain('data-slot="workbench-titlebar-separator"');
});
