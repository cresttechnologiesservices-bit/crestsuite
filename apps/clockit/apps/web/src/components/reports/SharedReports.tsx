import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { format, parseISO } from "date-fns";
import { ShareReportModal } from "./ShareReportModal";
import { ConfirmDialog } from "../ConfirmDialog";

export function SharedReports() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  // REQ-REP-F33: "All reports" filter dropdown
  const [visibilityFilter, setVisibilityFilter] = useState<"all" | "public" | "private">("all");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deletingReport, setDeletingReport] = useState<{ id: string; name: string } | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ["shared-reports", search],
    queryFn: async () => (await api.get("/reports/shared", { params: { search } })).data,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/reports/shared/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shared-reports"] }),
  });

  const copyLink = (slug: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/clockit/shared/reports/${slug}`);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug((s) => (s === slug ? null : s)), 2000);
  };

  const filteredReports =
    visibilityFilter === "all"
      ? reports
      : reports.filter((r: any) => r.visibility === visibilityFilter);

  return (
    <div className="bg-white rounded-lg shadow p-6">
      {/* REQ-REP-F34: Shared reports section header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">Shared reports</h2>
          <p className="text-sm text-slate-500">Reports you've shared with others</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
        >
          + Create shared report
        </button>
      </div>

      {/* REQ-REP-F33: filter dropdown + search by name */}
      <div className="flex gap-2 mb-4">
        <select
          value={visibilityFilter}
          onChange={(e) => setVisibilityFilter(e.target.value as any)}
          className="px-3 py-2 border rounded text-sm"
        >
          <option value="all">All reports</option>
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>
        <input
          type="text"
          placeholder="Search by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 border rounded"
        />
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-slate-500">Loading...</div>
      ) : filteredReports.length === 0 ? (
        // REQ-REP-F35: empty state
        <div className="text-center py-12">
          <div className="text-slate-400 mb-2">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div className="text-slate-600 font-medium">No shared reports</div>
          <div className="text-sm text-slate-500 mt-1">
            Try sharing summary, detailed or weekly report.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredReports.map((report: any) => (
            <div key={report.id} className="border rounded p-4 flex items-center justify-between">
              <div>
                <div className="font-medium">{report.name}</div>
                <div className="text-xs text-slate-500 mt-1">
                  Created {format(parseISO(report.createdAt), "MMM d, yyyy")} •{" "}
                  {report.visibility === "public" ? "Public" : "Private"}
                  {report.lockDates && " • Dates locked"}
                  {report.alwaysThisWeek && " • Always this week"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyLink(report.slug)}
                  className="px-3 py-1 text-sm border rounded hover:bg-slate-50"
                >
                  {copiedSlug === report.slug ? "Copied!" : "Copy link"}
                </button>
                <button
                  onClick={() => setDeletingReport({ id: report.id, name: report.name })}
                  className="px-3 py-1 text-sm text-red-600 border rounded hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <ShareReportModal onClose={() => setShowCreateModal(false)} filters={{}} />
      )}

      {/* B10: styled confirmation instead of the browser confirm() */}
      {deletingReport && (
        <ConfirmDialog
          title="Delete shared report"
          message={`Delete "${deletingReport.name}"? Anyone using its link will lose access. This cannot be undone.`}
          confirmLabel="Delete"
          danger
          busy={deleteMutation.isPending}
          onConfirm={() => {
            deleteMutation.mutate(deletingReport.id, {
              onSettled: () => setDeletingReport(null),
            });
          }}
          onCancel={() => setDeletingReport(null)}
        />
      )}
    </div>
  );
}
