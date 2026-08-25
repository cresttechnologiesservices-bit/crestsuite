import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from "recharts";
import { PieChart, Pie, Cell } from "recharts";
import { format, parseISO } from "date-fns";
import { useWorkspace, formatMoney } from "../../lib/workspace";

// Parse "H:MM" / "HH:MM" into minutes (drill-down duration editing)
function parseHM(text: string): number | null {
  const m = text.trim().match(/^(\d{1,3}):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Drill-down for a breakdown group: every associated time entry with its
 * description. Description, duration and billable are editable in place —
 * the server enforces who may edit what (own entries, admins for members).
 */
function GroupEntries({ baseParams, groupBy, group }: { baseParams: any; groupBy: string; group: any }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const drillParams: any = { ...baseParams, page: 1, page_size: 100, sort_by: "time", sort_order: "desc" };
  delete drillParams.group_by;
  if (groupBy === "description") {
    // Filtering by description: entries without a description are never shown
    if (group.key === "(no description)") drillParams.without_description = "true";
    else drillParams.description = group.name;
  } else {
    if (group.key === "no-project") drillParams.without_project = "true";
    else drillParams.project_ids = group.key;
  }

  const { data, isLoading } = useQuery({
    queryKey: ["report-summary-drill", drillParams],
    queryFn: async () => (await api.get("/reports/detailed", { params: drillParams })).data,
  });

  async function patchEntry(id: string, payload: any) {
    try {
      setError(null);
      await api.patch(`/time-entries/${id}`, payload);
      queryClient.invalidateQueries({ queryKey: ["report-summary-drill"] });
      queryClient.invalidateQueries({ queryKey: ["report-summary"] });
    } catch (e: any) {
      const code = e?.response?.data?.error;
      setError(
        code === "admin_entries_billable_only"
          ? "Another administrator's entry — only the billable status can be changed."
          : code === "overlap"
            ? "This change overlaps an existing entry."
            : "You are not allowed to edit this entry."
      );
      queryClient.invalidateQueries({ queryKey: ["report-summary-drill"] });
    }
  }

  const entries: any[] = (data?.items || []).filter(
    (e: any) => !(groupBy === "description" && group.key !== "(no description)" && !e.description)
  );

  return (
    <tr>
      <td colSpan={5} className="bg-slate-50 px-3 py-3">
        {error && <div className="text-xs text-red-600 mb-2">{error}</div>}
        {isLoading ? (
          <div className="text-sm text-slate-500 py-2">Loading entries…</div>
        ) : !entries.length ? (
          <div className="text-sm text-slate-500 py-2">No time entries in this group.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 uppercase">
                <th className="py-1 pr-2">Date</th>
                <th className="py-1 pr-2">User</th>
                <th className="py-1 pr-2">Description</th>
                <th className="py-1 pr-2">Time</th>
                <th className="py-1 pr-2 text-center">$</th>
                <th className="py-1 text-right">Duration</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-slate-200">
                  <td className="py-1.5 pr-2 whitespace-nowrap">{e.date}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{e.userName}</td>
                  <td className="py-1.5 pr-2 w-full">
                    <input
                      key={e.description}
                      type="text"
                      defaultValue={e.description}
                      placeholder="(no description)"
                      disabled={e.locked}
                      title="Edit description — press Enter to save"
                      onKeyDown={(ev) => ev.key === "Enter" && (ev.currentTarget as HTMLInputElement).blur()}
                      onBlur={(ev) => {
                        const next = ev.currentTarget.value.trim();
                        if (next !== (e.description ?? "")) patchEntry(e.id, { description: next });
                      }}
                      className="w-full bg-transparent border border-transparent rounded px-1 py-0.5 hover:border-slate-300 focus:border-indigo-500 focus:outline-none"
                    />
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap text-slate-500">
                    {e.startTime} - {e.endTime ?? "now"}
                  </td>
                  <td className="py-1.5 pr-2 text-center">
                    <button
                      title={`${e.billable ? "Billable" : "Not billable"} — click to change`}
                      disabled={e.locked}
                      onClick={() => patchEntry(e.id, { billable: !e.billable })}
                      className={`font-semibold px-1 rounded hover:bg-slate-200 ${e.billable ? "text-emerald-600" : "text-slate-300"}`}
                    >
                      $
                    </button>
                  </td>
                  <td className="py-1.5 text-right">
                    <input
                      key={e.duration}
                      type="text"
                      defaultValue={e.duration}
                      disabled={e.locked || !e.end}
                      title="Edit duration (H:MM) — press Enter to save"
                      onKeyDown={(ev) => ev.key === "Enter" && (ev.currentTarget as HTMLInputElement).blur()}
                      onBlur={(ev) => {
                        const minutes = parseHM(ev.currentTarget.value);
                        ev.currentTarget.value = e.duration;
                        if (minutes === null || minutes <= 0 || minutes === e.durationMinutes) return;
                        const end = new Date(new Date(e.start).getTime() + minutes * 60000);
                        patchEntry(e.id, { end: end.toISOString() });
                      }}
                      className="w-16 text-right font-mono bg-transparent border border-transparent rounded px-1 py-0.5 hover:border-slate-300 focus:border-indigo-500 focus:outline-none"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </td>
    </tr>
  );
}

interface SummaryReportProps {
  dateParams: { start_date: string; end_date: string };
  filters: any;
  rounding?: number;
}

function EmptyState() {
  return (
    <div className="text-center py-12">
      <div className="text-slate-600 font-medium">No data to show</div>
      <div className="text-sm text-slate-500 mt-1">
        Try adjusting the filters to get some results.
      </div>
    </div>
  );
}

export function SummaryReport({ dateParams, filters, rounding }: SummaryReportProps) {
  // I24: Group By offers Project, Description and Billable
  // ("Billable" = project grouping restricted to billable entries only)
  const [groupBy, setGroupBy] = useState<"project" | "description" | "billable">("project");
  // A selected breakdown item expands to list all of its time entries
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // Money is rendered in the workspace currency / number format
  const workspace = useWorkspace();
  const params: any = { ...dateParams, ...filters, group_by: groupBy };
  if (groupBy === "billable") {
    params.group_by = "project";
    params.billable = "true";
  }
  if (rounding) params.rounding = rounding;

  const { data, isLoading } = useQuery({
    queryKey: ["report-summary", params],
    queryFn: async () => (await api.get("/reports/summary", { params })).data,
  });

  if (isLoading) return <div className="text-center py-12 text-slate-500">Loading...</div>;

  const chartData =
    data?.dailyTotals?.map((d: any) => ({
      date: format(parseISO(d.date), "EEE d"),
      hours: Number((d.minutes / 60).toFixed(2)),
      duration: d.duration,
    })) || [];

  const isTeamScope = filters?.scope === "team";

  return (
    <div className="space-y-6">
      {/* REQ-REP-F09: Total header */}
      <div className="bg-white rounded-lg shadow p-6 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <div>
            <div className="text-sm text-slate-600">Total</div>
            <div className="text-3xl font-bold text-slate-900">{data?.total || "0:00"}</div>
          </div>
          {/* REQ-REP-F18: billable totals are always shown (not only for team scope) */}
          <div>
            <div className="text-sm text-slate-600">Billable</div>
            <div className="text-xl font-semibold text-slate-900">{data?.billableTotal || "0:00"}</div>
          </div>
          {isTeamScope && (
            <div>
              <div className="text-sm text-slate-600">Amount</div>
              <div className="text-xl font-semibold text-green-600">
                {formatMoney(workspace, Number(data?.amount ?? 0))}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* REQ-REP-F14: Group by dropdown */}
          <select
            value={groupBy}
            onChange={(e) => {
              setGroupBy(e.target.value as any);
              setExpandedKey(null);
            }}
            className="px-3 py-2 border rounded text-sm"
          >
            <option value="project">Group by: Project</option>
            <option value="description">Group by: Description</option>
            {/* I24: billable-only view, grouped by project */}
            <option value="billable">Group by: Billable</option>
          </select>
        </div>
      </div>

      {/* REQ-REP-F13: Bar chart with per-bar duration labels */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Daily breakdown</h3>
        {chartData.length === 0 ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData} margin={{ top: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" stroke="#64748b" />
              <YAxis stroke="#64748b" label={{ value: "Hours", angle: -90, position: "insideLeft" }} />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload?.[0]) {
                    return (
                      <div className="bg-white p-2 border rounded shadow text-sm">
                        <div className="font-semibold">{payload[0].payload.date}</div>
                        <div>{payload[0].payload.duration}</div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar dataKey="hours" fill="#4f46e5" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="duration" position="top" style={{ fontSize: 11, fill: "#475569" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* REQ-REP-F15..F17: Breakdown list + Donut with matching colors */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Breakdown</h3>
        {!data?.breakdown?.length ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Donut with total in center */}
            <div className="relative">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={data.breakdown}
                    dataKey="minutes"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                  >
                    {data.breakdown.map((item: any, i: number) => (
                      <Cell key={i} fill={item.color || `hsl(${i * 47}, 70%, 50%)`} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload?.[0]) {
                        const d = payload[0].payload;
                        return (
                          <div className="bg-white p-2 border rounded shadow text-sm">
                            <div className="font-semibold">{d.name}</div>
                            <div>{d.duration} ({d.percentage}%)</div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center">
                  <div className="text-2xl font-bold">{data.total}</div>
                  <div className="text-sm text-slate-500">Total</div>
                </div>
              </div>
            </div>

            {/* I25: grouped breakdown table — name, client, tracked duration,
                % contribution and number of entries per group */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs font-semibold text-slate-500 uppercase">
                    <th className="py-2 pr-3">{groupBy === "description" ? "Description" : "Project Name"}</th>
                    <th className="py-2 pr-3">Client</th>
                    <th className="py-2 pr-3 text-right">Tracked</th>
                    <th className="py-2 pr-3 text-right">%</th>
                    <th className="py-2 text-right">Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {data.breakdown.map((item: any, i: number) => (
                    <Fragment key={item.key}>
                      <tr
                        onClick={() => setExpandedKey(expandedKey === item.key ? null : item.key)}
                        title="Click to show this group's time entries"
                        className="border-b last:border-0 hover:bg-slate-50 cursor-pointer"
                      >
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-slate-400 text-xs">{expandedKey === item.key ? "▾" : "▸"}</span>
                            <span
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: item.color || `hsl(${i * 47}, 70%, 50%)` }}
                            />
                            <span className="font-medium truncate">{item.name}</span>
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-1 mt-1">
                            <div
                              className="h-1 rounded-full"
                              style={{
                                width: `${item.percentage}%`,
                                backgroundColor: item.color || `hsl(${i * 47}, 70%, 50%)`,
                              }}
                            />
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-slate-600">{item.clientName || "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{item.duration}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{item.percentage}%</td>
                        <td className="py-2 text-right tabular-nums">{item.entryCount}</td>
                      </tr>
                      {expandedKey === item.key && (
                        <GroupEntries
                          baseParams={params}
                          groupBy={groupBy === "billable" ? "project" : groupBy}
                          group={item}
                        />
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
