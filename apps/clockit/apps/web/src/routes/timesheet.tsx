import { useMemo, useRef, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { format, startOfWeek } from "date-fns";
import { TimesheetGrid, TimesheetRow, rowKey } from "../components/timesheet/TimesheetGrid";
import { PeriodSelector } from "../components/timesheet/PeriodSelector";
import { toast, confirmDialog } from "../components/ui/notify";
import { useWorkspace, weekStartsOn } from "../lib/workspace";

interface Task {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
  color: string;
  client?: { name: string } | null;
  tasks?: Task[];
}

interface Template {
  id: string;
  name: string;
  createdAt: string;
  projects: any;
}

// A locally added blank row (no entries persisted yet)
interface BlankRow {
  projectId: string;
  taskId: string | null;
}

// A blank row has no description yet, so it keys with an empty one
const blankKey = (b: BlankRow) => `${b.projectId}::${b.taskId ?? ""}::`;

export function Timesheet() {
  const queryClient = useQueryClient();
  // Week boundaries follow the workspace Week start setting
  const workspace = useWorkspace();
  const wsWeekStart = weekStartsOn(workspace);
  // B11: always open on the current week (lazy init runs on every mount)
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: wsWeekStart })
  );
  const [extraRows, setExtraRows] = useState<BlankRow[]>([]);
  // phase/description typed on blank rows before any duration exists
  const [blankMeta, setBlankMeta] = useState<
    Record<string, { phase?: string | null; description?: string }>
  >({});
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  // Admins may select any user and edit that user's (submitted) timesheet
  const [viewUserId, setViewUserId] = useState("");

  const weekKey = format(weekStart, "yyyy-MM-dd");

  const handleWeekChange = (date: Date) => {
    setWeekStart(date);
    setExtraRows([]);
    setBlankMeta({});
  };

  // Realign to the current week when the workspace Week start is loaded or changed
  useEffect(() => {
    setWeekStart(startOfWeek(new Date(), { weekStartsOn: wsWeekStart }));
  }, [wsWeekStart]);

  // I5: admins/owners may edit submitted timesheets (server enforces the same)
  const { data: profile } = useQuery({
    queryKey: ["user-profile"],
    queryFn: async () => (await api.get("/users/me")).data,
  });
  const isAdmin = profile?.role === "ADMIN" || profile?.role === "OWNER";

  const { data: members = [] } = useQuery({
    queryKey: ["timesheet-members"],
    enabled: isAdmin,
    queryFn: async () => (await api.get("/dashboard/team-members")).data,
  });

  const viewingOther = !!viewUserId && viewUserId !== profile?.id;
  const userParams = viewingOther ? { user_id: viewUserId } : {};

  // Close the Select Project dropdown on outside clicks
  useEffect(() => {
    if (!showProjectPicker) return;
    const close = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowProjectPicker(false);
        setExpandedProject(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showProjectPicker]);

  // The viewed user's assigned projects (REQ-TS-B01) — the Select Project
  // picker only offers these, not every project in the organization.
  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["timesheet-projects", weekKey, viewUserId],
    queryFn: async () => {
      const response = await api.get("/timesheet/projects", {
        params: { week_start: weekKey, ...userParams },
      });
      return response.data;
    },
  });

  // Fetch entries (REQ-TS-B02)
  const { data: timesheetData, isLoading } = useQuery({
    queryKey: ["timesheet-entries", weekKey, viewUserId],
    queryFn: async () => {
      const response = await api.get("/timesheet/entries", {
        params: { week_start: weekKey, ...userParams },
      });
      return response.data;
    },
  });

  // Fetch time-off (REQ-TS-B06)
  const { data: timeOff = [] } = useQuery({
    queryKey: ["timesheet-timeoff", weekKey],
    queryFn: async () => {
      const response = await api.get("/timesheet/time-off", {
        params: { week_start: weekKey },
      });
      return response.data;
    },
  });

  // Fetch timesheet status for the viewed user
  const { data: statusData } = useQuery({
    queryKey: ["timesheet-status", weekKey, viewUserId],
    queryFn: async () => {
      const response = await api.get("/timesheet/status", {
        params: { week_start: weekKey, ...userParams },
      });
      return response.data;
    },
  });

  // B13: saved templates
  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ["timesheet-templates"],
    queryFn: async () => (await api.get("/timesheet/templates")).data,
  });

  function invalidateEntries() {
    queryClient.invalidateQueries({ queryKey: ["timesheet-entries"] });
  }

  // Mutations
  const updateEntryMutation = useMutation({
    mutationFn: async (payload: {
      projectId: string;
      taskId: string | null;
      date: string;
      duration: string;
      description?: string;
      phase?: string | null;
    }) => {
      await api.post("/timesheet/entries", {
        ...payload,
        // Offset the browser renders in, so the entry starts at the user's
        // configured Day Start Time in their own timezone
        tzOffsetMinutes: new Date(`${payload.date}T00:00:00`).getTimezoneOffset(),
        ...(viewingOther ? { userId: viewUserId } : {}),
      });
    },
    onSuccess: invalidateEntries,
    onError: (error: any) => {
      toast(error?.response?.data?.error || "Failed to save entry", "error");
      invalidateEntries();
    },
  });

  const rowMetaMutation = useMutation({
    mutationFn: async (payload: {
      projectId: string;
      taskId: string | null;
      description?: string;
      phase?: string | null;
      currentDescription?: string;
    }) => {
      await api.post("/timesheet/row-meta", {
        week_start: weekKey,
        ...payload,
        ...(viewingOther ? { userId: viewUserId } : {}),
      });
    },
    onSuccess: invalidateEntries,
    onError: (error: any) => {
      toast(error?.response?.data?.error || "Failed to save row", "error");
      invalidateEntries();
    },
  });

  // Change a row's sub-task after the row was created
  const rowTaskMutation = useMutation({
    mutationFn: async (payload: {
      projectId: string;
      fromTaskId: string | null;
      toTaskId: string | null;
      description?: string;
    }) => {
      await api.post("/timesheet/row-task", {
        week_start: weekKey,
        ...payload,
        ...(viewingOther ? { userId: viewUserId } : {}),
      });
    },
    onSuccess: invalidateEntries,
    onError: (error: any) => {
      toast(error?.response?.data?.error || "Failed to change the sub-task", "error");
      invalidateEntries();
    },
  });

  // B12: remove an entire project/task row for the week
  const removeRowMutation = useMutation({
    mutationFn: async (payload: { projectId: string; taskId: string | null; description?: string }) => {
      await api.delete("/timesheet/rows", {
        params: {
          week_start: weekKey,
          projectId: payload.projectId,
          taskId: payload.taskId ?? "",
          ...userParams,
        },
      });
    },
    onSuccess: invalidateEntries,
    onError: (error: any) => {
      toast(error?.response?.data?.error || "Failed to remove row", "error");
    },
  });

  const copyLastWeekMutation = useMutation({
    mutationFn: async () => {
      await api.post("/timesheet/copy-last-week", { week_start: weekKey });
    },
    onSuccess: invalidateEntries,
    onError: (error: any) => {
      toast(error?.response?.data?.error || "Failed to copy last week", "error");
    },
  });

  // B13: save / apply / remove templates
  const saveTemplateMutation = useMutation({
    mutationFn: async (payload: { name: string; includeTimes: boolean }) => {
      await api.post("/timesheet/templates", {
        week_start: weekKey,
        name: payload.name,
        includeTimes: payload.includeTimes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timesheet-templates"] });
    },
    onError: (error: any) => {
      toast(error?.response?.data?.error || "Failed to save template", "error");
    },
  });

  const applyTemplateMutation = useMutation({
    mutationFn: async (id: string) =>
      (
        await api.post(`/timesheet/templates/${id}/apply`, {
          week_start: weekKey,
          tzOffsetMinutes: new Date(`${weekKey}T00:00:00`).getTimezoneOffset(),
        })
      ).data,
    onSuccess: (result: any) => {
      // Rows saved without times come back so they can appear as blank rows
      const blank: BlankRow[] = (result?.rows ?? [])
        .filter((r: any) => !Object.keys(r.dayDurations ?? {}).length)
        .map((r: any) => ({ projectId: r.projectId, taskId: r.taskId ?? null }));
      if (blank.length) {
        setExtraRows((prev) => {
          const seen = new Set(prev.map(blankKey));
          return [...prev, ...blank.filter((b) => !seen.has(blankKey(b)))];
        });
      }
      invalidateEntries();
    },
    onError: (error: any) => {
      toast(error?.response?.data?.error || "Failed to apply template", "error");
    },
  });

  const removeTemplateMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/timesheet/templates/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["timesheet-templates"] }),
    onError: (error: any) => {
      toast(error?.response?.data?.error || "Failed to remove template", "error");
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      await api.post("/timesheet/submit", { week_start: weekKey });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timesheet-status"] });
      toast("Timesheet submitted for approval!", "success");
    },
    onError: (error: any) => {
      toast(error?.response?.data?.error || "Failed to submit timesheet", "error");
    },
  });

  // I5: admin-only — set a submitted/approved week back to DRAFT
  const reopenMutation = useMutation({
    mutationFn: async () => {
      await api.post("/timesheet/reopen", {
        week_start: weekKey,
        ...(viewingOther ? { user_id: viewUserId } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timesheet-status"] });
    },
    onError: (error: any) => {
      toast(error?.response?.data?.error || "Failed to reopen timesheet", "error");
    },
  });

  const status: string = statusData?.status || "DRAFT";
  const isSubmitted = status === "SUBMITTED" || status === "APPROVED";
  // Submitted/approved weeks lock the grid — except for admins/owners (I5)
  const isLocked = isSubmitted && !isAdmin;

  const serverRows: TimesheetRow[] = timesheetData?.entries || [];

  // Rows are only what the week actually contains (server rows) plus rows the
  // user explicitly added via Select Project — no projects appear by default.
  const rows: TimesheetRow[] = useMemo(() => {
    const existing = new Set(serverRows.map((r) => rowKey(r)));
    const toRow = (b: BlankRow): TimesheetRow => {
      const project = projects.find((p) => p.id === b.projectId);
      const task = project?.tasks?.find((t) => t.id === b.taskId);
      const meta = blankMeta[blankKey(b)] ?? {};
      return {
        projectId: b.projectId,
        taskId: b.taskId,
        projectName: project?.name || "Unknown project",
        projectColor: project?.color || "#94a3b8",
        clientName: project?.client?.name || null,
        taskName: task?.name ?? null,
        phase: meta.phase ?? null,
        description: meta.description ?? "",
        entries: {},
        total: 0,
      };
    };
    const blanks = extraRows.filter((b) => !existing.has(blankKey(b)));
    return [...serverRows, ...blanks.map(toRow)];
  }, [serverRows, extraRows, projects, blankMeta]);

  const handleDurationChange = (row: TimesheetRow, date: string, duration: string) => {
    // An emptied cell deletes the entry (server treats 0:00 as delete)
    updateEntryMutation.mutate({
      projectId: row.projectId,
      taskId: row.taskId,
      date,
      duration: duration === "" ? "0:00" : duration,
      description: row.description || undefined,
      phase: (row.phase as any) ?? undefined,
    });
  };

  // I-A: phase/description edits apply to the whole row for this week
  const handleRowMetaChange = (
    row: TimesheetRow,
    meta: { phase?: string | null; description?: string }
  ) => {
    const key = rowKey(row);
    const hasEntries = Object.keys(row.entries).length > 0;
    if (!hasEntries) {
      // Blank row: keep locally, persisted with the first duration entered
      setBlankMeta((prev) => ({ ...prev, [key]: { ...prev[key], ...meta } }));
      return;
    }
    rowMetaMutation.mutate({
      projectId: row.projectId,
      taskId: row.taskId,
      // Identifies which row is being edited — rows on the same project+task
      // are told apart by their description
      currentDescription: row.description ?? "",
      ...meta,
    } as any);
  };

  // A row's sub-task stays editable: blank rows change locally, rows with
  // entries move the week's entries onto the newly selected task.
  const handleRowTaskChange = (row: TimesheetRow, taskId: string | null) => {
    const key = rowKey(row);
    const hasEntries = Object.keys(row.entries).length > 0;
    if (!hasEntries) {
      setExtraRows((prev) =>
        prev.map((b) => (blankKey(b) === key ? { ...b, taskId } : b))
      );
      setBlankMeta((prev) => {
        const next = { ...prev };
        if (next[key]) {
          next[`${row.projectId}::${taskId ?? ""}`] = next[key];
          delete next[key];
        }
        return next;
      });
      return;
    }
    rowTaskMutation.mutate({
      projectId: row.projectId,
      fromTaskId: row.taskId,
      toTaskId: taskId,
      description: row.description ?? "",
    });
  };

  // B12: remove a row (confirm, then delete the week's entries for it)
  const handleRemoveRow = (row: TimesheetRow) => {
    const key = rowKey(row);
    const hasEntries = Object.keys(row.entries).length > 0;
    if (!hasEntries) {
      setExtraRows((prev) => prev.filter((b) => blankKey(b) !== key));
      setBlankMeta((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    const label = row.taskName ? `${row.projectName} • ${row.taskName}` : row.projectName;
    confirmDialog({
      title: "Remove row",
      message: `Remove the "${label}" row? All of its time entries for this week will be deleted.`,
      confirmLabel: "Remove",
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      removeRowMutation.mutate({ projectId: row.projectId, taskId: row.taskId, description: row.description ?? "" });
      setExtraRows((prev) => prev.filter((b) => blankKey(b) !== key));
    });
  };

  // I15: add a project (optionally with one of its tasks) as a row
  const handleAddRow = (projectId: string, taskId: string | null) => {
    const key = `${projectId}::${taskId ?? ""}::`;
    const exists =
      rows.some((r) => rowKey(r) === key) || extraRows.some((b) => blankKey(b) === key);
    if (!exists) setExtraRows((prev) => [...prev, { projectId, taskId }]);
    setShowProjectPicker(false);
    setExpandedProject(null);
  };

  const handleCopyLastWeek = async () => {
    if (await confirmDialog({ title: "Copy last week", message: "Copy last week's entries to this week?", confirmLabel: "Copy" })) {
      copyLastWeekMutation.mutate();
    }
  };

  const handleSubmit = async () => {
    if (
      await confirmDialog({
        title: "Submit timesheet",
        message: "Submit this timesheet for approval? You won't be able to edit it.",
        confirmLabel: "Submit",
      })
    ) {
      submitMutation.mutate();
    }
  };

  return (
    <div className="p-6 max-w-[96rem] mx-auto">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Timesheet</h1>
          <p className="text-slate-600 mt-1">Track your time by project and day</p>
        </div>
        {/* Admins may pick any user and edit that user's (submitted) timesheet */}
        {isAdmin && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-500">Timesheet of</label>
            <select
              className="border rounded px-2 py-1.5 text-sm"
              value={viewUserId}
              onChange={(e) => {
                setViewUserId(e.target.value);
                setExtraRows([]);
                setBlankMeta({});
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
      </div>

      {viewingOther && (
        <div className="mb-4 px-4 py-2 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
          You are editing {members.find((m: any) => m.id === viewUserId)?.name ?? "another user"}'s
          timesheet{isSubmitted ? " (submitted — your admin role allows editing)" : ""}.
        </div>
      )}

      <div className="bg-white rounded-lg shadow">
        {/* Period Selector (REQ-TS-F01) — range + arrows + week picker, top right */}
        <PeriodSelector weekStart={weekStart} onWeekChange={handleWeekChange} />

        {/* Action Bar */}
        <div className="border-b px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={handleCopyLastWeek}
              disabled={isLocked || viewingOther}
              className="px-4 py-2 border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Copy last week
            </button>
          </div>
          <div className="flex items-center gap-3">
            {isSubmitted && (
              <span className="px-3 py-1 bg-green-100 text-green-700 rounded text-sm font-medium">
                {status === "APPROVED" ? "Approved" : "Submitted"}
              </span>
            )}
            {isSubmitted && isAdmin && (
              <>
                <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded text-sm font-medium">
                  Editing as admin
                </span>
                <button
                  onClick={() => reopenMutation.mutate()}
                  disabled={reopenMutation.isPending}
                  className="px-4 py-2 border border-amber-400 text-amber-700 rounded hover:bg-amber-50 disabled:opacity-50"
                >
                  Reopen
                </button>
              </>
            )}
            {status === "REJECTED" && (
              <span className="px-3 py-1 bg-red-100 text-red-700 rounded text-sm font-medium">
                Rejected
              </span>
            )}
            <button
              onClick={handleSubmit}
              disabled={isSubmitted || viewingOther}
              className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Submit
            </button>
          </div>
        </div>

        {/* Timesheet Grid (REQ-TS-F02..F08, F15) */}
        {isLoading ? (
          <div className="p-12 text-center text-slate-500">Loading...</div>
        ) : (
          <TimesheetGrid
            rows={rows}
            totals={timesheetData?.totals || { dailyTotals: {}, grandTotal: "0:00" }}
            timeOff={timeOff}
            weekStart={weekStart}
            onDurationChange={handleDurationChange}
            onRowMetaChange={handleRowMetaChange}
            onRemoveRow={handleRemoveRow}
            projects={projects}
            onRowTaskChange={handleRowTaskChange}
            disabled={isLocked}
          />
        )}

        {/* I15: Select Project field below the Project column — dropdown with
            every available project and its tasks */}
        <div className="px-4 py-3 border-t relative" ref={pickerRef}>
          <button
            onClick={() => setShowProjectPicker((v) => !v)}
            disabled={isLocked}
            className="px-4 py-2 border border-dashed border-slate-300 text-slate-600 rounded hover:bg-slate-50 hover:text-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
              />
            </svg>
            Select project
            <svg className={`w-3 h-3 transition-transform ${showProjectPicker ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showProjectPicker && (
            <div className="absolute left-4 bottom-full mb-1 z-30 bg-white border rounded-lg shadow-xl w-80 max-h-96 overflow-y-auto">
              {projects.length === 0 ? (
                <p className="text-sm text-slate-500 px-4 py-3">
                  You are not assigned to any project yet.
                </p>
              ) : (
                projects.map((project) => (
                  <div key={project.id} className="border-b last:border-b-0">
                    <div className="flex items-center">
                      {/* Clicking the project name reveals its subtasks; a
                          project without subtasks is added straight away */}
                      <button
                        onClick={() => {
                          if ((project.tasks?.length ?? 0) > 0) {
                            setExpandedProject((cur) => (cur === project.id ? null : project.id));
                          } else {
                            handleAddRow(project.id, null);
                          }
                        }}
                        className="flex-1 text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-3"
                      >
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: project.color }}
                        />
                        <div className="min-w-0">
                          <div className="font-medium truncate">{project.name}</div>
                          <div className="text-xs text-slate-500 truncate">
                            {project.client ? `${project.client.name} · ` : ""}
                            {(project.tasks?.length ?? 0) > 0
                              ? `${project.tasks!.length} sub-task${project.tasks!.length > 1 ? "s" : ""}`
                              : "No sub-tasks"}
                          </div>
                        </div>
                        {(project.tasks?.length ?? 0) > 0 && (
                          <span className="ml-auto text-slate-400">
                            {expandedProject === project.id ? "▾" : "▸"}
                          </span>
                        )}
                      </button>
                    </div>
                    {expandedProject === project.id && (
                      <>
                        <button
                          onClick={() => handleAddRow(project.id, null)}
                          className="w-full text-left pl-11 pr-4 py-2 text-sm border-t hover:bg-slate-50 text-slate-600"
                        >
                          Without sub-task
                        </button>
                        {project.tasks?.map((task) => (
                          <button
                            key={task.id}
                            onClick={() => handleAddRow(project.id, task.id)}
                            className="w-full text-left pl-11 pr-4 py-2 text-sm border-t hover:bg-slate-50"
                          >
                            {task.name}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* B13: templates live below the timesheet table — save the current week
          (optionally with times), then apply or remove saved templates */}
      <div className="bg-white rounded-lg shadow mt-6 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Timesheet templates</h2>
        <TemplatesSection
          templates={templates}
          saving={saveTemplateMutation.isPending}
          onSave={(name, includeTimes) => saveTemplateMutation.mutate({ name, includeTimes })}
          onApply={(id) => applyTemplateMutation.mutate(id)}
          onRemove={async (id) => {
            if (await confirmDialog({ title: "Remove template", message: "Remove this template?", confirmLabel: "Remove", danger: true })) {
              removeTemplateMutation.mutate(id);
            }
          }}
          applyDisabled={isLocked || viewingOther}
        />
      </div>
    </div>
  );
}

function TemplatesSection({
  templates,
  saving,
  onSave,
  onApply,
  onRemove,
  applyDisabled,
}: {
  templates: Template[];
  saving: boolean;
  onSave: (name: string, includeTimes: boolean) => void;
  onApply: (id: string) => void;
  onRemove: (id: string) => void;
  applyDisabled: boolean;
}) {
  const [name, setName] = useState("");
  const [includeTimes, setIncludeTimes] = useState(true);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Save current week as a template */}
      <div className="border rounded p-4">
        <div className="font-medium text-slate-700 mb-2">Save this week as a template</div>
        <div className="flex items-center gap-2">
          <input
            className="flex-1 border rounded px-3 py-2 text-sm"
            placeholder="Template name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim() && !saving) {
                onSave(name.trim(), includeTimes);
                setName("");
              }
            }}
          />
          <button
            disabled={!name.trim() || saving}
            onClick={() => {
              onSave(name.trim(), includeTimes);
              setName("");
            }}
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            Save
          </button>
        </div>
        <label className="flex items-center gap-2 mt-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={includeTimes}
            onChange={(e) => setIncludeTimes(e.target.checked)}
          />
          Save time (keep each day's hours; untick to save only the rows)
        </label>
      </div>

      {/* Saved templates with Apply / Remove */}
      <div>
        <div className="font-medium text-slate-700 mb-2">Saved templates</div>
        <div className="max-h-64 overflow-y-auto space-y-2">
          {templates.length === 0 ? (
            <p className="text-sm text-slate-500">No templates saved yet.</p>
          ) : (
            templates.map((t) => (
              <div key={t.id} className="flex items-center justify-between border rounded px-4 py-2">
                <div>
                  <div className="font-medium text-slate-800">{t.name}</div>
                  <div className="text-xs text-slate-500">
                    Saved {new Date(t.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onApply(t.id)}
                    disabled={applyDisabled}
                    className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Apply
                  </button>
                  <button
                    onClick={() => onRemove(t.id)}
                    className="px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
