import { describe, expect, it } from "vite-plus/test";
import {
  THREAD_SIDEBAR_MIN_WIDTH,
  resolveInitialThreadSidebarWidth,
  resolveThreadSidebarMaximumWidth,
} from "./threadSidebarWidth";

describe("threadSidebarWidth", () => {
  it("resolves minimum sidebar width to 156px based on titlebar geometry", () => {
    expect(THREAD_SIDEBAR_MIN_WIDTH).toBe(156);
  });

  it("clamps initial width to minimum width", () => {
    const width = resolveInitialThreadSidebarWidth(100, 1200);
    expect(width).toBe(156);
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
