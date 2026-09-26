import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { resolveSnoozePresets, snoozeWakeDescription } from "./Sidebar.snooze";

// The formatting locale is pinned explicitly so the English assertions hold on
// any machine, regardless of its runtime default locale (#137).
const TEST_LOCALE = "en-US";

// Local-time constructor so preset math is timezone-stable in tests.
function localDate(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

describe("resolveSnoozePresets", () => {
  it("offers one hour, three hours, evening, tomorrow, and next week in the morning", () => {
    // Wednesday 2026-04-08 10:00 local.
    const presets = resolveSnoozePresets(localDate(2026, 4, 8, 10), "locale", TEST_LOCALE);
    expect(presets.map((preset) => preset.id)).toEqual([
      "hour",
      "three-hours",
      "evening",
      "tomorrow",
      "next-week",
    ]);
    const threeHours = presets.find((preset) => preset.id === "three-hours");
    expect(new Date(threeHours!.snoozedUntil).getHours()).toBe(13);
    const evening = presets.find((preset) => preset.id === "evening");
    expect(new Date(evening!.snoozedUntil).getHours()).toBe(18);
    const tomorrow = presets.find((preset) => preset.id === "tomorrow");
    const tomorrowDate = new Date(tomorrow!.snoozedUntil);
    expect(tomorrowDate.getDate()).toBe(9);
    expect(tomorrowDate.getHours()).toBe(9);
    const nextWeek = presets.find((preset) => preset.id === "next-week");
    const nextWeekDate = new Date(nextWeek!.snoozedUntil);
    expect(nextWeekDate.getDay()).toBe(1);
    expect(nextWeekDate.getDate()).toBe(13);
  });

  it("whenLabel complements the label instead of repeating it", () => {
    const presets = resolveSnoozePresets(localDate(2026, 4, 8, 10), "locale", TEST_LOCALE);
    for (const preset of presets) {
      // Day words live in the label column; the time column is time-only
      // (plus a weekday for next week, which names a different day).
      expect(preset.whenLabel.toLowerCase()).not.toContain("tomorrow");
    }
    const tomorrow = presets.find((preset) => preset.id === "tomorrow");
    expect(tomorrow!.whenLabel).toMatch(/9/);
    const nextWeek = presets.find((preset) => preset.id === "next-week");
    expect(nextWeek!.whenLabel).toMatch(/Mon/);
  });

  it("drops the evening preset once evening is near or past", () => {
    expect(
      resolveSnoozePresets(localDate(2026, 4, 8, 17, 30), "locale", TEST_LOCALE).map(
        (preset) => preset.id,
      ),
    ).toEqual(["hour", "three-hours", "tomorrow", "next-week"]);
    expect(
      resolveSnoozePresets(localDate(2026, 4, 8, 21), "locale", TEST_LOCALE).map(
        (preset) => preset.id,
      ),
    ).toEqual(["hour", "three-hours", "tomorrow", "next-week"]);
  });

  it("puts next week a full week out when today is Monday", () => {
    // Monday 2026-04-06.
    const presets = resolveSnoozePresets(localDate(2026, 4, 6, 10), "locale", TEST_LOCALE);
    const nextWeek = new Date(presets.find((preset) => preset.id === "next-week")!.snoozedUntil);
    expect(nextWeek.getDay()).toBe(1);
    expect(nextWeek.getDate()).toBe(13);
  });
  it("formats preset times with the selected clock preference", () => {
    const twelveHour = resolveSnoozePresets(localDate(2026, 4, 8, 10), "12-hour", TEST_LOCALE);
    const twentyFourHour = resolveSnoozePresets(localDate(2026, 4, 8, 10), "24-hour", TEST_LOCALE);

    expect(twelveHour.find((preset) => preset.id === "evening")!.whenLabel).toMatch(/PM/i);
    expect(twentyFourHour.find((preset) => preset.id === "evening")!.whenLabel).toBe("18:00");
  });

  it("formats the weekday in the injected locale, not the runtime default", () => {
    const english = resolveSnoozePresets(localDate(2026, 4, 8, 10), "locale", "en-US").find(
      (preset) => preset.id === "next-week",
    )!;
    const chinese = resolveSnoozePresets(localDate(2026, 4, 8, 10), "locale", "zh-CN").find(
      (preset) => preset.id === "next-week",
    )!;
    // Each locale is pinned positively, so ignoring the injected locale and
    // falling back to the runtime default fails one of the two legs whichever
    // default the machine has.
    expect(english.whenLabel).toMatch(/Mon/);
    expect(chinese.whenLabel).toMatch(/周一/);
  });
});

describe("snoozeWakeDescription", () => {
  const now = localDate(2026, 4, 8, 10);

  it("uses bare time today, 'tomorrow' next day, weekday within the week", () => {
    expect(
      snoozeWakeDescription(localDate(2026, 4, 8, 18).toISOString(), now, "locale", TEST_LOCALE),
    ).not.toContain("tomorrow");
    expect(
      snoozeWakeDescription(localDate(2026, 4, 9, 9).toISOString(), now, "locale", TEST_LOCALE),
    ).toContain("tomorrow");
    expect(
      snoozeWakeDescription(localDate(2026, 4, 13, 9).toISOString(), now, "locale", TEST_LOCALE),
    ).toMatch(/Mon/);
  });

  it("formats wake descriptions with the selected clock preference", () => {
    expect(
      snoozeWakeDescription(localDate(2026, 4, 8, 18).toISOString(), now, "12-hour", TEST_LOCALE),
    ).toMatch(/PM/i);
    expect(
      snoozeWakeDescription(localDate(2026, 4, 8, 18).toISOString(), now, "24-hour", TEST_LOCALE),
    ).toBe("18:00");
  });

  it("formats dates more than a week out in the injected locale", () => {
    // 2026-04-20 is twelve days after the 8th, past the weekday window.
    expect(
      snoozeWakeDescription(localDate(2026, 4, 20, 9).toISOString(), now, "24-hour", TEST_LOCALE),
    ).toBe("Apr 20, 09:00");
  });

  it("formats weekday and time in the injected locale, not the runtime default", () => {
    const english = snoozeWakeDescription(
      localDate(2026, 4, 13, 9).toISOString(),
      now,
      "locale",
      "en-US",
    );
    const chinese = snoozeWakeDescription(
      localDate(2026, 4, 13, 9).toISOString(),
      now,
      "locale",
      "zh-CN",
    );
    expect(english).toMatch(/Mon/);
    expect(chinese).toMatch(/周一/);
  });
});

describe("default locale resolution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("uses the host-reported locale when no locale is passed", async () => {
    vi.stubGlobal("window", { desktopBridge: { getSystemLocale: () => "en-US" } });
    vi.resetModules();
    const { resolveSnoozePresets: withHostLocale, snoozeWakeDescription: wakeWithHostLocale } =
      await import("./Sidebar.snooze");
    const now = localDate(2026, 4, 8, 10);

    expect(
      withHostLocale(now, "locale").find((preset) => preset.id === "next-week")!.whenLabel,
    ).toMatch(/Mon/);
    expect(wakeWithHostLocale(localDate(2026, 4, 13, 9).toISOString(), now, "locale")).toMatch(
      /Mon/,
    );
  });
});
