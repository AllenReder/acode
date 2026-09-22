import type { EnvironmentAcodeProject } from "@t3tools/client-runtime/state/models";
import { Columns3Icon, PanelsTopLeftIcon, PlusIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "../lib/utils";
import { MaterialSurface } from "../components/MaterialSurface";
import { TopbarInset } from "./TopbarInset";
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
    <MaterialSurface
      kind="topbar"
      className="drag-region flex h-[var(--workbench-titlebar-height,36px)] w-full shrink-0 items-center border-b border-[var(--material-edge)] z-30"
      data-tauri-drag-region="deep"
      data-workbench-window-chrome=""
    >
      <TopbarInset />

      <div className="flex h-full min-w-0 flex-1 items-center gap-2 pr-3 [-webkit-app-region:no-drag]">
        <div
          className="flex h-full min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                  "group relative flex h-full w-44 min-w-28 shrink cursor-pointer items-center gap-2 border-r border-border/60 px-3 text-left transition-colors duration-150 select-none",
                  active
                    ? "bg-foreground/5 text-foreground font-medium"
                    : "bg-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
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
                    className="mx-1 min-w-0 flex-1 rounded border border-border bg-background/20 px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
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
                  <div className="min-w-0 flex-1 block">
                    <div className="truncate text-xs leading-none">{title}</div>
                    <div className="truncate text-[9px] text-muted-foreground leading-none mt-0.5">
                      {resolveTargetContext(target, projects)}
                    </div>
                  </div>
                )}
                {snapshot.tabs.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`Close ${title}`}
                    className="opacity-0 group-hover:opacity-100 flex size-5 shrink-0 items-center justify-center rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-opacity duration-150"
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

        <div
          className="workbench-layout-switch shrink-0"
          data-layout={activeTab.layoutMode ?? "bsp"}
          role="group"
          aria-label="Tab layout"
        >
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
    </MaterialSurface>
  );
}
