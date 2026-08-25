import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

const fmt = (h: number) =>
  `${h.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}h`;

export function StatusTab({ projectId }: { projectId: string }) {
  const [taskFilter, setTaskFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"name" | "tracked">("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const { data, isLoading } = useQuery({
    queryKey: ["project-status", projectId],
    queryFn: async () => (await api.get(`/projects/${projectId}/status`)).data,
  });

  const tasks = useMemo(() => {
    const list = (data?.tasks ?? []).filter((t: any) => taskFilter === "all" || t.status === taskFilter);
    const dir = sortOrder === "asc" ? 1 : -1;
    return [...list].sort((a: any, b: any) => {
      if (sortBy === "tracked") return (a.trackedHours - b.trackedHours) * dir;
      return a.name.localeCompare(b.name) * dir;
    });
  }, [data, taskFilter, sortBy, sortOrder]);

  if (isLoading) return <div className="text-slate-500 py-8">Loading...</div>;
  if (!data) return null;

  const { trackedHours, billableHours, nonBillableHours, amount } = data;
  const billablePct = trackedHours > 0 ? billableHours / trackedHours : 0;

  // Donut geometry
  const radius = 60;
  const circumference = 2 * Math.PI * radius;

  const toggleSort = (col: "name" | "tracked") => {
    if (sortBy === col) setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    else {
      setSortBy(col);
      setSortOrder("asc");
    }
  };

  const cards = [
    { label: "TRACKED", value: fmt(trackedHours) },
    { label: "BILLABLE", value: fmt(billableHours) },
    { label: "NON-BILLABLE", value: fmt(nonBillableHours) },
    { label: "AMOUNT", value: `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD` },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-lg shadow p-4">
            <div className="text-xs font-semibold text-slate-500">{c.label}</div>
            <div className="text-xl font-bold tabular-nums mt-1">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow p-6 mb-6 flex items-center gap-8 flex-wrap">
        <svg width="160" height="160" viewBox="0 0 160 160">
          <circle cx="80" cy="80" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="20" />
          {trackedHours > 0 && (
            <>
              <circle
                cx="80"
                cy="80"
                r={radius}
                fill="none"
                stroke="#38bdf8"
                strokeWidth="20"
                strokeDasharray={`${(1 - billablePct) * circumference} ${circumference}`}
                strokeDashoffset={-billablePct * circumference}
                transform="rotate(-90 80 80)"
              >
                <title>{`Non-billable: ${fmt(nonBillableHours)}`}</title>
              </circle>
              <circle
                cx="80"
                cy="80"
                r={radius}
                fill="none"
                stroke="#4f46e5"
                strokeWidth="20"
                strokeDasharray={`${billablePct * circumference} ${circumference}`}
                transform="rotate(-90 80 80)"
              >
                <title>{`Billable: ${fmt(billableHours)}`}</title>
              </circle>
            </>
          )}
          <text x="80" y="85" textAnchor="middle" className="font-bold" fontSize="16" fill="#0f172a">
            {fmt(trackedHours)}
          </text>
        </svg>
        <div className="text-sm space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#4f46e5" }} />
            Billable — {fmt(billableHours)}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#38bdf8" }} />
            Non-billable — {fmt(nonBillableHours)}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">Tasks</h3>
          <select
            value={taskFilter}
            onChange={(e) => setTaskFilter(e.target.value)}
            className="px-3 py-1.5 border rounded text-sm"
          >
            <option value="all">Show all</option>
            <option value="active">Show active</option>
            <option value="done">Show done</option>
          </select>
        </div>
        <table className="w-full">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th
                className="text-left px-4 py-3 text-sm font-semibold cursor-pointer select-none hover:text-indigo-600"
                onClick={() => toggleSort("name")}
              >
                NAME {sortBy === "name" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
              </th>
              <th className="text-left px-4 py-3 text-sm font-semibold">ASSIGNEES</th>
              <th
                className="text-right px-4 py-3 text-sm font-semibold cursor-pointer select-none hover:text-indigo-600"
                onClick={() => toggleSort("tracked")}
              >
                TRACKED {sortBy === "tracked" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
              </th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 ? (
              <tr><td colSpan={3} className="text-center py-10 text-slate-500">No tasks</td></tr>
            ) : (
              tasks.map((t: any) => (
                <tr key={t.id} className="border-b hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className="px-2 py-1 text-xs bg-slate-100 rounded"
                      title={Array.isArray(t.assignees) && t.assignees.length > 0 ? `${t.assignees.length} assignee(s)` : "Anyone"}
                    >
                      {Array.isArray(t.assignees) && t.assignees.length > 0 ? `${t.assignees.length} assignee(s)` : "Anyone"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-right tabular-nums">{fmt(t.trackedHours)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
