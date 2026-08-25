import { clockitKey } from "../lib/storage";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { api } from "../api/client";
import { useWorkspace, weekStartsOn } from "../lib/workspace";
import { SummaryReport } from "../components/reports/SummaryReport";
import { DetailedReport } from "../components/reports/DetailedReport";
import { WeeklyReport } from "../components/reports/WeeklyReport";
import { SharedReports } from "../components/reports/SharedReports";
import { CustomerMonthlyReport } from "../components/reports/CustomerMonthlyReport";
import { ReportsFilters, ColumnVisibility, DEFAULT_VISIBLE_COLUMNS } from "../components/reports/ReportsFilters";
import { ExportDropdown } from "../components/reports/ExportDropdown";
import { ShareReportModal } from "../components/reports/ShareReportModal";
import {
  format,
  startOfWeek,
  endOfWeek,
  addDays,
  subDays,
  differenceInCalendarDays,
} from "date-fns";
import { useEffect } from "react";
import {
  RangePresetSelect,
  rangePresets,
  matchPreset,
} from "../components/dashboard/RangePresets";
import { WeekNav } from "../components/common/WeekNav";

// I10: applied report filters survive tab navigation within the session
const STORAGE_KEY = clockitKey("reports.filters");

function loadPersisted(): any {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function Reports() {
  // Week boundaries follow the workspace Week start setting
  const workspace = useWorkspace();
  const wsWeekStart = weekStartsOn(workspace);
  const location = useLocation();
  const navigate = useNavigate();

  // Determine active tab from URL
  const path = location.pathname.split("/").pop() || "summary";
  const activeTab = ["summary", "detailed", "weekly", "customer-monthly", "shared"].includes(path)
    ? path
    : "summary";
  // These tabs have their own period control (or none), so the weekly range
  // bar and filter card are hidden for them.
  const hasWeekControls = activeTab !== "shared" && activeTab !== "customer-monthly";

  const [startDate, setStartDate] = useState<Date>(() => {
    const p = loadPersisted();
    return p?.start ? new Date(p.start) : startOfWeek(new Date(), { weekStartsOn: wsWeekStart });
  });
  const [endDate, setEndDate] = useState<Date>(() => {
    const p = loadPersisted();
    return p?.end ? new Date(p.end) : endOfWeek(new Date(), { weekStartsOn: wsWeekStart });
  });
  // Shared presets, so the corner picker and the Date Range filter offer and
  // name exactly the same periods
  const presets = useMemo(() => rangePresets(wsWeekStart), [wsWeekStart]);
  const activePreset = useMemo(
    () => matchPreset(presets, startDate, endDate),
    [presets, startDate, endDate]
  );
  const [filters, setFilters] = useState<any>(() => loadPersisted()?.filters ?? {});
  const [rounding, setRounding] = useState<number | undefined>(() => loadPersisted()?.rounding ?? undefined);
  // Column visibility persists per user in the database (REQ-REP-B27/B28)
  const [visibleColumns, setVisibleColumnsState] = useState<ColumnVisibility>(DEFAULT_VISIBLE_COLUMNS);
  const { data: serverColumns } = useQuery({
    queryKey: ["report-columns"],
    queryFn: async () => (await api.get("/reports/columns")).data,
  });
  useEffect(() => {
    if (serverColumns) setVisibleColumnsState({ ...DEFAULT_VISIBLE_COLUMNS, ...serverColumns });
  }, [serverColumns]);
  const setVisibleColumns = (cols: ColumnVisibility) => {
    setVisibleColumnsState(cols);
    api.patch("/reports/columns", cols).catch(() => {});
  };
  const [showShareModal, setShowShareModal] = useState(false);
  // I19: ">" control revealing the report views
  const [showViewMenu, setShowViewMenu] = useState(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          filters,
          rounding: rounding ?? null,
        })
      );
    } catch {
      /* storage unavailable */
    }
  }, [startDate, endDate, filters, rounding]);

  const dateParams = {
    start_date: format(startDate, "yyyy-MM-dd"),
    end_date: format(endDate, "yyyy-MM-dd"),
  };

  // REQ-REP-F07: period selector navigation
  // Step by the length of the selected range, so a month-long range moves a
  // month at a time instead of crawling forward one week
  const span = Math.max(1, differenceInCalendarDays(endDate, startDate) + 1);
  const handlePrevious = () => {
    setStartDate(subDays(startDate, span));
    setEndDate(subDays(endDate, span));
  };
  const handleNext = () => {
    setStartDate(addDays(startDate, span));
    setEndDate(addDays(endDate, span));
  };
  // This Week / Last Week come from the shared presets; Next Week is only on
  // the picker, since reporting on a future period is rarely wanted
  const handleNextWeek = () => {
    const nextWeek = addDays(new Date(), 7);
    setStartDate(startOfWeek(nextWeek, { weekStartsOn: wsWeekStart }));
    setEndDate(endOfWeek(nextWeek, { weekStartsOn: wsWeekStart }));
  };

  const tabs = [
    { id: "summary", label: "Summary" },
    { id: "detailed", label: "Detailed" },
    { id: "weekly", label: "Weekly" },
    { id: "customer-monthly", label: "Customer Monthly" },
    { id: "shared", label: "Shared" },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
          {/* I19: ">" reveals a dropdown of the report views */}
          <div className="relative">
            <button
              onClick={() => setShowViewMenu(!showViewMenu)}
              title="Choose report view"
              className={`px-2 py-1 text-xl leading-none rounded hover:bg-slate-100 transition-transform ${
                showViewMenu ? "rotate-90 text-indigo-600" : "text-slate-400"
              }`}
            >
              ›
            </button>
            {showViewMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowViewMenu(false)} />
                <div className="absolute left-0 top-full mt-1 w-40 bg-white border rounded-lg shadow-lg z-20 py-1">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => {
                        setShowViewMenu(false);
                        navigate(`/reports/${tab.id}`);
                      }}
                      className={`block w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${
                        activeTab === tab.id ? "text-indigo-600 font-medium" : "text-slate-700"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <p className="text-slate-600 mt-1">Analyze your time tracking data</p>
        </div>
        {/* Selected range + Previous/Next + week picker, top-right corner */}
        {hasWeekControls && (
          <WeekNav
            label={`${format(startDate, "MMM d")} - ${format(endDate, "MMM d, yyyy")}`}
            periodStart={startDate}
            periodEnd={endDate}
            onPrevious={handlePrevious}
            onNext={handleNext}
            selectionLabel={activePreset?.label}
            options={[
              ...presets.map((p) => ({
                label: p.label,
                onSelect: () => {
                  const { start, end } = p.range();
                  setStartDate(start);
                  setEndDate(end);
                },
              })),
              { label: "Next Week", onSelect: handleNextWeek },
            ]}
            jump={{
              kind: "range",
              onApply: (start, end) => {
                setStartDate(start);
                setEndDate(end);
              },
            }}
          />
        )}
      </div>

      {/* REQ-REP-F04: Tab bar */}
      <div className="border-b mb-6">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => navigate(`/reports/${tab.id}`)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Period selector + filters + export */}
      {hasWeekControls && (
        <div className="bg-white rounded-lg shadow p-4 mb-6 print:hidden">
          <div className="flex flex-wrap items-center gap-3">
            {/* I8: quick range presets */}
            <RangePresetSelect
              start={startDate}
              end={endDate}
              onSelect={(start, end) => {
                setStartDate(start);
                setEndDate(end);
              }}
            />

            {/* REQ-REP-F10, B04: Rounding toggle */}
            <select
              value={rounding ?? ""}
              onChange={(e) => setRounding(e.target.value ? Number(e.target.value) : undefined)}
              className="px-3 py-2 border rounded text-sm"
            >
              <option value="">No rounding</option>
              <option value="15">Round to 15 min</option>
              <option value="30">Round to 30 min</option>
              <option value="60">Round to 1 hour</option>
            </select>

            <div className="flex-1"></div>

            {/* REQ-REP-F10: print control */}
            <button
              onClick={() => window.print()}
              title="Print"
              className="p-2 border rounded hover:bg-slate-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4H7v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
            </button>

            {/* REQ-REP-F36: share icon opens Share report modal */}
            <button
              onClick={() => setShowShareModal(true)}
              title="Share report"
              className="p-2 border rounded hover:bg-slate-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            </button>

            {/* REQ-REP-F43: Export dropdown */}
            <ExportDropdown dateParams={dateParams} filters={filters} rounding={rounding} />
          </div>

          {/* REQ-REP-F05, F06: Filter bar */}
          <ReportsFilters
            filters={filters}
            onChange={setFilters}
            visibleColumns={visibleColumns}
            onVisibleColumnsChange={setVisibleColumns}
          />
        </div>
      )}

      {/* Report content */}
      <Routes>
        <Route
          index
          element={<SummaryReport dateParams={dateParams} filters={filters} rounding={rounding} />}
        />
        <Route
          path="summary"
          element={<SummaryReport dateParams={dateParams} filters={filters} rounding={rounding} />}
        />
        <Route
          path="detailed"
          element={
            <DetailedReport
              dateParams={dateParams}
              filters={filters}
              rounding={rounding}
              visibleColumns={visibleColumns}
            />
          }
        />
        <Route
          path="weekly"
          element={<WeeklyReport dateParams={dateParams} filters={filters} rounding={rounding} />}
        />
        <Route path="customer-monthly" element={<CustomerMonthlyReport />} />
        <Route path="shared" element={<SharedReports />} />
      </Routes>

      {/* REQ-REP-F42: created links appear in the Shared tab list */}
      {showShareModal && (
        <ShareReportModal
          onClose={() => setShowShareModal(false)}
          filters={{ ...filters, ...dateParams, rounding, reportType: activeTab }}
        />
      )}
    </div>
  );
}
