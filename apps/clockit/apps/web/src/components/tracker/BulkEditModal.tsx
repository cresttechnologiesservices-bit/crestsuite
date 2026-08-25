import { useState } from "react";

export interface BulkChanges {
  description?: string;
  projectId?: string | null;
  billable?: boolean;
  tags?: string[];
  date?: string; // yyyy-MM-dd — moves each entry to this date, keeping its time of day
  startTime?: string; // HH:mm — sets each entry's start time of day, keeping its duration
}

interface Props {
  count: number;
  projects: any[];
  onApply: (changes: BulkChanges) => void;
  onClose: () => void;
}

// I16: edit several entries at once. Only the ticked fields are applied.
export function BulkEditModal({ count, projects, onApply, onClose }: Props) {
  const [setDesc, setSetDesc] = useState(false);
  const [desc, setDesc_] = useState("");
  const [setProject, setSetProject] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [setBillable, setSetBillable] = useState(false);
  const [billable, setBillable_] = useState(true);
  const [setTags, setSetTags] = useState(false);
  const [tags, setTags_] = useState("");
  const [setDate, setSetDate] = useState(false);
  const [date, setDate_] = useState(() => new Date().toISOString().slice(0, 10));
  const [setStart, setSetStart] = useState(false);
  const [startTime, setStartTime] = useState("09:00");

  function apply() {
    const changes: BulkChanges = {};
    if (setDesc) changes.description = desc;
    if (setProject) changes.projectId = projectId || null;
    if (setBillable) changes.billable = billable;
    if (setTags)
      changes.tags = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    if (setDate) changes.date = date;
    if (setStart) changes.startTime = startTime;
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    onApply(changes);
  }

  const row = "flex items-center gap-3";
  const label = "flex items-center gap-2 w-36 text-sm text-slate-700 shrink-0";

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h3 className="text-lg font-semibold mb-1">Bulk edit</h3>
        <p className="text-sm text-slate-500 mb-4">
          Changes apply to {count} selected {count === 1 ? "entry" : "entries"}. Tick the
          fields you want to change.
        </p>
        <div className="space-y-3">
          <div className={row}>
            <label className={label}>
              <input type="checkbox" checked={setDesc} onChange={(e) => setSetDesc(e.target.checked)} />
              Description
            </label>
            <input
              className="flex-1 border rounded px-2 py-1.5 text-sm disabled:bg-slate-100"
              disabled={!setDesc}
              value={desc}
              onChange={(e) => setDesc_(e.target.value)}
            />
          </div>
          <div className={row}>
            <label className={label}>
              <input type="checkbox" checked={setProject} onChange={(e) => setSetProject(e.target.checked)} />
              Project
            </label>
            <select
              className="flex-1 border rounded px-2 py-1.5 text-sm disabled:bg-slate-100"
              disabled={!setProject}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className={row}>
            <label className={label}>
              <input type="checkbox" checked={setBillable} onChange={(e) => setSetBillable(e.target.checked)} />
              Billable
            </label>
            <select
              className="flex-1 border rounded px-2 py-1.5 text-sm disabled:bg-slate-100"
              disabled={!setBillable}
              value={billable ? "yes" : "no"}
              onChange={(e) => setBillable_(e.target.value === "yes")}
            >
              <option value="yes">Billable</option>
              <option value="no">Not billable</option>
            </select>
          </div>
          <div className={row}>
            <label className={label}>
              <input type="checkbox" checked={setTags} onChange={(e) => setSetTags(e.target.checked)} />
              Tags
            </label>
            <input
              className="flex-1 border rounded px-2 py-1.5 text-sm disabled:bg-slate-100"
              placeholder="comma, separated"
              disabled={!setTags}
              value={tags}
              onChange={(e) => setTags_(e.target.value)}
            />
          </div>
          <div className={row}>
            <label className={label}>
              <input type="checkbox" checked={setDate} onChange={(e) => setSetDate(e.target.checked)} />
              Date
            </label>
            <input
              type="date"
              className="flex-1 border rounded px-2 py-1.5 text-sm disabled:bg-slate-100"
              disabled={!setDate}
              value={date}
              onChange={(e) => setDate_(e.target.value)}
            />
          </div>
          <div className={row}>
            <label className={label}>
              <input type="checkbox" checked={setStart} onChange={(e) => setSetStart(e.target.checked)} />
              Start time
            </label>
            <input
              type="time"
              className="flex-1 border rounded px-2 py-1.5 text-sm disabled:bg-slate-100"
              disabled={!setStart}
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 border border-slate-300 rounded hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={apply}
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            Apply to {count}
          </button>
        </div>
      </div>
    </div>
  );
}
