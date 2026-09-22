import { isMacPlatform } from "../lib/utils";
import { useSidebarVisibility } from "../components/ui/sidebar";
import {
  COLLAPSED_TABS_INSET_MAC,
  COLLAPSED_TABS_INSET_WIN,
  EXPANDED_TABS_INSET,
  SEPARATOR_RIGHT_GAP,
} from "../components/sidebar/sidebarGeometry";

/** Shared window-control reservation for Tabs and Settings navigation. */
export function TopbarInset() {
  const isSidebarOpen = useSidebarVisibility();
  const isMac = typeof navigator !== "undefined" && isMacPlatform(navigator.platform);
  const tabsInsetWidth = isSidebarOpen
    ? EXPANDED_TABS_INSET
    : isMac
      ? COLLAPSED_TABS_INSET_MAC
      : COLLAPSED_TABS_INSET_WIN;
  return (
    <div
      className="flex shrink-0 items-center overflow-hidden transition-[width] duration-200 ease-out [-webkit-app-region:no-drag]"
      data-slot="workbench-tabs-inset-spacer"
      style={{
        width: `${tabsInsetWidth}px`,
      }}
    >
      {!isSidebarOpen ? (
        <div
          className="flex h-full w-full items-center justify-end transition-opacity duration-200 ease-out"
          style={{ paddingRight: `${SEPARATOR_RIGHT_GAP}px` }}
        >
          <div
            className="h-3.5 w-px bg-border/60 shrink-0"
            data-slot="workbench-titlebar-separator"
          />
        </div>
      ) : null}
    </div>
  );
}
