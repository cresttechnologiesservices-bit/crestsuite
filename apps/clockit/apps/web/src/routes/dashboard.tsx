import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useWorkspace, weekStartsOn } from "../lib/workspace";
import {
  format,
  startOfWeek,
  endOfWeek,
  addDays,
  subDays,
  differenceInCalendarDays,
} from "date-fns";
import { SummaryHeader } from "../components/dashboard/SummaryHeader";
import { DashboardChart } from "../components/dashboard/DashboardChart";
import { BreakdownSection } from "../components/dashboard/BreakdownSection";
import { MostTrackedActivities } from "../components/dashboard/MostTrackedActivities";
import { TeamActivities } from "../components/dashboard/TeamActivities";
import {
  RangePresetSelect,
  rangePresets,
  matchPreset,
} from "../components/dashboard/RangePresets";
import { WeekNav } from "../components/common/WeekNav";
import { GroupingDropdown } from "../components/dashboard/GroupingDropdown";
import { ScopeDropdown } from "../components/dashboard/ScopeDropdown";
import { TeamFilter } from "../components/dashboard/TeamFilter";

// REQ-DASH-B10: restore last-selected grouping/scope (server-persisted in
// User.uiPrefs; localStorage is only a fast-boot cache).
function loadPreference<T extends string>(key: string, allowed: T[], fallback: T): T {
  const stored = localStorage.getItem(key);
  return allowed.includes(stored as T) ? (stored as T) : fallback;
}

export function Dashboard() {
  // Week boundaries follow the workspace Week start setting
  const workspace = useWorkspace();
  const wsWeekStart = weekStartsOn(workspace);
  const [groupBy, setGroupByState] = useState<"project" | "billability">(() =>
    loadPreference("dashboard.groupBy", ["project", "billability"], "project")
  );
  const [scope, setScopeState] = useState<"me" | "team">(() =>
    loadPreference("dashboard.scope", ["me", "team"], "me")
  );

  // The database is authoritative: hydrate from GET /dashboard/preferences
  const { data: serverPrefs } = useQuery({
    queryKey: ["dashboard-preferences"],
    queryFn: async () => (await api.get("/dashboard/preferences")).data,
  });
  useEffect(() => {
    if (!serverPrefs) return;
    if (["project", "billability"].includes(serverPrefs.groupBy)) setGroupByState(serverPrefs.groupBy);
    if (["me", "team"].includes(serverPrefs.scope)) setScopeState(serverPrefs.scope);
  }, [serverPrefs]);

  const setGroupBy = (value: "project" | "billability") => {
    setGroupByState(value);
    api.patch("/dashboard/preferences", { groupBy: value }).catch(() => {});
  };
  const setScope = (value: "me" | "team") => {
    setScopeState(value);
    api.patch("/dashboard/preferences", { scope: value }).catch(() => {});
  };
  const [startDate, setStartDate] = useState<Date>(startOfWeek(new Date(), { weekStartsOn: wsWeekStart }));
  const [endDate, setEndDate] = useState<Date>(endOfWeek(new Date(), { weekStartsOn: wsWeekStart }));
  const [teamIds, setTeamIds] = useState<string[]>([]);

  useEffect(() => {
    localStorage.setItem("dashboard.groupBy", groupBy);
    localStorage.setItem("dashboard.scope", scope);
  }, [groupBy, scope]);

  // Realign when the workspace Week start is loaded or changed
  useEffect(() => {
    const today = new Date();
    setStartDate(startOfWeek(today, { weekStartsOn: wsWeekStart }));
    setEndDate(endOfWeek(today, { weekStartsOn: wsWeekStart }));
  }, [wsWeekStart]);

  // REQ-DASH-B06: role gating for "Team" scope
  const { data: user } = useQuery({
    queryKey: ["user-profile"],
    queryFn: async () => (await api.get("/auth/me")).data,
  });
  const canViewTeam = user ? ["OWNER", "ADMIN", "MANAGER"].includes(user.role) : false;

  useEffect(() => {
    if (user && !canViewTeam && scope === "team") {
      setScope("me");
    }
  }, [user, canViewTeam, scope]);

  const dateParams = {
    start_date: format(startDate, "yyyy-MM-dd"),
    end_date: format(endDate, "yyyy-MM-dd"),
  };

  // Fetch summary
  const { data: summary } = useQuery({
    queryKey: ["dashboard-summary", scope, startDate, endDate, teamIds],
    queryFn: async () => {
      const params: any = { ...dateParams, scope };
      if (scope === "team" && teamIds.length > 0) {
        params.team_ids = teamIds.join(",");
      }
      const response = await api.get("/dashboard/summary", { params });
      return response.data;
    },
  });

  // Fetch chart data
  const { data: chartData } = useQuery({
    queryKey: ["dashboard-chart", scope, groupBy, startDate, endDate, teamIds],
    queryFn: async () => {
      const params: any = { ...dateParams, scope, group_by: groupBy };
      if (scope === "team" && teamIds.length > 0) {
        params.team_ids = teamIds.join(",");
      }
      const response = await api.get("/dashboard/chart", { params });
      return response.data;
    },
  });

  // Fetch breakdown data
  const { data: breakdownData } = useQuery({
    queryKey: ["dashboard-breakdown", scope, groupBy, startDate, endDate, teamIds],
    queryFn: async () => {
      const params: any = { ...dateParams, scope, group_by: groupBy };
      if (scope === "team" && teamIds.length > 0) {
        params.team_ids = teamIds.join(",");
      }
      const response = await api.get("/dashboard/breakdown", { params });
      return response.data;
    },
  });

  // Fetch activities (for "me" scope)
  const { data: activities = [] } = useQuery({
    queryKey: ["dashboard-activities", startDate, endDate],
    queryFn: async () => {
      const response = await api.get("/dashboard/activities", {
        params: { ...dateParams, scope: "me", limit: 50 },
      });
      return response.data;
    },
    enabled: scope === "me",
  });

  // Fetch team activities (for "team" scope)
  const { data: teamActivities = [] } = useQuery({
    queryKey: ["dashboard-team-activities", startDate, endDate, teamIds],
    queryFn: async () => {
      const params: any = { ...dateParams };
      if (teamIds.length > 0) {
        params.team_ids = teamIds.join(",");
      }
      const response = await api.get("/dashboard/team-activities", { params });
      return response.data;
    },
    enabled: scope === "team" && canViewTeam,
  });

  // Shared presets, so the corner picker and the Date Range filter offer and
  // name exactly the same periods
  const presets = useMemo(() => rangePresets(wsWeekStart), [wsWeekStart]);
  const activePreset = useMemo(
    () => matchPreset(presets, startDate, endDate),
    [presets, startDate, endDate]
  );

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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-600 mt-1">
            Overview of your time tracking data
          </p>
        </div>
        {/* Selected range + Previous/Next + week picker, top-right corner */}
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
      </div>

      {/* Filters & Controls */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <GroupingDropdown value={groupBy} onChange={setGroupBy} />
          <ScopeDropdown value={scope} onChange={setScope} canViewTeam={canViewTeam} />
          <RangePresetSelect
            start={startDate}
            end={endDate}
            onSelect={(start, end) => {
              setStartDate(start);
              setEndDate(end);
            }}
          />
          {scope === "team" && (
            <TeamFilter selectedIds={teamIds} onChange={setTeamIds} />
          )}
        </div>
      </div>

      {/* Summary Header */}
      <SummaryHeader
        summary={summary}
        groupBy={groupBy}
        className="mb-6"
      />

      {/* Chart */}
      <DashboardChart
        days={chartData?.days || []}
        series={chartData?.series || []}
        groupBy={groupBy}
        className="mb-6"
      />

      {/* Breakdown Section */}
      {breakdownData && (
        <BreakdownSection
          data={breakdownData}
          groupBy={groupBy}
          className="mb-6"
        />
      )}

      {/* Activities Section */}
      {scope === "me" ? (
        <MostTrackedActivities activities={activities} />
      ) : (
        <TeamActivities activities={teamActivities} />
      )}
    </div>
  );
}
