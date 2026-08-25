import { useMemo } from "react";
import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  isSameDay,
  subDays,
  subMonths,
  subYears,
} from "date-fns";
import { useWorkspace, weekStartsOn } from "../../lib/workspace";

// I8: shared date-range presets for the Dashboard and Reports period filters
export type RangePreset = {
  id: string;
  label: string;
  range: () => { start: Date; end: Date };
};

type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Presets are built against the workspace's configured first day of the week,
 * so "This Week" here spans the same days the Dashboard/Reports range state
 * uses. With a hardcoded week start the two never line up and the filter can
 * never recognise its own selection.
 */
export function rangePresets(startsOn: WeekStart): RangePreset[] {
  const wk = { weekStartsOn: startsOn };
  return [
    { id: "today", label: "Today", range: () => ({ start: new Date(), end: new Date() }) },
    {
      id: "yesterday",
      label: "Yesterday",
      range: () => ({ start: subDays(new Date(), 1), end: subDays(new Date(), 1) }),
    },
    {
      id: "this_week",
      label: "This Week",
      range: () => ({ start: startOfWeek(new Date(), wk), end: endOfWeek(new Date(), wk) }),
    },
    {
      id: "last_week",
      label: "Last Week",
      range: () => ({
        start: startOfWeek(subDays(new Date(), 7), wk),
        end: endOfWeek(subDays(new Date(), 7), wk),
      }),
    },
    {
      id: "past_two_weeks",
      label: "Past Two Weeks",
      range: () => ({
        start: startOfWeek(subDays(new Date(), 7), wk),
        end: endOfWeek(new Date(), wk),
      }),
    },
    {
      id: "this_month",
      label: "This Month",
      range: () => ({ start: startOfMonth(new Date()), end: endOfMonth(new Date()) }),
    },
    {
      id: "last_month",
      label: "Last Month",
      range: () => ({
        start: startOfMonth(subMonths(new Date(), 1)),
        end: endOfMonth(subMonths(new Date(), 1)),
      }),
    },
    {
      id: "this_year",
      label: "This Year",
      range: () => ({ start: startOfYear(new Date()), end: endOfYear(new Date()) }),
    },
    {
      id: "last_year",
      label: "Last Year",
      range: () => ({
        start: startOfYear(subYears(new Date(), 1)),
        end: endOfYear(subYears(new Date(), 1)),
      }),
    },
  ];
}

/** The preset matching the selected range, or null when it is a custom range. */
export function matchPreset(
  presets: RangePreset[],
  start?: Date,
  end?: Date
): RangePreset | null {
  if (!start || !end) return null;
  return (
    presets.find((p) => {
      const r = p.range();
      return isSameDay(r.start, start) && isSameDay(r.end, end);
    }) ?? null
  );
}

export function RangePresetSelect({
  start,
  end,
  onSelect,
}: {
  /** Currently selected range, so the filter names what is actually on screen */
  start?: Date;
  end?: Date;
  onSelect: (start: Date, end: Date) => void;
}) {
  const ws = useWorkspace();
  const presets = useMemo(() => rangePresets(weekStartsOn(ws)), [ws]);
  const active = useMemo(() => matchPreset(presets, start, end), [presets, start, end]);
  const hasRange = !!start && !!end;

  return (
    <select
      value={active ? active.id : hasRange ? "custom" : ""}
      onChange={(e) => {
        const preset = presets.find((p) => p.id === e.target.value);
        if (preset) {
          const { start: s, end: en } = preset.range();
          onSelect(s, en);
        }
      }}
      className="px-3 py-2 border border-slate-300 rounded text-sm bg-white hover:bg-slate-50"
      aria-label="Date range presets"
    >
      {!hasRange && (
        <option value="" disabled>
          Date range…
        </option>
      )}
      {/* Reached by using the arrows or picking a range no preset describes */}
      {hasRange && !active && (
        <option value="custom" disabled>
          Custom range
        </option>
      )}
      {presets.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}
        </option>
      ))}
    </select>
  );
}
