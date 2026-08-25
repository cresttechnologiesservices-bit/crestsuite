import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, differenceInCalendarDays, format, startOfWeek } from "date-fns";
import { useWorkspace, weekStartsOn } from "../../lib/workspace";

interface WeekNavProps {
  /** Selected date range, e.g. "Aug 3 - Aug 9, 2026" */
  label: string;
  /** First day of the selected range — used to name the selection */
  periodStart: Date;
  /** Last day of the selected range (defaults to a 7-day week from the start) */
  periodEnd?: Date;
  /** "week" navigates whole weeks; "day" (calendar day view) navigates days */
  unit?: "week" | "day";
  onPrevious: () => void;
  onNext: () => void;
  /** Week picker entries (e.g. This Week / Last Week / Next Week) */
  options: { label: string; onSelect: () => void }[];
  /**
   * Overrides the name shown on the picker button. Pages that offer month/year
   * presets pass the matching preset name, which describes the selection better
   * than the relative week wording periodLabel falls back to.
   */
  selectionLabel?: string;
  /**
   * Lets the picker jump straight to an arbitrary period instead of stepping
   * week by week. "range" collects a start and end date; "week" collects one
   * date and moves to the week containing it.
   */
  jump?:
    | { kind: "range"; onApply: (start: Date, end: Date) => void }
    | { kind: "week"; onApply: (date: Date) => void };
}

const toInput = (d: Date) => format(d, "yyyy-MM-dd");
/** Parse a date input as local midnight, so it is not shifted by the timezone */
const fromInput = (v: string) => {
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/**
 * Name the selected period relative to today, so the picker always says what
 * is actually on screen ("Last Week", "3 weeks ago", "Next Week") instead of
 * a fixed "This Week". Ranges that are not a whole aligned week — e.g. a month
 * preset on the Dashboard — are reported as a custom range.
 */
export function periodLabel(
  periodStart: Date,
  periodEnd: Date | undefined,
  unit: "week" | "day",
  startsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1
) {
  const today = new Date();
  if (unit === "day") {
    const days = differenceInCalendarDays(periodStart, today);
    if (days === 0) return "Today";
    if (days === -1) return "Yesterday";
    if (days === 1) return "Tomorrow";
    return days < 0 ? `${-days} days ago` : `In ${days} days`;
  }

  const end = periodEnd ?? addDays(periodStart, 6);
  const alignedStart = startOfWeek(periodStart, { weekStartsOn: startsOn });
  const isWholeWeek =
    differenceInCalendarDays(periodStart, alignedStart) === 0 &&
    differenceInCalendarDays(end, periodStart) === 6;
  if (!isWholeWeek) return "Custom range";

  const weeks = Math.round(
    differenceInCalendarDays(alignedStart, startOfWeek(today, { weekStartsOn: startsOn })) / 7
  );
  if (weeks === 0) return "This Week";
  if (weeks === -1) return "Last Week";
  if (weeks === 1) return "Next Week";
  return weeks < 0 ? `${-weeks} weeks ago` : `In ${weeks} weeks`;
}

/**
 * Date-range control shown in the top-right corner of the Timesheet,
 * Dashboard, Calendar and Reports tabs: the selected range with Previous/Next
 * arrows, plus a picker whose button names the period currently selected.
 */
export function WeekNav({
  label,
  periodStart,
  periodEnd,
  unit = "week",
  onPrevious,
  onNext,
  options,
  selectionLabel,
  jump,
}: WeekNavProps) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [jumpError, setJumpError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const ws = useWorkspace();
  const startsOn = weekStartsOn(ws);
  const selection = useMemo(
    () => selectionLabel ?? periodLabel(periodStart, periodEnd, unit, startsOn),
    [selectionLabel, periodStart, periodEnd, unit, startsOn]
  );

  // Seed the custom-range inputs from what is on screen each time it opens
  useEffect(() => {
    if (!open) return;
    setJumpError(null);
    setFrom(toInput(periodStart));
    setTo(toInput(periodEnd ?? addDays(periodStart, 6)));
  }, [open, periodStart, periodEnd]);

  function applyJump() {
    if (!jump) return;
    if (jump.kind === "week") {
      if (!from) return setJumpError("Pick a date");
      jump.onApply(fromInput(from));
    } else {
      if (!from || !to) return setJumpError("Pick both dates");
      const start = fromInput(from);
      const end = fromInput(to);
      if (end < start) return setJumpError("End date is before the start date");
      jump.onApply(start, end);
    }
    setOpen(false);
  }

  return (
    <div className="flex items-center gap-2 justify-end">
      <button onClick={onPrevious} className="p-2 hover:bg-slate-100 rounded" aria-label="Previous">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <div className="text-sm font-semibold text-slate-900 whitespace-nowrap">{label}</div>
      <button onClick={onNext} className="p-2 hover:bg-slate-100 rounded" aria-label="Next">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((v) => !v)}
          title={`Showing ${selection} — choose another period`}
          className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50 flex items-center gap-1 min-w-[112px] justify-between"
        >
          <span className="truncate">{selection}</span>
          <svg
            className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {open && (
          <div
            className={`absolute right-0 top-full mt-1 z-30 bg-white border rounded shadow-lg py-1 text-sm ${
              jump ? "w-60" : "w-40"
            }`}
          >
            <div className="max-h-64 overflow-y-auto">
            {options.map((o) => {
              const active = o.label === selection;
              return (
                <button
                  key={o.label}
                  onClick={() => {
                    setOpen(false);
                    o.onSelect();
                  }}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-slate-50 ${
                    active ? "text-indigo-600 font-medium" : ""
                  }`}
                >
                  {o.label}
                  {active && <span aria-hidden>✓</span>}
                </button>
              );
            })}
            </div>
            {/* Jump straight to any week or range instead of stepping week by week */}
            {jump && (
              <div className="border-t mt-1 pt-2 px-3 pb-2">
                <div className="text-xs font-medium text-slate-500 mb-1.5">
                  {jump.kind === "week" ? "Go to week of" : "Custom range"}
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => {
                      setFrom(e.target.value);
                      setJumpError(null);
                    }}
                    aria-label={jump.kind === "week" ? "Week of" : "Start date"}
                    className="border rounded px-1.5 py-1 text-xs flex-1 min-w-0"
                  />
                  {jump.kind === "range" && (
                    <>
                      <span className="text-slate-400 text-xs">–</span>
                      <input
                        type="date"
                        value={to}
                        onChange={(e) => {
                          setTo(e.target.value);
                          setJumpError(null);
                        }}
                        aria-label="End date"
                        className="border rounded px-1.5 py-1 text-xs flex-1 min-w-0"
                      />
                    </>
                  )}
                </div>
                {jumpError && <div className="text-xs text-red-600 mt-1">{jumpError}</div>}
                <button
                  onClick={applyJump}
                  className="mt-2 w-full px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium"
                >
                  Apply
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
