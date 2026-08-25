import { format } from "date-fns";
import { RangePresetSelect } from "./RangePresets";

interface PeriodSelectorProps {
  startDate: Date;
  endDate: Date;
  onPrevious: () => void;
  onNext: () => void;
  onThisWeek: () => void;
  // I8: quick range presets (Today, Yesterday, This Week, ...)
  onRange?: (start: Date, end: Date) => void;
}

export function PeriodSelector({
  startDate,
  endDate,
  onPrevious,
  onNext,
  onThisWeek,
  onRange,
}: PeriodSelectorProps) {
  const periodLabel = `${format(startDate, "MMM d")} - ${format(endDate, "MMM d, yyyy")}`;
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onPrevious}
        className="p-2 hover:bg-slate-100 rounded"
        aria-label="Previous period"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <div className="text-sm font-medium text-slate-900 min-w-[180px] text-center">
        {periodLabel}
      </div>
      <button
        onClick={onNext}
        className="p-2 hover:bg-slate-100 rounded"
        aria-label="Next period"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <button
        onClick={onThisWeek}
        className="px-3 py-1 text-sm border border-slate-300 rounded hover:bg-slate-50"
      >
        This week
      </button>
      {onRange && (
        <RangePresetSelect start={startDate} end={endDate} onSelect={onRange} />
      )}
    </div>
  );
}
