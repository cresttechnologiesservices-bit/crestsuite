import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

// Public viewer for shared report links (REQ-REP-F33/B18/B21).
// Report metadata is public for "public" visibility; the underlying data
// requires a session, so unauthenticated viewers see the report summary
// header with a login prompt for the detail rows.
export function SharedReportView() {
  const { slug } = useParams<{ slug: string }>();

  const { data: report, isLoading, error } = useQuery({
    queryKey: ["shared-report", slug],
    queryFn: async () => (await api.get(`/reports/shared/${slug}`)).data,
    retry: false,
  });

  const filters = report?.filters ?? {};

  const { data: summary, error: summaryError } = useQuery({
    queryKey: ["shared-report-summary", slug, filters.startDate, filters.endDate],
    queryFn: async () =>
      (
        await api.get("/reports/summary", {
          params: { start_date: filters.startDate, end_date: filters.endDate },
        })
      ).data,
    enabled: !!report,
    retry: false,
  });

  if (isLoading) return <div className="p-8 text-slate-500">Loading shared report...</div>;

  if (error) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-700">Report not found</h1>
        <p className="mt-2 text-slate-500">This shared report does not exist or is private.</p>
        <Link to="/login" className="mt-4 inline-block text-indigo-600 hover:underline">
          Log in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-semibold text-slate-800">{report.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {filters.startDate} — {filters.endDate}
          {report.lockDates && " (dates locked)"}
        </p>
      </div>

      {summary ? (
        <div>
          <div className="mb-4 text-lg font-medium text-slate-700">
            Total: {summary.total ?? summary.totalFormatted ?? "0:00"}
          </div>
          <div className="space-y-2">
            {(summary.breakdown ?? summary.groups ?? []).map((g: any, i: number) => (
              <div
                key={i}
                className="flex items-center justify-between rounded border border-slate-200 px-4 py-2"
              >
                <span className="flex items-center gap-2">
                  {g.color && (
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: g.color }}
                    />
                  )}
                  <span className="text-slate-700">{g.name ?? "(no name)"}</span>
                </span>
                <span className="font-mono text-slate-600">
                  {g.durationFormatted ?? g.duration ?? ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : summaryError ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-6 text-center text-slate-500">
          <Link to="/login" className="text-indigo-600 hover:underline">
            Log in
          </Link>{" "}
          to view the report data.
        </div>
      ) : (
        <div className="text-slate-400">Loading report data...</div>
      )}
    </div>
  );
}
