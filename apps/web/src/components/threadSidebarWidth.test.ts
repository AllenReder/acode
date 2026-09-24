import { describe, expect, it } from "vite-plus/test";
import {
  THREAD_SIDEBAR_MIN_WIDTH,
  resolveInitialThreadSidebarWidth,
  resolveThreadSidebarMaximumWidth,
} from "./threadSidebarWidth";
import { isCurrentPlatformMac } from "../lib/utils";
import { resolveSidebarMinimumWidth } from "./sidebar/sidebarGeometry";

describe("threadSidebarWidth", () => {
  it("resolves minimum sidebar width dynamically based on titlebar geometry", () => {
    expect(THREAD_SIDEBAR_MIN_WIDTH).toBe(
      resolveSidebarMinimumWidth({ isMac: isCurrentPlatformMac() }),
    );
  });

  it("clamps initial width to minimum width", () => {
    const width = resolveInitialThreadSidebarWidth(10, 1200);
    expect(width).toBe(THREAD_SIDEBAR_MIN_WIDTH);
  });

  it("respects stored width when greater than minimum", () => {
    const width = resolveInitialThreadSidebarWidth(280, 1200);
    expect(width).toBe(280);
  });

  it("calculates maximum width honoring main content min width", () => {
    const maxWidth = resolveThreadSidebarMaximumWidth(1000);
    expect(maxWidth).toBe(1000 - 640);
  });
});
