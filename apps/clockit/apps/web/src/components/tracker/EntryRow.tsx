import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { dateKey, entrySeconds, fmtHM, parseDuration } from "./format";

interface Props {
  entry: any;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onResume: (entry: any) => void;
  onSplit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onChangeDate: (entry: any, newDate: string) => void;
  onChangeDuration: (entry: any, seconds: number) => void;
  onChangeDescription: (entry: any, description: string) => void;
  onToggleBillable: (entry: any) => void;
  /** Available projects for the inline project + task editor */
  projects?: any[];
  onChangeProject?: (entry: any, projectId: string | null, taskId: string | null) => void;
  /** Edit the recorded start/end of an existing entry ("HH:mm", local time) */
  onChangeTime?: (entry: any, field: "start" | "end", hhmm: string) => void;
  /** "full" = all edits; "billable-only" = only the $ toggle (another admin's entry) */
  access?: "full" | "billable-only";
  /** True when the row belongs to the signed-in user (enables resume/split/duplicate) */
  isOwn?: boolean;
}

/** ISO timestamp -> "HH:mm" in local time (the shape <input type="time"> wants) */
function toTimeValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Editable start/end of an existing entry. Committing re-sends the timestamp
 * on the entry's own date; the server keeps enforcing overlap/order rules and
 * the duration is recalculated from the new range.
 */
function TimeRangeField({
  entry,
  readOnly,
  onChangeTime,
}: {
  entry: any;
  readOnly?: boolean;
  onChangeTime?: (entry: any, field: "start" | "end", hhmm: string) => void;
}) {
  const startValue = toTimeValue(entry.start);
  const endValue = toTimeValue(entry.end);
  const editable = !readOnly && !!onChangeTime;

  const field = (which: "start" | "end", value: string) => (
    <input
      key={`${which}-${value}`}
      type="time"
      defaultValue={value}
      disabled={!editable}
      title={editable ? `Edit ${which} time` : which === "start" ? "Start time" : "End time"}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = value;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const next = e.currentTarget.value;
        // Show the persisted value until the server confirms (the field
        // re-mounts via its key once the refetch lands).
        e.currentTarget.value = value;
        if (!next || next === value) return;
        onChangeTime!(entry, which, next);
      }}
      // Wide enough for a 12-hour locale ("07:30 AM") plus the picker icon
      className="w-[108px] min-w-[108px] bg-transparent border border-transparent rounded px-1.5 py-0.5 text-sm text-slate-500 hover:border-slate-300 focus:border-indigo-500 focus:outline-none disabled:hover:border-transparent"
    />
  );

  return (
    <div className="flex items-center gap-0.5 whitespace-nowrap shrink-0">
      {field("start", startValue)}
      <span className="text-slate-400">-</span>
      {entry.end ? (
        field("end", endValue)
      ) : (
        <span className="text-sm text-slate-500 w-[108px] px-1.5">now</span>
      )}
    </div>
  );
}

/** Tasks of one project, loaded when its row is expanded in the picker. */
function ProjectTaskOptions({
  projectId,
  selectedTaskId,
  onSelect,
}: {
  projectId: string;
  selectedTaskId: string | null;
  onSelect: (taskId: string | null) => void;
}) {
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["project-tasks", projectId],
    queryFn: async () => (await api.get(`/projects/${projectId}/tasks`)).data,
  });

  if (isLoading) return <div className="pl-9 pr-3 py-1.5 text-xs text-slate-400">Loading tasks…</div>;
  if (!tasks.length) {
    return <div className="pl-9 pr-3 py-1.5 text-xs text-slate-400">No tasks in this project</div>;
  }
  return (
    <>
      <button
        onClick={() => onSelect(null)}
        className={`w-full text-left pl-9 pr-3 py-1.5 text-xs hover:bg-slate-50 ${
          selectedTaskId ? "text-slate-600" : "text-indigo-600 font-medium"
        }`}
      >
        No task
      </button>
      {tasks.map((t: any) => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          className={`w-full text-left pl-9 pr-3 py-1.5 text-xs hover:bg-slate-50 truncate ${
            selectedTaskId === t.id ? "text-indigo-600 font-medium" : "text-slate-600"
          }`}
        >
          {t.name}
        </button>
      ))}
    </>
  );
}

// Editable duration for a completed entry: commit on Enter/blur, revert on
// Escape or invalid input. Keyed by the entry's duration so a server update
// resets the field to the persisted value. Displays HH:MM (B15); accepts
// HH:MM, HH:MM:SS, decimal hours ("1.5") and minutes ("45m") — see
// parseDuration (I-B).
function DurationField({
  entry,
  onChangeDuration,
  readOnly,
}: {
  entry: any;
  onChangeDuration: (entry: any, seconds: number) => void;
  readOnly?: boolean;
}) {
  const seconds = entrySeconds(entry);
  const commit = (el: HTMLInputElement) => {
    const parsed = parseDuration(el.value);
    // Show the persisted value until the server confirms the change (the field
    // re-mounts with the new duration once the refetch lands).
    el.value = fmtHM(seconds);
    if (parsed === null || parsed <= 0 || parsed === seconds) return;
    onChangeDuration(entry, parsed);
  };
  return (
    <input
      key={seconds}
      type="text"
      defaultValue={fmtHM(seconds)}
      readOnly={readOnly}
      title={readOnly ? "Duration" : "Duration (HH:MM, HH:MM:SS, 1.5 or 45m) — press Enter to save"}
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = fmtHM(seconds);
          e.currentTarget.blur();
        }
      }}
      className="font-mono font-semibold whitespace-nowrap w-20 text-right bg-transparent border border-transparent rounded px-1 py-0.5 hover:border-slate-300 focus:border-indigo-500 focus:outline-none"
    />
  );
}

// I3: inline-editable description, committed on blur/Enter via PATCH.
function DescriptionField({
  entry,
  onChangeDescription,
  readOnly,
}: {
  entry: any;
  onChangeDescription: (entry: any, description: string) => void;
  readOnly?: boolean;
}) {
  const commit = (el: HTMLInputElement) => {
    if (readOnly) return;
    const next = el.value.trim();
    if (next === (entry.description ?? "")) return;
    onChangeDescription(entry, next);
  };
  return (
    <input
      key={entry.description}
      type="text"
      defaultValue={entry.description}
      placeholder="(no description)"
      readOnly={readOnly}
      title={readOnly ? "Description" : "Click to edit description — press Enter to save"}
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = entry.description ?? "";
          e.currentTarget.blur();
        }
      }}
      className="w-full font-medium truncate bg-transparent border border-transparent rounded px-1 py-0.5 hover:border-slate-300 focus:border-indigo-500 focus:outline-none"
    />
  );
}

// REQ-TT-F10..F14: entry row with select checkbox, project dot, tags, billable, range, duration, resume, menu, date change
export function EntryRow({
  entry,
  selected,
  onToggleSelect,
  onResume,
  onSplit,
  onDuplicate,
  onDelete,
  onChangeDate,
  onChangeDuration,
  onChangeDescription,
  onToggleBillable,
  projects,
  onChangeProject,
  onChangeTime,
  access = "full",
  isOwn = true,
}: Props) {
  const canEdit = access === "full";
  // Project whose task list is expanded inside the project picker
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Both popovers are fixed-positioned so the day card's overflow-hidden
  // cannot clip them on the last row of a day (they open upward when there
  // is not enough room below).
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [projOpen, setProjOpen] = useState(false);
  const [projPos, setProjPos] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const projRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen && !projOpen) return;
    const close = (e: MouseEvent) => {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (projOpen && projRef.current && !projRef.current.contains(e.target as Node)) setProjOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen, projOpen]);

  // Place a fixed popover of the given size next to an anchor, flipping above
  // when it would overflow the bottom of the viewport.
  const placePopover = (anchor: HTMLElement, width: number, height: number) => {
    const r = anchor.getBoundingClientRect();
    const top = r.bottom + height + 8 > window.innerHeight ? Math.max(8, r.top - height - 4) : r.bottom + 4;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    return { top, left };
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 hover:bg-slate-50 group">
      {/* I16: bulk-edit selection */}
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(entry.id)}
        title="Select for bulk edit"
        className="shrink-0 accent-indigo-600"
      />
      <div className="flex-1 min-w-0">
        <DescriptionField entry={entry} onChangeDescription={onChangeDescription} readOnly={!canEdit} />
        {/* Project is editable in place — for "No project" rows and rows that
            already have a project alike (users and admins) */}
        <div className="relative" ref={projRef}>
          <button
            title={canEdit && onChangeProject ? "Click to change project" : undefined}
            disabled={!canEdit || !onChangeProject}
            onClick={(e) => {
              setProjPos(placePopover(e.currentTarget, 224, Math.min(288, ((projects?.length ?? 0) + 1) * 34 + 8)));
              setProjOpen((v) => !v);
            }}
            className={`flex items-center gap-2 text-sm text-slate-500 mt-0.5 px-1 py-0.5 rounded max-w-full ${
              canEdit && onChangeProject ? "hover:bg-slate-100 hover:text-indigo-600 cursor-pointer" : ""
            }`}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: entry.project?.color ?? "#94a3b8" }}
            />
            <span className="truncate">
              {entry.project?.name ?? "No project"}
              {entry.task ? ` • ${entry.task.name}` : ""}
            </span>
          </button>
          {projOpen && projPos && (
            <div
              style={{ position: "fixed", top: projPos.top, left: projPos.left }}
              className="z-30 bg-white border rounded shadow-lg w-64 max-h-72 overflow-y-auto py-1 text-sm"
            >
              <button
                onClick={() => {
                  setProjOpen(false);
                  if (entry.projectId) onChangeProject!(entry, null, null);
                }}
                className={`w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2 ${!entry.projectId ? "text-indigo-600 font-medium" : ""}`}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: "#94a3b8" }} />
                No project
              </button>
              {/* Each project expands to its tasks, so an existing entry's
                  subtask can be picked from the list (never typed free-text) */}
              {(projects ?? []).map((p: any) => (
                <div key={p.id}>
                  <div className="flex items-center">
                    <button
                      onClick={() => {
                        setProjOpen(false);
                        if (entry.projectId !== p.id) onChangeProject!(entry, p.id, null);
                      }}
                      className={`flex-1 text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2 min-w-0 ${
                        entry.projectId === p.id ? "text-indigo-600 font-medium" : ""
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: p.color ?? "#94a3b8" }}
                      />
                      <span className="truncate">{p.name}</span>
                    </button>
                    <button
                      title="Choose a task"
                      onClick={() => setExpandedProject((cur) => (cur === p.id ? null : p.id))}
                      className="px-2 py-1.5 text-slate-400 hover:text-indigo-600"
                    >
                      {expandedProject === p.id ? "▾" : "▸"}
                    </button>
                  </div>
                  {expandedProject === p.id && (
                    <ProjectTaskOptions
                      projectId={p.id}
                      selectedTaskId={entry.projectId === p.id ? entry.taskId ?? null : null}
                      onSelect={(taskId) => {
                        setProjOpen(false);
                        onChangeProject!(entry, p.id, taskId);
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-wrap justify-end">
        {/* REQ-TT-F13: distinct overtime badge. Driven by the server-derived
            flag, not a stored tag, so it clears as soon as the period total
            falls back to the configured capacity. */}
        {entry.overtime && (
          <span className="text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300 rounded px-2 py-0.5">
            Overtime
          </span>
        )}
        {entry.tags
          ?.filter((t: string) => t !== "Overtime")
          .map((t: string) => (
            <span key={t} className="text-xs bg-slate-100 text-slate-600 rounded px-2 py-0.5">
              {t}
            </span>
          ))}
      </div>
      {/* Billable is editable in place — the $ toggles it (admins may toggle any entry) */}
      <button
        title={`${entry.billable ? "Billable" : "Not billable"} — click to change`}
        onClick={() => onToggleBillable(entry)}
        className={`font-semibold px-1 rounded hover:bg-slate-100 ${entry.billable ? "text-emerald-600" : "text-slate-300"}`}
      >
        $
      </button>
      {entry.billableAmount != null && (
        <span className="text-xs text-emerald-700 font-medium">{entry.billableAmount.toFixed(2)}</span>
      )}
      {/* Editable recorded time range — duration follows automatically */}
      <TimeRangeField entry={entry} readOnly={!canEdit} onChangeTime={onChangeTime} />
      {canEdit ? (
        <div className="relative">
          <button
            title="Change date"
            onClick={() => {
              const el = dateRef.current;
              if (!el) return;
              if (typeof el.showPicker === "function") el.showPicker();
              else el.click();
            }}
            className="text-slate-400 hover:text-indigo-600 px-1"
          >
            &#128197;
          </button>
          <input
            ref={dateRef}
            type="date"
            className="absolute opacity-0 w-0 h-0"
            value={dateKey(entry.start)}
            onChange={(e) => e.target.value && onChangeDate(entry, e.target.value)}
          />
        </div>
      ) : null}
      {entry.end ? (
        <DurationField entry={entry} onChangeDuration={onChangeDuration} readOnly={!canEdit} />
      ) : (
        <span className="font-mono font-semibold whitespace-nowrap w-20 text-right">running</span>
      )}
      {isOwn && (
        <button
          title="Resume"
          onClick={() => onResume(entry)}
          className="text-indigo-600 hover:text-indigo-800 px-1 opacity-60 group-hover:opacity-100"
        >
          &#9654;
        </button>
      )}
      {canEdit && (
        <div className="relative" ref={menuRef}>
          <button
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pos = placePopover(e.currentTarget, 128, isOwn ? 106 : 40);
              setMenuPos({ ...pos, left: Math.max(8, Math.min(rect.right, window.innerWidth - 8) - 128) });
              setMenuOpen((v) => !v);
            }}
            className="text-slate-400 hover:text-slate-700 px-1 font-bold"
            title="More options"
          >
            &#8942;
          </button>
          {menuOpen && menuPos && (
            <div
              style={{ position: "fixed", top: menuPos.top, left: menuPos.left }}
              className="z-30 bg-white border rounded shadow-lg w-32 py-1 text-sm"
            >
              {isOwn && (
                <>
                  <button
                    className="block w-full text-left px-3 py-1.5 hover:bg-slate-50 disabled:text-slate-300"
                    disabled={!entry.end}
                    onClick={() => {
                      setMenuOpen(false);
                      onSplit(entry.id);
                    }}
                  >
                    Split
                  </button>
                  <button
                    className="block w-full text-left px-3 py-1.5 hover:bg-slate-50"
                    onClick={() => {
                      setMenuOpen(false);
                      onDuplicate(entry.id);
                    }}
                  >
                    Duplicate
                  </button>
                </>
              )}
              <button
                className="block w-full text-left px-3 py-1.5 text-red-600 hover:bg-red-50"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(entry.id);
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
