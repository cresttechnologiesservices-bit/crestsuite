import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { EntryBar } from "../components/tracker/EntryBar";
import { EntryRow } from "../components/tracker/EntryRow";
import { Pagination } from "../components/tracker/Pagination";
import { BulkEditModal, BulkChanges } from "../components/tracker/BulkEditModal";
import {
  dateKey,
  dayLabel,
  entrySeconds,
  fmtHM,
  weekLabel,
  weekStartKey,
} from "../components/tracker/format";
import { confirmDialog } from "../components/ui/notify";
import { useCustomFields, defaultValuesFor } from "../components/customFields/CustomFieldInputs";

function errMessage(e: any) {
  const data = e?.response?.data;
  // Custom field problems come back per field — show them verbatim
  if (data?.error === "custom_field_validation" && Array.isArray(data.errors)) {
    return data.errors.map((x: any) => x.message).join(" · ");
  }
  const code = data?.error;
  // The server explains day-specific problems better than a generic message
  if (data?.message) return data.message;
  if (code === "overlap") return "This time range overlaps an existing entry.";
  if (code === "end_before_start") return "End time must be after start time.";
  if (code === "end_or_duration_required") return "Please provide an end time.";
  if (code === "admin_entries_billable_only") return "Another administrator's entries: only the billable status can be changed.";
  return "Something went wrong.";
}

export function Tracker() {
  const queryClient = useQueryClient();
  const [desc, setDesc] = useState("");
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [billable, setBillable] = useState(false);
  // Active custom fields for time entries, and the values for the next entry
  const customFieldDefs = useCustomFields("timeEntry");
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, any>>({});
  useEffect(() => {
    setCustomFieldValues((cur) => (Object.keys(cur).length ? cur : defaultValuesFor(customFieldDefs)));
  }, [customFieldDefs]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  // I16: bulk selection + modal
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  // Admins may view (and edit, server-enforced) a member's entries
  const [viewUserId, setViewUserId] = useState("");

  const { data: profile } = useQuery({
    queryKey: ["user-profile"],
    queryFn: async () => (await api.get("/users/me")).data,
  });
  const isAdmin = profile?.role === "ADMIN" || profile?.role === "OWNER";

  const { data: members = [] } = useQuery({
    queryKey: ["tracker-members"],
    enabled: isAdmin,
    queryFn: async () => (await api.get("/dashboard/team-members")).data,
  });

  const viewingOther = !!viewUserId && viewUserId !== profile?.id;

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data } = await api.get("/projects");
      return Array.isArray(data) ? data : data.items ?? [];
    },
  });

  // I14: tasks of the currently selected project
  const { data: projectTasks = [] } = useQuery({
    queryKey: ["project-tasks", projectId],
    enabled: !!projectId,
    queryFn: async () => (await api.get(`/projects/${projectId}/tasks`)).data,
  });

  function selectProject(id: string) {
    setProjectId(id);
    setTaskId(""); // a task belongs to one project
  }

  // REQ-TT-B12: running timer is persisted server-side and survives refresh
  const { data: running } = useQuery({
    queryKey: ["running-timer"],
    queryFn: async () => (await api.get("/time-entries/running")).data,
  });

  const { data: entriesData } = useQuery({
    queryKey: ["time-entries", page, pageSize, viewUserId],
    queryFn: async () =>
      (await api.get("/time-entries", {
        params: {
          page,
          page_size: pageSize,
          // The offset the entries are being grouped by on screen, so the
          // server measures overtime over the same days the user sees
          tzOffsetMinutes: new Date().getTimezoneOffset(),
          ...(viewingOther ? { user_id: viewUserId } : {}),
        },
      })).data,
  });

  // "billable-only" when the viewed member is another admin (I6)
  const entryListAccess: "full" | "billable-only" = entriesData?.access ?? "full";

  // REQ-TT-F05: tick every second while a timer is running
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const elapsed = running ? Math.floor((now - new Date(running.start).getTime()) / 1000) : 0;

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["time-entries"] });
    queryClient.invalidateQueries({ queryKey: ["running-timer"] });
  }

  const startMutation = useMutation({
    mutationFn: async (payload: any) => (await api.post("/time-entries/start", payload)).data,
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e) => setError(errMessage(e)),
  });

  const stopMutation = useMutation({
    mutationFn: async () => (await api.post("/time-entries/stop")).data,
    onSuccess: () => {
      setDesc("");
      setTags([]);
      setBillable(false);
      setProjectId("");
      setTaskId("");
      invalidate();
    },
  });

  const manualMutation = useMutation({
    mutationFn: async (payload: any) => (await api.post("/time-entries", payload)).data,
    onSuccess: () => {
      setError(null);
      setDesc("");
      invalidate();
    },
    onError: (e) => setError(errMessage(e)),
  });

  const patchMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) =>
      (await api.patch(`/time-entries/${id}`, data)).data,
    onSuccess: invalidate,
    onError: (e) => {
      setError(errMessage(e));
      invalidate(); // reset any inline-edited fields to the persisted values
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/time-entries/${id}`),
    onSuccess: invalidate,
  });

  const duplicateMutation = useMutation({
    mutationFn: async (id: string) => (await api.post(`/time-entries/${id}/duplicate`)).data,
    onSuccess: invalidate,
    onError: (e) => setError(errMessage(e)),
  });

  const splitMutation = useMutation({
    mutationFn: async (id: string) => (await api.post(`/time-entries/${id}/split`)).data,
    onSuccess: invalidate,
    onError: (e) => setError(errMessage(e)),
  });

  const createProjectMutation = useMutation({
    mutationFn: async (name: string) => (await api.post("/projects", { name })).data,
    onSuccess: (project: any) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setProjectId(project.id);
    },
  });

  function handleStart() {
    startMutation.mutate({
      description: desc,
      projectId: projectId || null,
      taskId: taskId || null,
      tags,
      billable,
      customFields: customFieldValues,
    });
  }

  // REQ-TT-F11: resume starts a new timer pre-filled from the entry
  function handleResume(entry: any) {
    setDesc(entry.description);
    setProjectId(entry.projectId ?? "");
    setTaskId(entry.taskId ?? "");
    setBillable(entry.billable);
    const cleanTags = (entry.tags ?? []).filter((t: string) => t !== "Overtime");
    setTags(cleanTags);
    startMutation.mutate({
      description: entry.description,
      projectId: entry.projectId ?? null,
      taskId: entry.taskId ?? null,
      tags: cleanTags,
      billable: entry.billable,
    });
  }

  function handleManualAdd(start: string, end: string) {
    manualMutation.mutate({
      description: desc,
      projectId: projectId || null,
      taskId: taskId || null,
      tags,
      billable,
      start,
      end,
      customFields: customFieldValues,
    });
  }

  // REQ-TT-F14: move an entry to another date, preserving its time of day.
  // If the target date already has entries in that slot, the server shifts the
  // moved entry after them so it is added as a separate entry (resolveOverlap).
  function handleChangeDate(entry: any, newDate: string) {
    const start = new Date(entry.start);
    const newStart = new Date(`${newDate}T00:00:00`);
    newStart.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
    const delta = newStart.getTime() - start.getTime();
    const data: any = { start: newStart.toISOString(), resolveOverlap: true };
    if (entry.end) data.end = new Date(new Date(entry.end).getTime() + delta).toISOString();
    patchMutation.mutate({ id: entry.id, data });
  }

  // Billable status is toggled straight from the $ icon on the row
  function handleToggleBillable(entry: any) {
    patchMutation.mutate({ id: entry.id, data: { billable: !entry.billable } });
  }

  // The Project label on a row ("No project" or a project name) is editable,
  // including the project's task — always picked from the project's task list.
  function handleChangeProject(entry: any, projectId: string | null, taskId: string | null) {
    patchMutation.mutate({ id: entry.id, data: { projectId, taskId } });
  }

  // Edit the recorded start/end of an existing entry; the duration follows
  // from the new range and the server keeps validating order and overlaps.
  function handleChangeTime(entry: any, field: "start" | "end", hhmm: string) {
    const [hours, minutes] = hhmm.split(":").map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return;
    const base = new Date(field === "end" && entry.end ? entry.end : entry.start);
    base.setHours(hours, minutes, 0, 0);
    patchMutation.mutate({ id: entry.id, data: { [field]: base.toISOString() } });
  }

  async function handleDelete(id: string) {
    if (
      await confirmDialog({
        title: "Delete time entry",
        message: "Delete this time entry?",
        confirmLabel: "Delete",
        danger: true,
      })
    ) {
      deleteMutation.mutate(id);
    }
  }

  // Edit an entry's duration in place: keep the start, move the end.
  function handleChangeDuration(entry: any, seconds: number) {
    if (!entry.end || seconds <= 0) return;
    const end = new Date(new Date(entry.start).getTime() + seconds * 1000);
    patchMutation.mutate({ id: entry.id, data: { end: end.toISOString() } });
  }

  // I3: inline description edit, committed on blur/Enter
  function handleChangeDescription(entry: any, description: string) {
    patchMutation.mutate({ id: entry.id, data: { description } });
  }

  // I16: bulk selection helpers
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allEntries: any[] = entriesData?.items ?? [];
  const selectedEntries = allEntries.filter((e) => selectedIds.has(e.id));

  async function handleBulkDelete() {
    if (!selectedEntries.length) return;
    if (
      !(await confirmDialog({
        title: "Delete entries",
        message: `Delete ${selectedEntries.length} selected entries?`,
        confirmLabel: "Delete",
        danger: true,
      }))
    ) {
      return;
    }
    const results = await Promise.allSettled(
      selectedEntries.map((e) => api.delete(`/time-entries/${e.id}`))
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) setError(`${failed} entries could not be deleted.`);
    setSelectedIds(new Set());
    invalidate();
  }

  async function handleBulkApply(changes: BulkChanges) {
    setBulkOpen(false);
    const results = await Promise.allSettled(
      selectedEntries.map((e) => {
        const data: any = {};
        if (changes.description !== undefined) data.description = changes.description;
        if (changes.projectId !== undefined) {
          data.projectId = changes.projectId;
          data.taskId = null; // a task belongs to one project
        }
        if (changes.billable !== undefined) data.billable = changes.billable;
        if (changes.tags !== undefined) data.tags = changes.tags;
        if (changes.date !== undefined || changes.startTime !== undefined) {
          const start = new Date(e.start);
          const newStart = new Date(start);
          if (changes.date !== undefined) {
            const [y, m, d] = changes.date.split("-").map(Number);
            newStart.setFullYear(y, m - 1, d);
          }
          if (changes.startTime !== undefined) {
            const [hh, mm] = changes.startTime.split(":").map(Number);
            newStart.setHours(hh, mm, start.getSeconds(), 0);
          }
          data.start = newStart.toISOString();
          if (e.end) {
            const duration = new Date(e.end).getTime() - start.getTime();
            data.end = new Date(newStart.getTime() + duration).toISOString();
          }
        }
        return api.patch(`/time-entries/${e.id}`, data);
      })
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    setError(failed ? `${failed} of ${selectedEntries.length} entries could not be updated (overlap?).` : null);
    setSelectedIds(new Set());
    invalidate();
  }

  // REQ-TT-F09: day sections with per-day totals, grouped under the calendar
  // week each entry's date actually belongs to (not always "This week").
  const weeks = useMemo(() => {
    const items: any[] = entriesData?.items ?? [];
    const byDay = new Map<string, any[]>();
    for (const e of items) {
      const key = dateKey(e.start);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(e);
    }
    const days = Array.from(byDay.entries()).map(([key, list]) => ({
      key,
      label: dayLabel(key),
      entries: list,
      totalSeconds: list.reduce((sum, e) => sum + (e.end ? entrySeconds(e) : 0), 0),
    }));

    const byWeek = new Map<string, { key: string; label: string; days: typeof days; totalSeconds: number }>();
    for (const day of days) {
      const key = weekStartKey(day.key);
      if (!byWeek.has(key)) byWeek.set(key, { key, label: weekLabel(key), days: [], totalSeconds: 0 });
      const week = byWeek.get(key)!;
      week.days.push(day);
      week.totalSeconds += day.totalSeconds;
    }
    // Entries arrive most-recent-first, so both levels are already ordered
    return Array.from(byWeek.values());
  }, [entriesData]);

  const weekTotal = entriesData?.weekTotalSeconds ?? 0;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Admins can inspect and edit a member's entries (other admins: $ only) */}
      {isAdmin && (
        <div className="flex items-center justify-end gap-2 mb-3">
          <label className="text-sm text-slate-500">Viewing entries of</label>
          <select
            className="border rounded px-2 py-1.5 text-sm"
            value={viewUserId}
            onChange={(e) => {
              setViewUserId(e.target.value);
              setPage(1);
              setSelectedIds(new Set());
            }}
          >
            <option value="">Me</option>
            {members
              .filter((m: any) => m.id !== profile?.id)
              .map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </div>
      )}
      {viewingOther && (
        <div className="mb-3 px-4 py-2 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
          You are viewing another member's entries.
          {entryListAccess === "billable-only"
            ? " This member is an administrator — only the billable status ($) can be changed."
            : " You can edit these entries; the timer bar below still tracks your own time."}
        </div>
      )}
      <EntryBar
        projects={projects}
        tasks={projectTasks}
        running={running}
        elapsed={elapsed}
        desc={desc}
        setDesc={setDesc}
        projectId={projectId}
        setProjectId={selectProject}
        taskId={taskId}
        setTaskId={setTaskId}
        tags={tags}
        setTags={setTags}
        billable={billable}
        setBillable={setBillable}
        onStart={handleStart}
        onStop={() => stopMutation.mutate()}
        onManualAdd={handleManualAdd}
        onCreateProject={(name) => createProjectMutation.mutate(name)}
        canCreateProject={isAdmin}
        customFieldDefs={customFieldDefs}
        customFieldValues={customFieldValues}
        setCustomFieldValues={setCustomFieldValues}
        error={error}
      />

      {/* REQ-TT-F08: current-week total header + I16 bulk actions */}
      <div className="flex items-center justify-between mt-6 mb-3">
        <h2 className="text-lg font-semibold text-slate-700">Time entries</h2>
        <div className="flex items-center gap-3">
          {selectedIds.size > 0 && (
            <>
              <span className="text-sm text-slate-600">{selectedIds.size} selected</span>
              <button
                onClick={() => setBulkOpen(true)}
                className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700"
              >
                Bulk Edit
              </button>
              <button
                onClick={handleBulkDelete}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700"
              >
                Delete
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50"
              >
                Clear
              </button>
            </>
          )}
          <span className="text-sm text-slate-500">
            This week: <span className="font-mono font-semibold text-slate-800">{fmtHM(weekTotal)}</span>
          </span>
        </div>
      </div>

      {/* Entries are grouped by the calendar week their date belongs to */}
      <div className="space-y-6">
        {weeks.length === 0 && (
          <div className="bg-white border rounded-lg p-8 text-center text-slate-400">
            No time entries yet. Start the timer or add one manually.
          </div>
        )}
        {weeks.map((week) => (
          <div key={week.key}>
            <div className="flex items-center justify-between mb-2 px-1">
              <h3 className="text-sm font-semibold text-slate-700">{week.label}</h3>
              <span className="text-xs text-slate-500">
                Total:{" "}
                <span className="font-mono font-semibold text-slate-700">
                  {fmtHM(week.totalSeconds)}
                </span>
              </span>
            </div>
            <div className="space-y-4">
              {week.days.map((day) => (
          <div key={day.key} className="bg-white border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b">
              <span className="font-semibold text-sm text-slate-600">{day.label}</span>
              <span className="text-sm text-slate-500">
                Total: <span className="font-mono font-semibold">{fmtHM(day.totalSeconds)}</span>
              </span>
            </div>
            {day.entries.map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                selected={selectedIds.has(e.id)}
                onToggleSelect={toggleSelect}
                onResume={handleResume}
                onSplit={(id) => splitMutation.mutate(id)}
                onDuplicate={(id) => duplicateMutation.mutate(id)}
                onDelete={handleDelete}
                onChangeDate={handleChangeDate}
                onChangeDuration={handleChangeDuration}
                onChangeDescription={handleChangeDescription}
                onToggleBillable={handleToggleBillable}
                projects={projects}
                onChangeProject={handleChangeProject}
                onChangeTime={handleChangeTime}
                access={entryListAccess}
                isOwn={!viewingOther}
              />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {bulkOpen && (
        <BulkEditModal
          count={selectedEntries.length}
          projects={projects}
          onApply={handleBulkApply}
          onClose={() => setBulkOpen(false)}
        />
      )}

      <Pagination
        page={page}
        pageSize={pageSize}
        total={entriesData?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          // REQ-TT-F20: changing page size resets to the first page
          setPageSize(size);
          setPage(1);
        }}
      />
    </div>
  );
}
