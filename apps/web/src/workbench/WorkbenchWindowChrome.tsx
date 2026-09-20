import type { EnvironmentAcodeProject } from "@t3tools/client-runtime/state/models";
import { PlusIcon, XIcon } from "lucide-react";
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
      className="drag-region fixed inset-x-0 top-0 z-50 h-[var(--workspace-topbar-height)] border-b border-border/60 bg-background/95 backdrop-blur"
      data-tauri-drag-region
      data-workbench-window-chrome=""
    >
      <div className="absolute top-1/2 left-[var(--workspace-controls-left)] -translate-y-1/2 [-webkit-app-region:no-drag]">
        <SidebarTrigger aria-label="Toggle sidebar" />
      </div>

      <div className="absolute inset-y-0 right-3 left-[var(--workspace-titlebar-content-left)] flex min-w-0 items-center gap-2 [-webkit-app-region:no-drag]">
        <div
          className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          data-tauri-drag-region
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
                title={title}
                data-tab-id={tab.id}
                data-active-tab={active ? "true" : "false"}
                className={cn(
                  "group flex h-9 shrink-0 cursor-pointer items-center overflow-hidden rounded-[var(--control-radius)] border transition-[width,background-color,border-color] duration-150",
                  active
                    ? "w-64 justify-start border-border bg-muted/70 px-3 text-foreground"
                    : "w-9 justify-center border-transparent bg-muted/25 text-muted-foreground hover:w-28 hover:justify-start hover:border-border/70 hover:bg-muted/50 hover:px-3",
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
                  <div
                    className={cn("min-w-0 flex-1", active ? "block" : "hidden group-hover:block")}
                  >
                    <div className="truncate text-xs font-medium">{title}</div>
                    <div className="truncate text-[9px] text-muted-foreground">
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

        <button
          type="button"
          aria-label="New tab"
          className="flex size-8 shrink-0 items-center justify-center rounded-[var(--control-radius)] border border-border/70 bg-muted/25 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          onClick={createTab}
        >
          <PlusIcon className="size-4" />
        </button>
      </div>
    </header>
  );
}
