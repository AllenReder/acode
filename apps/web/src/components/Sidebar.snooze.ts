import type { TimestampFormat } from "@awen/contracts/settings";
import {
  resolveSnoozePresets as resolveSharedSnoozePresets,
  snoozeWakeLabel,
  type SnoozePreset,
} from "@awen/client-runtime/state/thread-settled";

import {
  formatShortMonthDay,
  formatShortTimestamp,
  formatShortWeekday,
  parseTimestampDate,
} from "../timestampFormat";

export { snoozeWakeLabel, type SnoozePreset };

const DAY_MS = 24 * 60 * 60 * 1_000;

// `locale` threads a test-seam locale through to the formatter; every label
// part (time, weekday, month/day) resolves through it, so a single label never
// formats its time and its weekday in different locales. Omitting it keeps the
// production behavior: the host-reported locale when there is one, otherwise
// the runtime default.
function timeOfDayLabel(
  date: Date,
  timestampFormat: TimestampFormat,
  locale: string | undefined,
): string {
  return formatShortTimestamp(date.toISOString(), timestampFormat, locale);
}

export function resolveSnoozePresets(
  now: Date,
  timestampFormat: TimestampFormat,
  locale?: string,
): ReadonlyArray<SnoozePreset> {
  return resolveSharedSnoozePresets(now).map((preset) => {
    const wake = parseTimestampDate(preset.snoozedUntil);
    if (wake === null) return preset;
    const time = timeOfDayLabel(wake, timestampFormat, locale);
    return {
      ...preset,
      whenLabel: preset.id === "next-week" ? `${formatShortWeekday(wake, locale)} ${time}` : time,
    };
  });
}

/**
 * Human wake time for menus and toasts: "tomorrow 9:00", "Mon 9:00",
 * "17:30" (today).
 */
export function snoozeWakeDescription(
  snoozedUntil: string,
  now: Date,
  timestampFormat: TimestampFormat,
  locale?: string,
): string {
  const wake = parseTimestampDate(snoozedUntil);
  if (wake === null) return "";
  const time = timeOfDayLabel(wake, timestampFormat, locale);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dayDelta = Math.floor((wake.getTime() - startOfToday.getTime()) / DAY_MS);
  if (dayDelta === 0) return time;
  if (dayDelta === 1) return `tomorrow ${time}`;
  const weekday = formatShortWeekday(wake, locale);
  if (dayDelta < 7) return `${weekday} ${time}`;
  const date = formatShortMonthDay(wake, locale);
  return `${date}, ${time}`;
}
