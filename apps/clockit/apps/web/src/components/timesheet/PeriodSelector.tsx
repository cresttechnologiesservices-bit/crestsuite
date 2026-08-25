import { format, addDays, subDays, startOfWeek } from "date-fns";
import { WeekNav } from "../common/WeekNav";
import { useWorkspace, weekStartsOn } from "../../lib/workspace";

interface PeriodSelectorProps {
  weekStart: Date;
  onWeekChange: (date: Date) => void;
}

// The selected week is displayed in the top-right corner with Previous/Next
// arrows and a picker that names the week currently on screen. The timesheet
// renders one column per weekday, so the picker jumps to a chosen week rather
// than accepting an arbitrary range the grid could not show.
export function PeriodSelector({ weekStart, onWeekChange }: PeriodSelectorProps) {
  const startsOn = weekStartsOn(useWorkspace());
  const weekEnd = addDays(weekStart, 6);
  const weekLabel = `${format(weekStart, "MMM d")} - ${format(weekEnd, "MMM d, yyyy")}`;
  const thisWeek = () => startOfWeek(new Date(), { weekStartsOn: startsOn });

  return (
    <div className="border-b px-6 py-4 flex items-center justify-end">
      <WeekNav
        label={weekLabel}
        periodStart={weekStart}
        periodEnd={weekEnd}
        onPrevious={() => onWeekChange(subDays(weekStart, 7))}
        onNext={() => onWeekChange(addDays(weekStart, 7))}
        options={[
          { label: "This Week", onSelect: () => onWeekChange(thisWeek()) },
          { label: "Last Week", onSelect: () => onWeekChange(subDays(thisWeek(), 7)) },
          { label: "Next Week", onSelect: () => onWeekChange(addDays(thisWeek(), 7)) },
          {
            label: "2 weeks ago",
            onSelect: () => onWeekChange(subDays(thisWeek(), 14)),
          },
          {
            label: "3 weeks ago",
            onSelect: () => onWeekChange(subDays(thisWeek(), 21)),
          },
          {
            label: "4 weeks ago",
            onSelect: () => onWeekChange(subDays(thisWeek(), 28)),
          },
        ]}
        jump={{
          kind: "week",
          // Any date in the target week selects that whole week
          onApply: (date) => onWeekChange(startOfWeek(date, { weekStartsOn: startsOn })),
        }}
      />
    </div>
  );
}
