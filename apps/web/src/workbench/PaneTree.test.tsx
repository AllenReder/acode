import { act, useEffect, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { PaneTree } from "./PaneTree";
import {
  emptyViewBinding,
  clearViewRegistry,
  registerViewDefinition,
  type ViewTarget,
} from "./viewRegistry";
import { resetWorkbenchStore, useWorkbenchStore } from "./workbenchStore";
import { getActiveTab } from "./workbenchState";
import { createWelcomeViewDefinition } from "./welcomeViewDefinition";
import type { EnvironmentId, WorkspaceId } from "@t3tools/contracts";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(() => renderer?.unmount());
  clearViewRegistry();
  resetWorkbenchStore();
  vi.unstubAllGlobals();
});

function Harness() {
  return <PaneTree snapshot={useWorkbenchStore()} />;
}

it("passes measured content size and keyboard focus to each View and releases measurement on close", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const observers: { callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] =
    [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect = vi.fn();
      constructor(callback: ResizeObserverCallback) {
        observers.push({ callback, disconnect: this.disconnect });
      }
      observe() {}
    },
  );
  registerViewDefinition({
    id: "workspace",
    label: "Workspace",
    accepts: (target): target is Extract<ViewTarget, { kind: "workspace" }> =>
      target.kind === "workspace",
    bind: emptyViewBinding,
    Component: ({ focused, availableSize }) => (
      <output>{`${focused}:${availableSize.width}x${availableSize.height}`}</output>
    ),
  });
  const first = {
    kind: "workspace",
    environmentId: "local" as EnvironmentId,
    workspaceId: "w1" as WorkspaceId,
  } as const;
  useWorkbenchStore.getState().openTarget(first);
  useWorkbenchStore
    .getState()
    .splitFocused({ ...first, workspaceId: "w2" as WorkspaceId }, "right");
  await act(() => {
    renderer = create(<Harness />, {
      createNodeMock: () => ({ getBoundingClientRect: () => ({ width: 600, height: 400 }) }),
    });
  });
  expect(renderer!.root.findAllByType("output").map((node) => node.children)).toEqual([
    ["false:600x400"],
    ["true:600x400"],
  ]);
  await act(() =>
    observers[0]!.callback(
      [{ contentRect: { width: 320, height: 240 } } as ResizeObserverEntry],
      {} as ResizeObserver,
    ),
  );
  const regions = renderer!.root.findAllByProps({ role: "region" });
  await act(() => regions[0]!.props.onFocus());
  expect(renderer!.root.findAllByType("output").map((node) => node.children)).toEqual([
    ["true:320x240"],
    ["false:600x400"],
  ]);
  await act(() =>
    useWorkbenchStore
      .getState()
      .closeView(getActiveTab(useWorkbenchStore.getState()).focusedPaneId),
  );
  expect(observers[0]!.disconnect).toHaveBeenCalled();
});

it("renders Welcome without Workspace navigation or a Workspace View", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const definition = createWelcomeViewDefinition();
  registerViewDefinition(definition);
  await act(() => {
    renderer = create(<Harness />);
  });
  expect(renderer!.root.findByType("h1").children).toEqual(["Welcome to ACode"]);
  expect(
    renderer!.root
      .findAllByType("button")
      .some((node) => node.children.join("").includes("ACode / Main")),
  ).toBe(false);
});

it("keeps View content mounted through layout switches, stacking and column movement", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let mounts = 0;
  function Content() {
    const [value, setValue] = useState("");
    useEffect(() => {
      mounts++;
    }, []);
    return <input value={value} onChange={(e) => setValue(e.target.value)} />;
  }
  registerViewDefinition({
    id: "workspace",
    label: "Workspace",
    accepts: (target): target is Extract<ViewTarget, { kind: "workspace" }> =>
      target.kind === "workspace",
    bind: emptyViewBinding,
    Component: Content,
  });
  const target = {
    kind: "workspace",
    environmentId: "local" as EnvironmentId,
    workspaceId: "one" as WorkspaceId,
  } as const;
  useWorkbenchStore.getState().openTarget(target);
  await act(() => {
    renderer = create(<Harness />);
  });
  await act(() =>
    renderer!.root.findByType("input").props.onChange({ target: { value: "unfinished draft" } }),
  );
  await act(() =>
    useWorkbenchStore
      .getState()
      .splitFocused({ ...target, workspaceId: "two" as WorkspaceId }, "down"),
  );
  await act(() => useWorkbenchStore.getState().setLayoutMode("scrolling"));
  const column = getActiveTab(useWorkbenchStore.getState()).columns![0]!;
  await act(() => useWorkbenchStore.getState().changeColumn(column.id, { direction: 1 }));
  await act(() => useWorkbenchStore.getState().setLayoutMode("bsp"));
  expect(mounts).toBe(2);
  expect(renderer!.root.findAllByType("input")[0]!.props.value).toBe("unfinished draft");
});

it("does not render extra column or stack headers in scrolling mode", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  registerViewDefinition({
    id: "workspace",
    label: "Workspace",
    accepts: (target): target is Extract<ViewTarget, { kind: "workspace" }> =>
      target.kind === "workspace",
    bind: emptyViewBinding,
    Component: () => <div>View Content</div>,
  });
  const target = {
    kind: "workspace",
    environmentId: "local" as EnvironmentId,
    workspaceId: "s1" as WorkspaceId,
  } as const;
  useWorkbenchStore.getState().openTarget(target);
  useWorkbenchStore.getState().splitFocused({ ...target, workspaceId: "s2" as WorkspaceId }, "down");
  useWorkbenchStore.getState().setLayoutMode("scrolling");

  await act(() => {
    renderer = create(<Harness />);
  });

  const textNodes = renderer!.root.findAll((node) => typeof node.children?.[0] === "string");
  const texts = textNodes.map((n) => n.children.join(""));
  expect(texts.some((t) => t.includes("Column 1") || t.includes("Stack"))).toBe(false);
});

it("applies pane gap, radius, and shadow CSS variables to the canvas", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  registerViewDefinition({
    id: "workspace",
    label: "Workspace",
    accepts: (target): target is Extract<ViewTarget, { kind: "workspace" }> =>
      target.kind === "workspace",
    bind: emptyViewBinding,
    Component: () => <div>Test</div>,
  });
  const target = {
    kind: "workspace",
    environmentId: "local" as EnvironmentId,
    workspaceId: "w1" as WorkspaceId,
  } as const;
  useWorkbenchStore.getState().openTarget(target);

  await act(() => {
    renderer = create(<Harness />);
  });

  const canvas = renderer!.root.findByProps({ className: "workbench-canvas" });
  expect(canvas.props.style["--pane-gap"]).toBe("0px");
  expect(canvas.props.style["--pane-radius"]).toBe("0px");
  expect(canvas.props.style["--pane-shadow"]).toBe("none");
});

it("prevents native focus scroll on PaneHeader mousedown unless clicking a button", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  registerViewDefinition({
    id: "workspace",
    label: "Workspace",
    accepts: (target): target is Extract<ViewTarget, { kind: "workspace" }> =>
      target.kind === "workspace",
    bind: emptyViewBinding,
    Component: () => <div>View</div>,
  });
  const target = {
    kind: "workspace",
    environmentId: "local" as EnvironmentId,
    workspaceId: "w1" as WorkspaceId,
  } as const;
  useWorkbenchStore.getState().openTarget(target);

  await act(() => {
    renderer = create(<Harness />);
  });

  const header = renderer!.root.findByProps({ role: "toolbar" });
  const preventDefault = vi.fn();

  header.props.onMouseDown({
    target: { closest: () => null },
    preventDefault,
  });
  expect(preventDefault).toHaveBeenCalled();

  const buttonPreventDefault = vi.fn();
  header.props.onMouseDown({
    target: { closest: (selector: string) => (selector === "button" ? {} : null) },
    preventDefault: buttonPreventDefault,
  });
  expect(buttonPreventDefault).not.toHaveBeenCalled();
});

it("focuses the pane via onMouseDownCapture on the pane frame", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  registerViewDefinition({
    id: "workspace",
    label: "Workspace",
    accepts: (target): target is Extract<ViewTarget, { kind: "workspace" }> =>
      target.kind === "workspace",
    bind: emptyViewBinding,
    Component: () => <div>View</div>,
  });
  const first = {
    kind: "workspace",
    environmentId: "local" as EnvironmentId,
    workspaceId: "w1" as WorkspaceId,
  } as const;
  useWorkbenchStore.getState().openTarget(first);
  useWorkbenchStore.getState().splitFocused({ ...first, workspaceId: "w2" as WorkspaceId }, "right");

  await act(() => {
    renderer = create(<Harness />);
  });

  const state = useWorkbenchStore.getState();
  const activeTab = getActiveTab(state);
  const paneIds = [...activeTab.panes.keys()];
  const unfocusedPaneId = paneIds.find((id) => id !== activeTab.focusedPaneId)!;

  const frames = renderer!.root.findAllByProps({ className: "workbench-pane-frame" });
  expect(frames.length).toBe(2);

  // Trigger onMouseDownCapture on the unfocused frame
  const unfocusedFrame = frames.find((f) => f.props.children.props.children.props.paneId === unfocusedPaneId)!;
  await act(() => unfocusedFrame.props.onMouseDownCapture());

  expect(getActiveTab(useWorkbenchStore.getState()).focusedPaneId).toBe(unfocusedPaneId);
});

it("clears viewFocused on the blurred pane immediately during scrolling animation so it cannot steal focus back", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const focusLog: { paneId: string; focused: boolean }[] = [];
  registerViewDefinition({
    id: "workspace",
    label: "Workspace",
    accepts: (target): target is Extract<ViewTarget, { kind: "workspace" }> =>
      target.kind === "workspace",
    bind: emptyViewBinding,
    Component: ({ paneId, focused }) => {
      focusLog.push({ paneId, focused });
      return <output data-pane-output={paneId}>{String(focused)}</output>;
    },
  });

  const first = {
    kind: "workspace",
    environmentId: "local" as EnvironmentId,
    workspaceId: "w1" as WorkspaceId,
  } as const;
  useWorkbenchStore.getState().openTarget(first);
  const firstId = getActiveTab(useWorkbenchStore.getState()).focusedPaneId;
  useWorkbenchStore.getState().splitFocused({ ...first, workspaceId: "w2" as WorkspaceId }, "right");
  const secondId = getActiveTab(useWorkbenchStore.getState()).focusedPaneId;
  useWorkbenchStore.getState().setLayoutMode("scrolling");

  await act(() => {
    renderer = create(<Harness />);
  });

  // Second pane is initially focused
  expect(getActiveTab(useWorkbenchStore.getState()).focusedPaneId).toBe(secondId);

  // Now focus first pane
  await act(() => {
    useWorkbenchStore.getState().setFocused(firstId);
  });

  // Verify that the second pane does NOT retain viewFocused = true
  const outputs = renderer!.root.findAllByType("output");
  const secondOutput = outputs.find((o) => o.props["data-pane-output"] === secondId);
  expect(secondOutput?.children[0]).toBe("false");
});

it("blurs activeElement of another pane on activation and prevents focus bounce", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  registerViewDefinition({
    id: "workspace",
    label: "Workspace",
    accepts: (target): target is Extract<ViewTarget, { kind: "workspace" }> =>
      target.kind === "workspace",
    bind: emptyViewBinding,
    Component: ({ paneId }) => <div data-view-pane={paneId}>Content</div>,
  });

  const first = {
    kind: "workspace",
    environmentId: "local" as EnvironmentId,
    workspaceId: "w1" as WorkspaceId,
  } as const;
  useWorkbenchStore.getState().openTarget(first);
  const firstId = getActiveTab(useWorkbenchStore.getState()).focusedPaneId;
  useWorkbenchStore.getState().splitFocused({ ...first, workspaceId: "w2" as WorkspaceId }, "right");
  const secondId = getActiveTab(useWorkbenchStore.getState()).focusedPaneId;

  await act(() => {
    renderer = create(<Harness />);
  });

  expect(getActiveTab(useWorkbenchStore.getState()).focusedPaneId).toBe(secondId);

  const blurredActiveMock = {
    blur: vi.fn(),
    closest: (selector: string) => {
      if (selector === ".workbench-pane") return { dataset: { paneId: secondId } };
      return null;
    },
  };
  vi.stubGlobal("document", { activeElement: blurredActiveMock });
  vi.stubGlobal("window", { getSelection: () => ({ removeAllRanges: vi.fn() }) });

  const frames = renderer!.root.findAllByProps({ className: "workbench-pane-frame" });
  const firstFrame = frames.find((f) => f.props.children.props.children.props.paneId === firstId)!;

  await act(() => firstFrame.props.onMouseDownCapture({ target: null, currentTarget: null }));

  expect(blurredActiveMock.blur).toHaveBeenCalled();
  expect(getActiveTab(useWorkbenchStore.getState()).focusedPaneId).toBe(firstId);
});

it("supports bidirectional focus switching between panes without focus bounce", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  registerViewDefinition({
    id: "workspace",
    label: "Workspace",
    accepts: (target): target is Extract<ViewTarget, { kind: "workspace" }> =>
      target.kind === "workspace",
    bind: emptyViewBinding,
    Component: ({ paneId, focused }) => (
      <div data-pane={paneId} data-focused={String(focused)}>
        Pane {paneId}
      </div>
    ),
  });

  const first = {
    kind: "workspace",
    environmentId: "local" as EnvironmentId,
    workspaceId: "w1" as WorkspaceId,
  } as const;
  useWorkbenchStore.getState().openTarget(first);
  const firstId = getActiveTab(useWorkbenchStore.getState()).focusedPaneId;
  useWorkbenchStore.getState().splitFocused({ ...first, workspaceId: "w2" as WorkspaceId }, "right");
  const secondId = getActiveTab(useWorkbenchStore.getState()).focusedPaneId;

  await act(() => {
    renderer = create(<Harness />);
  });

  const frames = renderer!.root.findAllByProps({ className: "workbench-pane-frame" });
  const firstFrame = frames.find((f) => f.props.children.props.children.props.paneId === firstId)!;
  const secondFrame = frames.find((f) => f.props.children.props.children.props.paneId === secondId)!;

  // Switch right -> left
  await act(() => firstFrame.props.onMouseDownCapture({ target: null, currentTarget: null }));
  expect(getActiveTab(useWorkbenchStore.getState()).focusedPaneId).toBe(firstId);

  // Switch left -> right
  await act(() => secondFrame.props.onMouseDownCapture({ target: null, currentTarget: null }));
  expect(getActiveTab(useWorkbenchStore.getState()).focusedPaneId).toBe(secondId);

  // Switch right -> left again
  await act(() => firstFrame.props.onMouseDownCapture({ target: null, currentTarget: null }));
  expect(getActiveTab(useWorkbenchStore.getState()).focusedPaneId).toBe(firstId);
});
