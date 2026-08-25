import { useState } from "react";
import { fmtDuration } from "./format";
import { promptDialog } from "../ui/notify";
import { CustomFieldInputs, CustomFieldDef } from "../customFields/CustomFieldInputs";

interface Props {
  projects: any[];
  tasks: any[];
  running: any | null;
  elapsed: number;
  desc: string;
  setDesc: (v: string) => void;
  projectId: string;
  setProjectId: (v: string) => void;
  taskId: string;
  setTaskId: (v: string) => void;
  tags: string[];
  setTags: (v: string[]) => void;
  billable: boolean;
  setBillable: (v: boolean) => void;
  onStart: () => void;
  onStop: () => void;
  onManualAdd: (start: string, end: string) => void;
  onCreateProject: (name: string) => void;
  /** Creating projects from the tracker is an admin-only action */
  canCreateProject?: boolean;
  /** Active custom fields for time entries, captured with the new entry */
  customFieldDefs?: CustomFieldDef[];
  customFieldValues?: Record<string, any>;
  setCustomFieldValues?: (values: Record<string, any>) => void;
  error: string | null;
}

// REQ-TT-F01..F07: manual entry bar with description, project, tags, billable, timer + mode switch
export function EntryBar(props: Props) {
  const [mode, setMode] = useState<"timer" | "manual">("timer");
  const [showTags, setShowTags] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [manualDate, setManualDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [manualStart, setManualStart] = useState("09:00");
  const [manualEnd, setManualEnd] = useState("10:00");

  function addTag() {
    const t = tagInput.trim();
    if (t && !props.tags.includes(t)) props.setTags([...props.tags, t]);
    setTagInput("");
  }

  function handleManualAdd() {
    props.onManualAdd(
      new Date(`${manualDate}T${manualStart}`).toISOString(),
      new Date(`${manualDate}T${manualEnd}`).toISOString()
    );
  }

  async function handleNewProject() {
    const name = await promptDialog({
      title: "Create new project",
      label: "Project name",
      placeholder: "e.g. Website Redesign",
      confirmLabel: "Create",
    });
    if (name) props.onCreateProject(name);
  }

  return (
    <div className="bg-white border rounded-lg shadow-sm">
      <div className="p-4 flex flex-wrap gap-3 items-center">
        <input
          className="flex-1 min-w-[200px] border rounded px-3 py-2"
          placeholder="What are you working on?"
          value={props.desc}
          onChange={(e) => props.setDesc(e.target.value)}
        />
        <div className="flex items-center gap-1">
          <select
            className="border rounded px-2 py-2 text-sm max-w-[180px]"
            value={props.projectId}
            onChange={(e) => props.setProjectId(e.target.value)}
          >
            <option value="">No project</option>
            {props.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {props.canCreateProject && (
            <button
              title="Create new project"
              onClick={handleNewProject}
              className="px-2 py-1 text-indigo-600 hover:bg-indigo-50 rounded text-lg leading-none"
            >
              +
            </button>
          )}
          {/* I14: sub-task selector — always shown once a project is chosen so
              the subtask can be picked after typing the description */}
          {props.projectId && (
            <select
              className="border rounded px-2 py-2 text-sm max-w-[160px] disabled:bg-slate-50 disabled:text-slate-400"
              value={props.taskId}
              onChange={(e) => props.setTaskId(e.target.value)}
              disabled={props.tasks.length === 0}
              title={props.tasks.length ? "Sub-task" : "This project has no sub-tasks yet"}
            >
              {props.tasks.length === 0 ? (
                <option value="">No sub-tasks</option>
              ) : (
                <>
                  <option value="">No task</option>
                  {props.tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </>
              )}
            </select>
          )}
        </div>
        <div className="relative">
          <button
            title="Tags"
            onClick={() => setShowTags((v) => !v)}
            className={`px-2 py-1 rounded text-lg ${props.tags.length ? "text-indigo-600" : "text-slate-400"} hover:bg-slate-100`}
          >
            #
          </button>
          {showTags && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-white border rounded shadow-lg p-3 w-56">
              <div className="flex gap-1 mb-2">
                <input
                  className="flex-1 border rounded px-2 py-1 text-sm"
                  placeholder="Add tag"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTag()}
                />
                <button onClick={addTag} className="px-2 py-1 bg-indigo-600 text-white rounded text-sm">
                  Add
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {props.tags.length === 0 && <span className="text-xs text-slate-400">No tags</span>}
                {props.tags.map((t) => (
                  <span key={t} className="text-xs bg-slate-100 rounded px-2 py-0.5 flex items-center gap-1">
                    {t}
                    <button
                      onClick={() => props.setTags(props.tags.filter((x) => x !== t))}
                      className="text-slate-400 hover:text-red-600"
                    >
                      x
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <button
          title="Billable"
          onClick={() => props.setBillable(!props.billable)}
          className={`px-2 py-1 rounded text-lg font-semibold ${props.billable ? "text-emerald-600" : "text-slate-400"} hover:bg-slate-100`}
        >
          $
        </button>
        {mode === "timer" ? (
          <>
            <span className="font-mono text-lg w-24 text-center">
              {props.running ? fmtDuration(props.elapsed) : "00:00:00"}
            </span>
            <button
              onClick={props.running ? props.onStop : props.onStart}
              className={`px-5 py-2 rounded text-white font-semibold ${props.running ? "bg-red-600 hover:bg-red-700" : "bg-indigo-600 hover:bg-indigo-700"}`}
            >
              {props.running ? "STOP" : "START"}
            </button>
          </>
        ) : (
          <>
            <input
              type="date"
              className="border rounded px-2 py-2 text-sm"
              value={manualDate}
              onChange={(e) => setManualDate(e.target.value)}
            />
            <input
              type="time"
              className="border rounded px-2 py-2 text-sm"
              value={manualStart}
              onChange={(e) => setManualStart(e.target.value)}
            />
            <span className="text-slate-400">-</span>
            <input
              type="time"
              className="border rounded px-2 py-2 text-sm"
              value={manualEnd}
              onChange={(e) => setManualEnd(e.target.value)}
            />
            <button
              onClick={handleManualAdd}
              className="px-5 py-2 rounded text-white font-semibold bg-indigo-600 hover:bg-indigo-700"
            >
              ADD
            </button>
          </>
        )}
        <div className="flex flex-col gap-0.5">
          <button
            title="Timer mode"
            onClick={() => setMode("timer")}
            className={`text-xs px-1 rounded ${mode === "timer" ? "text-indigo-600 font-bold" : "text-slate-400"}`}
          >
            &#9654;
          </button>
          <button
            title="Manual mode"
            onClick={() => setMode("manual")}
            className={`text-xs px-1 rounded ${mode === "manual" ? "text-indigo-600 font-bold" : "text-slate-400"}`}
          >
            &#9776;
          </button>
        </div>
      </div>
      {/* Custom fields configured for time entries */}
      {!!props.customFieldDefs?.length && props.setCustomFieldValues && (
        <div className="px-4 pb-3 border-t pt-3">
          <CustomFieldInputs
            fields={props.customFieldDefs}
            values={props.customFieldValues ?? {}}
            onChange={props.setCustomFieldValues}
            compact
          />
        </div>
      )}
      {props.error && <div className="px-4 pb-3 text-sm text-red-600">{props.error}</div>}
    </div>
  );
}
