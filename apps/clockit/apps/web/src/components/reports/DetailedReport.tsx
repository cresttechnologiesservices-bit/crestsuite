import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { ColumnVisibility, DEFAULT_VISIBLE_COLUMNS } from "./ReportsFilters";
import { useWorkspace, formatMoney } from "../../lib/workspace";

// Parse "H:MM" / "HH:MM" into minutes (inline duration editing)
function parseHM(text: string): number | null {
  const m = text.trim().match(/^(\d{1,3}):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

interface DetailedReportProps {
  dateParams: { start_date: string; end_date: string };
  filters: any;
  rounding?: number;
  visibleColumns?: ColumnVisibility;
}

const AUDIT_LABELS: Record<string, string> = {
  suspicious_duration: "suspicious duration",
  without_project: "without project",
  without_task: "without task",
};

function LockIcon({ locked }: { locked: boolean }) {
  // REQ-REP-F23: lock icon indicating editable vs locked entries
  return locked ? (
    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-label="Locked">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  ) : (
    <svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-label="Editable">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 018 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
    </svg>
  );
}

export function DetailedReport({
  dateParams,
  filters,
  rounding,
  visibleColumns = DEFAULT_VISIBLE_COLUMNS,
}: DetailedReportProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState("time");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditFlags, setAuditFlags] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const workspace = useWorkspace();
  const queryClient = useQueryClient();

  // Entries are editable in place (own entries; admins for members' entries —
  // the server enforces the exact permissions)
  async function patchEntry(id: string, payload: any) {
    try {
      setEditError(null);
      await api.patch(`/time-entries/${id}`, payload);
      queryClient.invalidateQueries({ queryKey: ["report-detailed"] });
      queryClient.invalidateQueries({ queryKey: ["report-audit"] });
    } catch (e: any) {
      const code = e?.response?.data?.error;
      setEditError(
        code === "admin_entries_billable_only"
          ? "Another administrator's entry — only the billable status can be changed."
          : code === "overlap"
            ? "This change overlaps an existing entry."
            : "You are not allowed to edit this entry."
      );
      queryClient.invalidateQueries({ queryKey: ["report-detailed"] });
    }
  }

  const params: any = {
    ...dateParams,
    ...filters,
    page,
    page_size: pageSize,
    sort_by: sortBy,
    sort_order: sortOrder,
  };
  if (rounding) params.rounding = rounding;

  const { data, isLoading } = useQuery({
    queryKey: ["report-detailed", params],
    queryFn: async () => (await api.get("/reports/detailed", { params })).data,
  });

  // REQ-REP-F75: audit-flagged entries (OR logic across flags)
  const { data: auditData } = useQuery({
    queryKey: ["report-audit", dateParams, filters, auditFlags],
    queryFn: async () =>
      (await api.get("/reports/detailed/audit", {
        params: { ...dateParams, ...filters, flag: auditFlags.join(",") },
      })).data,
    enabled: auditFlags.length > 0,
  });

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortOrder("desc");
    }
  };

  const toggleAuditFlag = (flag: string) => {
    setAuditFlags((prev) =>
      prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag]
    );
  };

  const auditMode = auditFlags.length > 0;
  const items: any[] = auditMode ? auditData?.items || [] : data?.items || [];

  // REQ-REP-F76: status label reflecting active audit filter
  const auditStatusLabel = auditMode
    ? `Showing ${auditFlags.map((f) => AUDIT_LABELS[f]).join(", ")} entries`
    : "Showing all time entries";

  // REQ-REP-F22: bulk select
  const allSelected = items.length > 0 && items.every((e) => selectedIds.includes(e.id));
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? [] : items.map((e) => e.id));
  };
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const sortIndicator = (col: string) =>
    sortBy === col ? (sortOrder === "asc" ? " ↑" : " ↓") : "";

  const rangeStart = (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, data?.total || 0);

  return (
    <div className="space-y-4">
      {/* REQ-REP-F72..F78: Time audit panel */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAuditOpen(!auditOpen)}
            className="text-sm font-medium text-slate-700 flex items-center gap-1 hover:text-slate-900"
          >
            Time audit
            <svg
              className={`w-3 h-3 transition-transform ${auditOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <span className="text-xs text-slate-500">{auditStatusLabel}</span>
          {auditMode && auditData && (
            <span className="text-xs text-slate-500">({auditData.items.length} flagged)</span>
          )}
        </div>
        {auditOpen && (
          <div className="flex items-center gap-4 mt-3 pt-3 border-t">
            <span className="text-xs font-semibold text-slate-500 uppercase">Audit</span>
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={auditFlags.includes("suspicious_duration")}
                onChange={() => toggleAuditFlag("suspicious_duration")}
              />
              Suspicious duration
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={auditFlags.includes("without_project")}
                onChange={() => toggleAuditFlag("without_project")}
              />
              Without project
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={auditFlags.includes("without_task")}
                onChange={() => toggleAuditFlag("without_task")}
              />
              Without task
            </label>
          </div>
        )}
      </div>

      {editError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">
          {editError}
        </div>
      )}

      {/* Bulk selection info */}
      {selectedIds.length > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2 text-sm text-indigo-800 flex items-center justify-between">
          <span>{selectedIds.length} selected</span>
          <button onClick={() => setSelectedIds([])} className="text-indigo-600 hover:underline">
            Clear selection
          </button>
        </div>
      )}

      {/* REQ-REP-F21, F24: Sortable table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b">
              <tr>
                {/* REQ-REP-F22: select-all */}
                <th className="px-3 py-3 w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
                </th>
                <th
                  className="text-left px-4 py-3 text-sm font-semibold cursor-pointer hover:bg-slate-100"
                  onClick={() => handleSort("description")}
                >
                  Time Entry{sortIndicator("description")}
                </th>
                {visibleColumns.team !== false && (
                  <th
                    className="text-left px-4 py-3 text-sm font-semibold cursor-pointer hover:bg-slate-100"
                    onClick={() => handleSort("user")}
                  >
                    User{sortIndicator("user")}
                  </th>
                )}
                <th
                  className="text-left px-4 py-3 text-sm font-semibold cursor-pointer hover:bg-slate-100"
                  onClick={() => handleSort("time")}
                >
                  Time{sortIndicator("time")}
                </th>
                <th
                  className="text-right px-4 py-3 text-sm font-semibold cursor-pointer hover:bg-slate-100"
                  onClick={() => handleSort("duration")}
                >
                  Duration{sortIndicator("duration")}
                </th>
                <th className="px-3 py-3 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="text-center py-12 text-slate-500">Loading...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-slate-500">No entries found</td></tr>
              ) : (
                items.map((entry: any) => (
                  <tr key={entry.id} className="border-b hover:bg-slate-50">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(entry.id)}
                        onChange={() => toggleSelect(entry.id)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {visibleColumns.description !== false && (
                        <input
                          key={entry.description}
                          type="text"
                          defaultValue={entry.description}
                          placeholder="(no description)"
                          disabled={!!entry.locked}
                          title="Edit description — press Enter to save"
                          onKeyDown={(ev) => ev.key === "Enter" && (ev.currentTarget as HTMLInputElement).blur()}
                          onBlur={(ev) => {
                            const next = ev.currentTarget.value.trim();
                            if (next !== (entry.description ?? "")) patchEntry(entry.id, { description: next });
                          }}
                          className="w-full font-medium bg-transparent border border-transparent rounded px-1 py-0.5 hover:border-slate-300 focus:border-indigo-500 focus:outline-none"
                        />
                      )}
                      <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                        {visibleColumns.project !== false && (
                          <>
                            {entry.projectColor && (
                              <span
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: entry.projectColor }}
                              />
                            )}
                            <span>{entry.projectName || "No project"}</span>
                          </>
                        )}
                        {visibleColumns.client !== false && entry.clientName && (
                          <span>• {entry.clientName}</span>
                        )}
                        {visibleColumns.task !== false && entry.taskName && (
                          <span>• {entry.taskName}</span>
                        )}
                        {visibleColumns.tag !== false && entry.tags?.length > 0 && (
                          <div className="flex gap-1">
                            {entry.tags.map((t: string) => (
                              <span key={t} className="px-1.5 py-0.5 bg-slate-100 rounded text-xs">
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                        {auditMode && entry.flags?.length > 0 && (
                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs">
                            {entry.flags.map((f: string) => AUDIT_LABELS[f]).join(", ")}
                          </span>
                        )}
                      </div>
                    </td>
                    {visibleColumns.team !== false && (
                      <td className="px-4 py-3 text-sm">{entry.userName}</td>
                    )}
                    <td className="px-4 py-3 text-sm">
                      <div>{entry.date}</div>
                      <div className="text-xs text-slate-500">
                        {entry.startTime} - {entry.endTime}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <input
                        key={entry.duration}
                        type="text"
                        defaultValue={entry.duration}
                        disabled={!!entry.locked || !entry.end}
                        title="Edit duration (H:MM) — press Enter to save"
                        onKeyDown={(ev) => ev.key === "Enter" && (ev.currentTarget as HTMLInputElement).blur()}
                        onBlur={(ev) => {
                          const minutes = parseHM(ev.currentTarget.value);
                          ev.currentTarget.value = entry.duration;
                          if (minutes === null || minutes <= 0 || minutes === entry.durationMinutes) return;
                          const end = new Date(new Date(entry.start).getTime() + minutes * 60000);
                          patchEntry(entry.id, { end: end.toISOString() });
                        }}
                        className="w-16 text-right font-semibold bg-transparent border border-transparent rounded px-1 py-0.5 hover:border-slate-300 focus:border-indigo-500 focus:outline-none"
                      />
                      {visibleColumns.status !== false && (
                        <button
                          title={`${entry.billable ? "Billable" : "Not billable"} — click to change`}
                          disabled={!!entry.locked}
                          onClick={() => patchEntry(entry.id, { billable: !entry.billable })}
                          className={`block ml-auto text-xs font-semibold px-1 rounded hover:bg-slate-100 ${entry.billable ? "text-green-600" : "text-slate-300"}`}
                        >
                          {entry.billable
                            ? entry.amount !== undefined
                              ? formatMoney(workspace, Number(entry.amount))
                              : "Billable"
                            : "$"}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <LockIcon locked={!!entry.locked} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination (regular mode only) */}
        {!auditMode && data && data.total > 0 && (
          <div className="border-t px-4 py-3 flex items-center justify-between text-sm">
            <div className="text-slate-600">
              {rangeStart}-{rangeEnd} of {data.total}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="px-2 py-1 border rounded disabled:opacity-50"
              >
                «
              </button>
              <button
                onClick={() => setPage(page - 1)}
                disabled={page === 1}
                className="px-2 py-1 border rounded disabled:opacity-50"
              >
                ‹
              </button>
              <span className="px-2">Page {page} of {data.totalPages}</span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page >= data.totalPages}
                className="px-2 py-1 border rounded disabled:opacity-50"
              >
                ›
              </button>
              <button
                onClick={() => setPage(data.totalPages)}
                disabled={page >= data.totalPages}
                className="px-2 py-1 border rounded disabled:opacity-50"
              >
                »
              </button>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="px-2 py-1 border rounded"
              >
                <option value={25}>25/page</option>
                <option value={50}>50/page</option>
                <option value={100}>100/page</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
