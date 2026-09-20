import { act } from "react";
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
