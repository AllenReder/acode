import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vite-plus/test";
import type {
  AwenProjectId,
  AgentSessionId,
  EnvironmentId,
  TerminalSessionId,
  WorkspaceId,
} from "@awen/contracts";
import type { EnvironmentAwenProject } from "@awen/client-runtime/state/models";

import { SidebarProvider } from "../components/ui/sidebar";
import { WorkbenchWindowChrome } from "./WorkbenchWindowChrome";
import { applyCreateTab, applyOpenTarget, emptyWorkbenchSnapshot } from "./workbenchState";
import { useWorkbenchStore } from "./workbenchStore";
import type { ViewTarget } from "./viewRegistry";

const environmentId = "env-a" as EnvironmentId;
const workspaceId = "ws-a" as WorkspaceId;
const projectId = "project-a" as AwenProjectId;
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

const projects: ReadonlyArray<EnvironmentAwenProject> = [
  {
    id: projectId,
    environmentId,
    title: "Awen",
    createdAt: now,
    updatedAt: now,
    workspaces: [
      {
        id: workspaceId,
        projectId,
        awenProjectId: "awen-project-a" as never,
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
  expect(html).not.toContain("Awen");
});

it("does not render titlebar separator in WorkbenchWindowChrome when sidebar is expanded", () => {
  const snapshot = createTestSnapshot();

  const html = renderToStaticMarkup(
    <SidebarProvider defaultOpen={true}>
      <WorkbenchWindowChrome snapshot={snapshot} projects={projects} />
    </SidebarProvider>,
  );

  expect(html).not.toContain('data-slot="workbench-titlebar-separator"');
});

it("renders separator and offset for docked controls when sidebar is collapsed", () => {
  const snapshot = createTestSnapshot();

  const html = renderToStaticMarkup(
    <SidebarProvider defaultOpen={false}>
      <WorkbenchWindowChrome snapshot={snapshot} projects={projects} />
    </SidebarProvider>,
  );

  expect(html).toContain('data-slot="workbench-titlebar-separator"');
});

it("renders flat tiling tabs with uniform width and hover-only close buttons", () => {
  const snapshot = createTestSnapshot();

  const html = renderToStaticMarkup(
    <SidebarProvider defaultOpen>
      <WorkbenchWindowChrome snapshot={snapshot} projects={projects} />
    </SidebarProvider>,
  );

  // Flat tiling width w-44 and border-r divider
  expect(html).toContain("w-44");
  expect(html).toContain("border-r");
  // Close button with hover opacity
  expect(html).toContain("opacity-0 group-hover:opacity-100");
});

it("omits window controls in standard non-desktop environment", () => {
  const snapshot = createTestSnapshot();

  const html = renderToStaticMarkup(
    <SidebarProvider defaultOpen>
      <WorkbenchWindowChrome snapshot={snapshot} projects={projects} />
    </SidebarProvider>,
  );

  expect(html).not.toContain('data-slot="window-controls"');
});

it("renders window controls at the trailing end of the topbar when on Windows desktop", () => {
  const snapshot = createTestSnapshot();

  vi.stubGlobal("window", {
    __TAURI_INTERNALS__: {},
  });
  vi.stubGlobal("navigator", {
    platform: "Win32",
  });

  const html = renderToStaticMarkup(
    <SidebarProvider defaultOpen>
      <WorkbenchWindowChrome snapshot={snapshot} projects={projects} />
    </SidebarProvider>,
  );

  expect(html).toContain('data-slot="window-controls"');
  expect(html).toContain('aria-label="Minimize"');
  expect(html).toContain('aria-label="Maximize"');
  expect(html).toContain('aria-label="Close"');

  vi.unstubAllGlobals();
});

it("renders window controls at the trailing end of the topbar when on Linux desktop", () => {
  const snapshot = createTestSnapshot();

  vi.stubGlobal("window", {
    __TAURI_INTERNALS__: {},
  });
  vi.stubGlobal("navigator", {
    platform: "Linux x86_64",
  });

  const html = renderToStaticMarkup(
    <SidebarProvider defaultOpen>
      <WorkbenchWindowChrome snapshot={snapshot} projects={projects} />
    </SidebarProvider>,
  );

  expect(html).toContain('data-slot="window-controls"');
  expect(html).toContain('aria-label="Minimize"');
  expect(html).toContain('aria-label="Maximize"');
  expect(html).toContain('aria-label="Close"');

  vi.unstubAllGlobals();
});

it("renders tabs as draggable tab sources with data-workbench-drag-source", () => {
  const snapshot = createTestSnapshot();

  const html = renderToStaticMarkup(
    <SidebarProvider defaultOpen>
      <WorkbenchWindowChrome snapshot={snapshot} projects={projects} />
    </SidebarProvider>,
  );

  expect(html).toContain('data-workbench-drag-source="tab"');
});

it("activates an inactive tab immediately on pointerdown unless clicking close button", async () => {
  const snapshot = createTestSnapshot();
  const activateTab = vi.fn();
  const closeTab = vi.fn();
  useWorkbenchStore.setState({ activateTab, closeTab });

  const { create, act } = await import("react-test-renderer");
  let renderer: any;
  await act(async () => {
    renderer = create(
      <SidebarProvider defaultOpen>
        <WorkbenchWindowChrome snapshot={snapshot} projects={projects} />
      </SidebarProvider>,
    );
  });

  const tabElements = renderer.root.findAllByProps({ role: "tab" });
  expect(tabElements).toHaveLength(2);

  const inactiveTab = tabElements[0];
  expect(inactiveTab.props["data-active-tab"]).toBe("false");

  // Pointer down on inactive tab activates it
  await act(async () => {
    inactiveTab.props.onPointerDown({
      button: 0,
      target: { closest: () => null },
    });
  });
  expect(activateTab).toHaveBeenCalledWith(snapshot.tabs[0]!.id);

  // Pointer down on close button does not activate
  activateTab.mockClear();
  await act(async () => {
    inactiveTab.props.onPointerDown({
      button: 0,
      target: { closest: (sel: string) => (sel.includes("button") ? {} : null) },
    });
  });
  expect(activateTab).not.toHaveBeenCalled();
});

it("renders tabs with workbench-tab-item class and will-change-transform for smooth fluid reordering", () => {
  const snapshot = createTestSnapshot();

  const html = renderToStaticMarkup(
    <SidebarProvider defaultOpen>
      <WorkbenchWindowChrome snapshot={snapshot} projects={projects} />
    </SidebarProvider>,
  );

  expect(html).toContain("workbench-tab-item");
  expect(html).toContain("will-change-transform");
});
