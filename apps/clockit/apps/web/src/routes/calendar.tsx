import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useWorkspace, weekStartsOn } from "../lib/workspace";
import { format, addDays, subDays, startOfWeek } from "date-fns";
import { WeekNav } from "../components/common/WeekNav";
import { CalendarGrid } from "../components/calendar/CalendarGrid";
import { DayView } from "../components/calendar/DayView";
import { TimeEntryModal } from "../components/calendar/TimeEntryModal";
import { CalendarSettingsModal } from "../components/calendar/CalendarSettingsModal";

const ZOOM_MIN = 30;
const ZOOM_MAX = 120;
const ZOOM_STEP = 15;

export function Calendar() {
  const queryClient = useQueryClient();
  // Week boundaries follow the workspace Week start setting
  const workspace = useWorkspace();
  const wsWeekStart = weekStartsOn(workspace);
  const [viewMode, setViewMode] = useState<"week" | "day">("week");
  const [zoomLevel, setZoomLevel] = useState(60);
  const [currentDate, setCurrentDate] = useState<Date>(
    startOfWeek(new Date(), { weekStartsOn: wsWeekStart })
  );
  const [showSettings, setShowSettings] = useState(false);
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<any>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ date: Date; hour: number } | null>(null);
  const prefsInitialized = useRef(false);

  const dateKey = format(currentDate, "yyyy-MM-dd");

  // REQ-CAL-B06: preferences
  const { data: preferences } = useQuery({
    queryKey: ["calendar-preferences"],
    queryFn: async () => {
      const response = await api.get("/calendar/preferences");
      return response.data;
    },
  });

  // Apply persisted preferences once on load
  useEffect(() => {
    if (!preferences || prefsInitialized.current) return;
    prefsInitialized.current = true;
    if (preferences.viewMode === "day") {
      setViewMode("day");
      setCurrentDate(new Date());
    }
    if (preferences.zoomLevel) {
      setZoomLevel(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, preferences.zoomLevel)));
    }
  }, [preferences]);

  // REQ-CAL-B01/B15: entries + external events
  const { data: entriesData } = useQuery({
    queryKey: ["calendar-entries", viewMode, dateKey],
    queryFn: async () => {
      const response = await api.get("/calendar/entries", {
        params: {
          view: viewMode,
          start_date: dateKey,
          include_external: "true",
        },
      });
      return response.data;
    },
  });
  const entries = entriesData?.entries ?? [];
  const externalEvents = entriesData?.externalEvents ?? [];

  // REQ-CAL-B02: daily totals
  const { data: dailyTotals = {} } = useQuery({
    queryKey: ["calendar-daily-totals", viewMode, dateKey],
    queryFn: async () => {
      const response = await api.get("/calendar/daily-totals", {
        params: {
          view: viewMode,
          start_date: dateKey,
        },
      });
      return response.data;
    },
  });

  const invalidateCalendar = () => {
    queryClient.invalidateQueries({ queryKey: ["calendar-entries"] });
    queryClient.invalidateQueries({ queryKey: ["calendar-daily-totals"] });
  };

  // Mutations
  const createEntryMutation = useMutation({
    mutationFn: async (data: any) => {
      await api.post("/calendar/entries", data);
    },
    onSuccess: () => {
      invalidateCalendar();
      setShowEntryModal(false);
      setSelectedSlot(null);
    },
  });
  const updateEntryMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      await api.patch(`/calendar/entries/${id}`, data);
    },
    onSuccess: () => {
      invalidateCalendar();
      setShowEntryModal(false);
      setSelectedEntry(null);
    },
  });
  const deleteEntryMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/calendar/entries/${id}`);
    },
    onSuccess: () => {
      invalidateCalendar();
      setShowEntryModal(false);
      setSelectedEntry(null);
    },
  });
  const updatePrefsMutation = useMutation({
    mutationFn: async (data: any) => {
      await api.patch("/calendar/preferences", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-preferences"] });
    },
  });

  // REQ-CAL-F01: view mode toggle (persisted per REQ-CAL-B06)
  const handleViewModeChange = (mode: "week" | "day") => {
    setViewMode(mode);
    if (mode === "week") {
      setCurrentDate(startOfWeek(currentDate, { weekStartsOn: wsWeekStart }));
    } else {
      setCurrentDate(new Date());
    }
    updatePrefsMutation.mutate({ viewMode: mode });
  };

  // REQ-CAL-F07: zoom controls (persisted per REQ-CAL-B06)
  const handleZoom = (delta: number) => {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomLevel + delta));
    if (next !== zoomLevel) {
      setZoomLevel(next);
      updatePrefsMutation.mutate({ zoomLevel: next });
    }
  };

  // REQ-CAL-F02: period navigation
  const handlePrevious = () => {
    setCurrentDate(subDays(currentDate, viewMode === "week" ? 7 : 1));
  };
  const handleNext = () => {
    setCurrentDate(addDays(currentDate, viewMode === "week" ? 7 : 1));
  };
  const handleToday = () => {
    setCurrentDate(
      viewMode === "week" ? startOfWeek(new Date(), { weekStartsOn: wsWeekStart }) : new Date()
    );
  };
  const handleLastWeek = () => {
    setCurrentDate(startOfWeek(subDays(new Date(), 7), { weekStartsOn: wsWeekStart }));
  };

  const handleSlotClick = (date: Date, hour: number) => {
    setSelectedSlot({ date, hour });
    setSelectedEntry(null);
    setShowEntryModal(true);
  };
  const handleEntryClick = (entry: any) => {
    setSelectedEntry(entry);
    setSelectedSlot(null);
    setShowEntryModal(true);
  };

  // REQ-CAL-F27/F28: drag and resize persist via PATCH (REQ-CAL-B04)
  const handleEntryMove = (entryId: string, newStart: Date, newEnd: Date) => {
    updateEntryMutation.mutate({
      id: entryId,
      data: {
        start: newStart.toISOString(),
        end: newEnd.toISOString(),
      },
    });
  };

  const handleSaveEntry = (data: any) => {
    if (selectedEntry) {
      // The PATCH endpoint expects ISO start/end datetimes
      const start = new Date(`${data.date}T${data.startTime}:00`);
      const end = new Date(`${data.date}T${data.endTime}:00`);
      updateEntryMutation.mutate({
        id: selectedEntry.id,
        data: {
          start: start.toISOString(),
          end: end.toISOString(),
          description: data.description,
          projectId: data.projectId,
          billable: data.billable,
          tags: data.tags,
        },
      });
    } else {
      createEntryMutation.mutate(data);
    }
  };

  const periodLabel =
    viewMode === "week"
      ? `${format(currentDate, "MMM d")} - ${format(addDays(currentDate, 6), "MMM d, yyyy")}`
      : format(currentDate, "EEEE, MMMM d, yyyy");

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Calendar</h1>
        <p className="text-slate-600 mt-1">
          Visualize your time entries on a calendar
        </p>
      </div>

      <div className="bg-white rounded-lg shadow">
        {/* Header */}
        <div className="border-b px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* View Mode Toggle (REQ-CAL-F01) */}
            <div className="flex border rounded overflow-hidden">
              <button
                onClick={() => handleViewModeChange("week")}
                className={`px-4 py-2 ${
                  viewMode === "week"
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                Week
              </button>
              <button
                onClick={() => handleViewModeChange("day")}
                className={`px-4 py-2 ${
                  viewMode === "day"
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                Day
              </button>
            </div>

          </div>

          <div className="flex items-center gap-2">
            {/* Period Selector (REQ-CAL-F02): range + arrows + week picker, top right */}
            <WeekNav
              label={periodLabel}
              periodStart={currentDate}
              periodEnd={viewMode === "week" ? addDays(currentDate, 6) : currentDate}
              unit={viewMode === "week" ? "week" : "day"}
              onPrevious={handlePrevious}
              onNext={handleNext}
              options={
                viewMode === "week"
                  ? [
                      { label: "This Week", onSelect: handleToday },
                      { label: "Last Week", onSelect: handleLastWeek },
                      {
                        label: "Next Week",
                        onSelect: () =>
                          setCurrentDate(startOfWeek(addDays(new Date(), 7), { weekStartsOn: wsWeekStart })),
                      },
                    ]
                  : [
                      { label: "Today", onSelect: handleToday },
                      { label: "Yesterday", onSelect: () => setCurrentDate(subDays(new Date(), 1)) },
                      { label: "Tomorrow", onSelect: () => setCurrentDate(addDays(new Date(), 1)) },
                    ]
              }
            />
            {/* Zoom Controls (REQ-CAL-F07) */}
            <button
              onClick={() => handleZoom(-ZOOM_STEP)}
              disabled={zoomLevel <= ZOOM_MIN}
              className="p-2 hover:bg-slate-100 rounded disabled:opacity-40"
              aria-label="Zoom out"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
            </button>
            <button
              onClick={() => handleZoom(ZOOM_STEP)}
              disabled={zoomLevel >= ZOOM_MAX}
              className="p-2 hover:bg-slate-100 rounded disabled:opacity-40"
              aria-label="Zoom in"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>

            {/* Settings Button (REQ-CAL-F03) */}
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 hover:bg-slate-100 rounded"
              aria-label="Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Calendar View */}
        {viewMode === "week" ? (
          <CalendarGrid
            currentDate={currentDate}
            entries={entries}
            externalEvents={externalEvents}
            dailyTotals={dailyTotals}
            hourHeight={zoomLevel}
            onSlotClick={handleSlotClick}
            onEntryClick={handleEntryClick}
            onEntryDrag={handleEntryMove}
            onEntryResize={handleEntryMove}
            showWorkingDaysOnly={preferences?.showWorkingDaysOnly || false}
          />
        ) : (
          <DayView
            currentDate={currentDate}
            entries={entries}
            externalEvents={externalEvents}
            dailyTotals={dailyTotals}
            hourHeight={zoomLevel}
            onSlotClick={handleSlotClick}
            onEntryClick={handleEntryClick}
            onEntryDrag={handleEntryMove}
            onEntryResize={handleEntryMove}
          />
        )}
      </div>

      {/* Time Entry Modal (REQ-CAL-F12..F26) */}
      {showEntryModal && (
        <TimeEntryModal
          entry={selectedEntry}
          slot={selectedSlot}
          onSave={handleSaveEntry}
          onDelete={(id) => deleteEntryMutation.mutate(id)}
          onClose={() => {
            setShowEntryModal(false);
            setSelectedEntry(null);
            setSelectedSlot(null);
          }}
        />
      )}

      {/* Settings Modal (REQ-CAL-F29..F37) */}
      {showSettings && (
        <CalendarSettingsModal
          preferences={preferences}
          onSave={(data) => {
            updatePrefsMutation.mutate(data);
            setShowSettings(false);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
