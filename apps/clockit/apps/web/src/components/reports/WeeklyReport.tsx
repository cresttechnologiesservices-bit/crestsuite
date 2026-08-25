import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { format, parseISO } from "date-fns";

interface WeeklyReportProps {
  dateParams: { start_date: string; end_date: string };
  filters: any;
  rounding?: number;
}

export function WeeklyReport({ dateParams, filters, rounding }: WeeklyReportProps) {
  // REQ-REP-F31: Group by dropdown
  const [groupBy, setGroupBy] = useState<"project" | "user" | "description">("project");
  const params: any = { ...dateParams, ...filters, group_by: groupBy };
  if (rounding) params.rounding = rounding;

  const { data, isLoading } = useQuery({
    queryKey: ["report-weekly", params],
    queryFn: async () => (await api.get("/reports/weekly", { params })).data,
  });

  if (isLoading) return <div className="text-center py-12 text-slate-500">Loading...</div>;

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-slate-700">Group by: </span>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as any)}
            className="px-3 py-1 border rounded text-sm"
          >
            <option value="project">Project</option>
            <option value="user">User</option>
            <option value="description">Description</option>
          </select>
        </div>
        <div className="text-lg font-bold">
          Total: <span className="text-indigo-600">{data?.grandTotal || "0:00"}</span>
        </div>
      </div>

      {/* REQ-REP-F30: rows per group, columns per day, row-level totals */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-semibold sticky left-0 bg-slate-50">
                {groupBy === "project" ? "Project" : groupBy === "user" ? "User" : "Description"}
              </th>
              {data?.days?.map((day: string) => (
                <th key={day} className="px-3 py-3 text-center text-sm font-semibold min-w-[80px]">
                  <div>{format(parseISO(day), "EEE")}</div>
                  <div className="text-xs text-slate-500">{format(parseISO(day), "MMM d")}</div>
                </th>
              ))}
              <th className="px-4 py-3 text-right text-sm font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {!data?.rows?.length ? (
              <tr>
                <td colSpan={(data?.days?.length || 0) + 2} className="text-center py-12 text-slate-500">
                  No data to show
                </td>
              </tr>
            ) : (
              <>
                {data.rows.map((row: any) => (
                  <tr key={row.key} className="border-b hover:bg-slate-50">
                    <td className="px-4 py-3 sticky left-0 bg-white">
                      <div className="flex items-center gap-2">
                        {row.color && (
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: row.color }}
                          />
                        )}
                        <span className="font-medium">{row.name}</span>
                      </div>
                    </td>
                    {/* REQ-REP-F32: dash placeholder for empty cells */}
                    {data.days.map((day: string) => (
                      <td key={day} className="px-3 py-3 text-center text-sm">
                        {row.daily[day] || "—"}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right font-semibold">{row.total}</td>
                  </tr>
                ))}
                {/* Totals row */}
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-4 py-3 sticky left-0 bg-slate-50">Total</td>
                  {data.days.map((day: string) => (
                    <td key={day} className="px-3 py-3 text-center text-sm">
                      {data.columnTotals[day] || "0:00"}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right text-indigo-600">{data.grandTotal}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
