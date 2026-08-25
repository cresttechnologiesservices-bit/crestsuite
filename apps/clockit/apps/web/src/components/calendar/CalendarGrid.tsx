import { format, addDays, isToday, isWeekend } from "date-fns";
import { TimeEntryBlock, ExternalEventBlock, layoutDayEntries } from "./TimeEntryBlock";

interface CalendarGridProps {
  currentDate: Date;
  entries: any[];
  externalEvents: any[];
  dailyTotals: Record<string, string>;
  hourHeight: number;
  onSlotClick: (date: Date, hour: number) => void;
  onEntryClick: (entry: any) => void;
  onEntryDrag: (entryId: string, newStart: Date, newEnd: Date) => void;
  onEntryResize: (entryId: string, newStart: Date, newEnd: Date) => void;
  showWorkingDaysOnly: boolean;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function CalendarGrid({
  currentDate,
  entries,
  externalEvents,
  dailyTotals,
  hourHeight,
  onSlotClick,
  onEntryClick,
  onEntryDrag,
  onEntryResize,
  showWorkingDaysOnly,
}: CalendarGridProps) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(currentDate, i));
  // REQ-CAL-F31/F37: hide non-working days when preference enabled
  const visibleDays = showWorkingDaysOnly
    ? days.filter((day) => !isWeekend(day))
    : days;

  const forDay = (items: any[], date: Date) => {
    const dateStr = format(date, "yyyy-MM-dd");
    return items.filter(
      (item) => format(new Date(item.start), "yyyy-MM-dd") === dateStr
    );
  };

  return (
    <div className="flex overflow-auto max-h-[calc(100vh-300px)]">
      {/* Time Axis (REQ-CAL-F06) */}
      <div className="flex-shrink-0 w-16 border-r bg-slate-50">
        <div className="h-16 border-b sticky top-0 bg-slate-50 z-10"></div>
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="border-b text-xs text-slate-500 text-right pr-2 pt-1"
            style={{ height: `${hourHeight}px` }}
          >
            {String(hour).padStart(2, "0")}:00
          </div>
        ))}
      </div>

      {/* Days Grid (REQ-CAL-F04) */}
      <div className="flex-1 flex">
        {visibleDays.map((day) => {
          const dateStr = format(day, "yyyy-MM-dd");
          const dayEntries = layoutDayEntries(forDay(entries, day));
          const dayExternal = forDay(externalEvents, day);
          const isCurrentDay = isToday(day);
          const isWeekendDay = isWeekend(day);

          return (
            <div
              key={dateStr}
              className={`flex-1 border-r last:border-r-0 min-w-0 ${
                isWeekendDay ? "bg-slate-50" : ""
              }`}
            >
              {/* Day Header (REQ-CAL-F05: highlight today) */}
              <div
                className={`h-16 border-b flex flex-col items-center justify-center sticky top-0 z-10 ${
                  isCurrentDay ? "bg-indigo-50" : "bg-white"
                }`}
              >
                <div className={`text-sm font-medium ${isCurrentDay ? "text-indigo-600" : "text-slate-700"}`}>
                  {format(day, "EEE")}
                </div>
                <div className={`text-xs ${isCurrentDay ? "text-indigo-600 font-semibold" : "text-slate-500"}`}>
                  {format(day, "MMM d")}
                </div>
                <div className="text-xs font-semibold text-slate-900 mt-1">
                  {dailyTotals[dateStr] || "0:00"}
                </div>
              </div>

              {/* Time Slots */}
              <div className="relative">
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="border-b border-slate-200 hover:bg-indigo-50 cursor-pointer"
                    style={{ height: `${hourHeight}px` }}
                    onClick={() => onSlotClick(day, hour)}
                  ></div>
                ))}

                {/* External calendar events, read-only (REQ-CAL-B15) */}
                {dayExternal.map((event) => (
                  <ExternalEventBlock key={event.id} event={event} hourHeight={hourHeight} />
                ))}

                {/* Entry Blocks (REQ-CAL-F08/F10) */}
                {dayEntries.map((entry) => (
                  <TimeEntryBlock
                    key={entry.id}
                    entry={entry}
                    hourHeight={hourHeight}
                    column={entry.column}
                    totalColumns={entry.totalColumns}
                    onClick={() => onEntryClick(entry)}
                    onDrag={(newStart, newEnd) => onEntryDrag(entry.id, newStart, newEnd)}
                    onResize={(newStart, newEnd) => onEntryResize(entry.id, newStart, newEnd)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
