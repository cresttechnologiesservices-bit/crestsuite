import { format, addDays, isToday } from "date-fns";
import { useWorkspace, isWorkingDay, formatDuration } from "../../lib/workspace";
import { DurationInput } from "./DurationInput";

export const PHASES = [
  "Management",
  "Requirement",
  "Design",
  "Code",
  "Test",
  "Release",
  "Others",
] as const;

export interface TimesheetRow {
  projectId: string; // real id or "__none__" for tracker entries without a project
  taskId: string | null;
  projectName: string;
  projectColor: string;
  clientName: string | null;
  taskName: string | null;
  phase: string | null;
  description: string;
  entries: Record<string, string>; // date (yyyy-MM-dd) -> duration (H:MM)
  total: number; // total minutes
}

// Matches the server's row identity: two rows on the same project and task are
// distinct lines of work when their descriptions differ.
export function rowKey(row: Pick<TimesheetRow, "projectId" | "taskId"> & { description?: string }) {
  return `${row.projectId}::${row.taskId ?? ""}::${row.description ?? ""}`;
}

interface TimeOff {
  id: string;
  type: string;
  startDate: string;
  endDate: string;
}

interface TimesheetGridProps {
  rows: TimesheetRow[];
  totals: {
    dailyTotals: Record<string, string>;
    grandTotal: string;
  };
  timeOff: TimeOff[];
  weekStart: Date;
  onDurationChange: (row: TimesheetRow, date: string, duration: string) => void;
  onRowMetaChange: (row: TimesheetRow, meta: { phase?: string | null; description?: string }) => void;
  onRemoveRow: (row: TimesheetRow) => void;
  /** Projects (with their tasks) so a row's sub-task can be changed later */
  projects?: { id: string; tasks?: { id: string; name: string }[] }[];
  onRowTaskChange?: (row: TimesheetRow, taskId: string | null) => void;
  disabled: boolean;
}

export function TimesheetGrid({
  rows,
  totals,
  timeOff,
  weekStart,
  onDurationChange,
  onRowMetaChange,
  onRemoveRow,
  projects = [],
  onRowTaskChange,
  disabled,
}: TimesheetGridProps) {
  // Seven days from the workspace's configured week start
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const workspace = useWorkspace();
  // "Weekend" shading follows the configured Working days, not a fixed Sat/Sun
  const isWeekend = (day: Date) => !isWorkingDay(workspace, day);
  const capacityMinutes = Math.round(workspace.dailyWorkCapacity * 60);

  // REQ-TS-F08: approved time-off badge for a given day
  const getTimeOffForDay = (date: Date) => {
    const dateStr = format(date, "yyyy-MM-dd");
    const timeOffEntry = timeOff.find((to) => {
      const start = to.startDate.slice(0, 10);
      const end = to.endDate.slice(0, 10);
      return dateStr >= start && dateStr <= end;
    });
    return timeOffEntry?.type || null;
  };

  const colCount = 11; // project + phase + description + 7 days + total (+ remove is inside total cell)

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-slate-50">
            <th className="text-left px-4 py-3 font-semibold text-slate-700 min-w-[180px]">
              Project
            </th>
            {/* I-A: phase + description columns */}
            <th className="text-left px-2 py-3 font-semibold text-slate-700 min-w-[120px]">
              Phase
            </th>
            <th className="text-left px-2 py-3 font-semibold text-slate-700 min-w-[160px]">
              Description
            </th>
            {days.map((day) => {
              const isWeekendDay = isWeekend(day);
              const isCurrentDay = isToday(day);
              const timeOffType = getTimeOffForDay(day);

              return (
                <th
                  key={day.toISOString()}
                  className={`px-3 py-3 text-center font-semibold w-24 ${
                    isWeekendDay
                      ? "bg-slate-100 text-slate-500"
                      : isCurrentDay
                      ? "bg-indigo-50 text-indigo-700"
                      : "text-slate-700"
                  }`}
                >
                  <div className="text-sm">{format(day, "EEE")}</div>
                  <div className="text-xs">{format(day, "MMM d")}</div>
                  {timeOffType && (
                    <div className="mt-1 px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded">
                      {timeOffType}
                    </div>
                  )}
                </th>
              );
            })}
            <th className="px-4 py-3 text-right font-semibold text-slate-700 w-28">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="px-6 py-12 text-center text-slate-500">
                No projects yet. Click "Add new row" to start tracking time.
              </td>
            </tr>
          ) : (
            <>
              {rows.map((row) => (
                <tr key={rowKey(row)} className="border-b hover:bg-slate-50 group">
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: row.projectColor }}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 truncate">
                          {row.projectName}
                          {row.taskName && (
                            <span className="text-slate-500 font-normal"> • {row.taskName}</span>
                          )}
                        </div>
                        {row.clientName && (
                          <div className="text-sm text-slate-500 truncate">{row.clientName}</div>
                        )}
                        {/* The row's sub-task can be changed after the row was
                            created (picked from the project's task list) */}
                        {(() => {
                          const tasks =
                            projects.find((p) => p.id === row.projectId)?.tasks ?? [];
                          if (!onRowTaskChange || tasks.length === 0) return null;
                          return (
                            <select
                              value={row.taskId ?? ""}
                              disabled={disabled}
                              title="Sub-task"
                              onChange={(e) => onRowTaskChange(row, e.target.value || null)}
                              className="mt-1 w-full max-w-[170px] border border-slate-300 rounded px-1 py-0.5 text-xs text-slate-600 disabled:bg-slate-100 disabled:cursor-not-allowed"
                            >
                              <option value="">No sub-task</option>
                              {tasks.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          );
                        })()}
                      </div>
                    </div>
                  </td>
                  {/* I-A: phase selector */}
                  <td className="px-2 py-4">
                    <select
                      value={row.phase ?? ""}
                      disabled={disabled}
                      onChange={(e) =>
                        onRowMetaChange(row, { phase: e.target.value || null })
                      }
                      className="w-full border border-slate-300 rounded px-1 py-1 text-sm disabled:bg-slate-100 disabled:cursor-not-allowed"
                    >
                      <option value="">—</option>
                      {PHASES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </td>
                  {/* I-A: free-flowing description */}
                  <td className="px-2 py-4">
                    <DescriptionCell
                      value={row.description}
                      disabled={disabled}
                      onCommit={(description) => onRowMetaChange(row, { description })}
                    />
                  </td>
                  {days.map((day) => {
                    const dateStr = format(day, "yyyy-MM-dd");
                    const duration = row.entries[dateStr] || "";
                    const isWeekendDay = isWeekend(day);

                    return (
                      <td
                        key={dateStr}
                        className={`px-3 py-4 text-center ${
                          isWeekendDay ? "bg-slate-50" : ""
                        }`}
                      >
                        <DurationInput
                          value={duration}
                          onChange={(value) => onDurationChange(row, dateStr, value)}
                          disabled={disabled}
                        />
                      </td>
                    );
                  })}
                  <td className="px-4 py-4 text-right font-semibold text-slate-900 whitespace-nowrap">
                    {formatDuration(workspace, row.total)}
                    {/* B12: remove the entire row (all entries this week) */}
                    <button
                      title="Remove row"
                      disabled={disabled}
                      onClick={() => onRemoveRow(row)}
                      className="ml-2 text-slate-300 hover:text-red-600 disabled:hover:text-slate-300 disabled:cursor-not-allowed align-middle"
                    >
                      &#128465;
                    </button>
                  </td>
                </tr>
              ))}
              {/* Total Row (REQ-TS-F06) */}
              <tr className="bg-slate-50 font-semibold">
                <td colSpan={3} className="px-4 py-4 text-slate-900">
                  Total
                  <span className="ml-2 font-normal text-xs text-slate-500">
                    capacity {formatDuration(workspace, capacityMinutes)}/working day
                  </span>
                </td>
                {days.map((day) => {
                  const dateStr = format(day, "yyyy-MM-dd");
                  const isWeekendDay = isWeekend(day);
                  const minutes = parseHM(totals.dailyTotals[dateStr]);
                  // Days at or over the workspace daily capacity stand out
                  const met = !isWeekendDay && minutes >= capacityMinutes && minutes > 0;
                  const under = !isWeekendDay && minutes > 0 && minutes < capacityMinutes;

                  return (
                    <td
                      key={dateStr}
                      title={
                        isWeekendDay
                          ? "Not a working day"
                          : `${formatDuration(workspace, minutes)} of ${formatDuration(workspace, capacityMinutes)} capacity`
                      }
                      className={`px-3 py-4 text-center ${
                        isWeekendDay ? "bg-slate-100" : met ? "text-emerald-700" : under ? "text-amber-700" : ""
                      }`}
                    >
                      {formatDuration(workspace, minutes)}
                    </td>
                  );
                })}
                <td className="px-4 py-4 text-right text-indigo-600 text-lg">
                  {totals.grandTotal}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Uncontrolled description editor: commits on blur/Enter, resets on Escape or
// when the server value changes (via key).
function DescriptionCell({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  return (
    <input
      key={value}
      type="text"
      defaultValue={value}
      disabled={disabled}
      placeholder="Description"
      onBlur={(e) => {
        const next = e.currentTarget.value.trim();
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = value;
          e.currentTarget.blur();
        }
      }}
      className="w-full border border-slate-300 rounded px-2 py-1 text-sm disabled:bg-slate-100 disabled:cursor-not-allowed"
    />
  );
}

/** "H:MM" (as returned by the API) -> minutes */
function parseHM(value: string | undefined): number {
  const m = /^(\d{1,3}):([0-5]\d)$/.exec(value ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}
