import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it } from "vite-plus/test";

import { SidebarProvider } from "../components/ui/sidebar";
import { WorkbenchWindowChrome } from "./WorkbenchWindowChrome";
import { resetTabTransitionForTest } from "./tabTransition";
import { applyCreateTab, emptyWorkbenchSnapshot } from "./workbenchState";
import { resetWorkbenchStore } from "./workbenchStore";

beforeEach(() => {
  resetWorkbenchStore();
  resetTabTransitionForTest();
});

it("renders a shared theme underbar and drops bold from the active Tab", () => {
  let n = 0;
  const ids = () => `id-${++n}`;
  const snapshot = applyCreateTab(emptyWorkbenchSnapshot(ids), ids);

  const html = renderToStaticMarkup(
    <SidebarProvider defaultOpen>
      <WorkbenchWindowChrome snapshot={snapshot} projects={[]} />
    </SidebarProvider>,
  );

  expect(html).toContain("data-tab-indicator");
  expect(html).toContain("workbench-tab-indicator");
  expect(html).not.toContain("font-medium");
  expect(html).toContain('data-active-tab="true"');
});
