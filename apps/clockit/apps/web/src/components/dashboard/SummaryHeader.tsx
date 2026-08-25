interface SummaryHeaderProps {
  summary: any;
  groupBy: "project" | "billability";
  className?: string;
}

export function SummaryHeader({ summary, groupBy, className = "" }: SummaryHeaderProps) {
  if (!summary) {
    return (
      <div className={`bg-white rounded-lg shadow p-6 ${className}`}>
        <div className="animate-pulse space-y-3">
          <div className="h-8 bg-slate-200 rounded w-1/4"></div>
          <div className="h-4 bg-slate-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }
  return (
    <div className={`bg-white rounded-lg shadow p-6 ${className}`}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Total Time */}
        <div>
          <div className="text-sm text-slate-600 mb-1">Total time</div>
          <div className="text-3xl font-bold text-slate-900">{summary.totalTime}</div>
        </div>

        {groupBy === "project" ? (
          <>
            {/* Top Project */}
            <div>
              <div className="text-sm text-slate-600 mb-1">Top Project</div>
              <div className="text-xl font-semibold text-slate-900">
                {summary.topProject || "—"}
              </div>
            </div>

            {/* Top Client */}
            <div>
              <div className="text-sm text-slate-600 mb-1">Top Client</div>
              <div className="text-xl font-semibold text-slate-900">
                {summary.topClient || "—"}
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Billable Percentage */}
            <div>
              <div className="text-sm text-slate-600 mb-1">Billable</div>
              <div className="text-3xl font-bold text-indigo-600">
                {summary.billablePercentage}%
              </div>
            </div>

            {/* Spacer */}
            <div></div>
          </>
        )}
      </div>
    </div>
  );
}
