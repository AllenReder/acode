import type { EnvironmentAcodeProject } from "@t3tools/client-runtime/state/models";
import { Columns3Icon, PanelsTopLeftIcon, PlusIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "../lib/utils";
import { SidebarTrigger } from "../components/ui/sidebar";
import { firstLeafId } from "./layout";
import { targetKey, type ViewTarget } from "./viewRegistry";
import { tabDisplayTitle, type WorkbenchSnapshot, type WorkbenchTab } from "./workbenchState";
import { useWorkbenchStore } from "./workbenchStore";
import { resolveTargetContext, resolveTargetTitle } from "./workbenchTitles";

interface WorkbenchWindowChromeProps {
  readonly snapshot: WorkbenchSnapshot;
  readonly projects: ReadonlyArray<EnvironmentAcodeProject>;
}

const TAB_ACCENTS = ["#38bdf8", "#a78bfa", "#34d399", "#fb7185", "#fbbf24"] as const;

function accentForTarget(target: ViewTarget): string {
  const key = targetKey(target);
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return TAB_ACCENTS[Math.abs(hash) % TAB_ACCENTS.length] ?? TAB_ACCENTS[0];
}

/** The frameless Workbench title strip shared by native and browser shells. */
export function WorkbenchWindowChrome({ snapshot, projects }: WorkbenchWindowChromeProps) {
  const setLayoutMode = useWorkbenchStore((state) => state.setLayoutMode);
  const activeTab = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId)!;
  const createTab = useWorkbenchStore((state) => state.createTab);
  const activateTab = useWorkbenchStore((state) => state.activateTab);
  const closeTab = useWorkbenchStore((state) => state.closeTab);
  const renameTab = useWorkbenchStore((state) => state.renameTab);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.workbenchWindowChrome = "true";
    return () => {
      delete root.dataset.workbenchWindowChrome;
    };
  }, []);

  const titleFor = useMemo(
    () => (tab: WorkbenchTab) =>
      tabDisplayTitle(tab, (target) => resolveTargetTitle(target, projects)),
    [projects],
  );

  const commitRename = (tabId: string) => {
    renameTab(tabId, draftTitle);
    setEditingTabId(null);
    setDraftTitle("");
  };

  return (
    <header
      className="drag-region fixed inset-x-0 top-0 z-50 flex h-[var(--workbench-titlebar-height)] items-center border-b border-border/60 bg-background/95 backdrop-blur"
      data-tauri-drag-region
      data-workbench-window-chrome=""
    >
      <div
        className="flex shrink-0 items-center [-webkit-app-region:no-drag]"
        style={{
          paddingLeft: "var(--workspace-controls-left)",
          marginRight: "var(--workspace-titlebar-control-gap)",
        }}
      >
        <SidebarTrigger aria-label="Toggle sidebar" />
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2 pr-3 [-webkit-app-region:no-drag]">
        <div
          className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          data-tauri-drag-region
          data-workbench-tab-strip-drop=""
          role="tablist"
          aria-label="Workbench tabs"
        >
          {snapshot.tabs.map((tab) => {
            const active = tab.id === snapshot.activeTabId;
            const title = titleFor(tab);
            const target = tab.panes.get(firstLeafId(tab.layout))?.target ?? {
              kind: "welcome" as const,
            };
            const accent = accentForTarget(target);
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={active}
                aria-label={`Open ${title}`}
                tabIndex={active ? 0 : -1}
                data-tab-id={tab.id}
                data-workbench-tab-drop={tab.id}
                data-active-tab={active ? "true" : "false"}
                className={cn(
                  "group flex h-7 shrink-0 cursor-pointer items-center gap-2.5 overflow-hidden rounded-[var(--control-radius)] border transition-[width,background-color,border-color] duration-150",
                  active
                    ? "w-48 justify-start border-border/60 bg-background px-2.5 text-foreground shadow-xs"
                    : "w-32 justify-start border-transparent bg-transparent px-2.5 text-muted-foreground hover:bg-muted/50",
                )}
                onClick={() => {
                  if (!active) activateTab(tab.id);
                }}
                onDoubleClick={() => {
                  if (!active) return;
                  setEditingTabId(tab.id);
                  setDraftTitle(title);
                }}
                onKeyDown={(event) => {
                  const currentIndex = snapshot.tabs.findIndex(
                    (candidate) => candidate.id === tab.id,
                  );
                  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    const direction = event.key === "ArrowRight" ? 1 : -1;
                    const next =
                      snapshot.tabs[
                        (currentIndex + direction + snapshot.tabs.length) % snapshot.tabs.length
                      ];
                    if (next !== undefined) activateTab(next.id);
                  }
                  if (event.key === "F2" && active) {
                    event.preventDefault();
                    setEditingTabId(tab.id);
                    setDraftTitle(title);
                  }
                }}
              >
                <span className="size-2 shrink-0 rounded-full" style={{ background: accent }} />
                {active && editingTabId === tab.id ? (
                  <input
                    autoFocus
                    value={draftTitle}
                    aria-label="Tab title"
                    className="mx-1 min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onBlur={() => commitRename(tab.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitRename(tab.id);
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setEditingTabId(null);
                        setDraftTitle("");
                      }
                    }}
                  />
                ) : (
                  <div className={cn("min-w-0 flex-1", "block")}>
                    <div className="truncate text-xs font-medium leading-none">{title}</div>
                    <div className="truncate text-[9px] text-muted-foreground leading-none mt-0.5">
                      {resolveTargetContext(target, projects)}
                    </div>
                  </div>
                )}
                {active && snapshot.tabs.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`Close ${title}`}
                    className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-accent"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTab(tab.id);
                    }}
                  >
                    <XIcon className="size-3" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="workbench-layout-switch" role="group" aria-label="Tab layout">
          <button
            type="button"
            aria-label="BSP layout"
            aria-pressed={activeTab.layoutMode !== "scrolling"}
            onClick={() => setLayoutMode("bsp")}
          >
            <PanelsTopLeftIcon />
          </button>
          <button
            type="button"
            aria-label="Scrolling layout"
            aria-pressed={activeTab.layoutMode === "scrolling"}
            onClick={() => setLayoutMode("scrolling")}
          >
            <Columns3Icon />
          </button>
        </div>
        <button
          type="button"
          aria-label="New tab"
          data-workbench-new-tab-drop="end"
          className="flex size-7 shrink-0 items-center justify-center rounded-[var(--control-radius)] border border-border/70 bg-muted/25 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          onClick={createTab}
        >
          <PlusIcon className="size-4" />
        </button>
      </div>
    </header>
  );
}
