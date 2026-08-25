import { useEffect, useState } from "react";
import { format, isToday, parseISO } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

interface TimeEntryModalProps {
  entry: any;
  slot: { date: Date; hour: number } | null;
  onSave: (data: any) => void;
  onDelete?: (entryId: string) => void;
  onClose: () => void;
}

function computeDuration(startTime: string, endTime: string) {
  const [startHour, startMin] = startTime.split(":").map(Number);
  const [endHour, endMin] = endTime.split(":").map(Number);
  const durationMinutes = endHour * 60 + endMin - (startHour * 60 + startMin);
  if (durationMinutes <= 0) return "0:00";

  const hours = Math.floor(durationMinutes / 60);
  const mins = durationMinutes % 60;
  return `${hours}:${String(mins).padStart(2, "0")}`;
}

export function TimeEntryModal({ entry, slot, onSave, onDelete, onClose }: TimeEntryModalProps) {
  const [description, setDescription] = useState(entry?.description || "");
  const [projectId, setProjectId] = useState(entry?.projectId || "");
  const [date, setDate] = useState(
    entry
      ? format(new Date(entry.start), "yyyy-MM-dd")
      : slot
        ? format(slot.date, "yyyy-MM-dd")
        : format(new Date(), "yyyy-MM-dd")
  );
  const [startTime, setStartTime] = useState(
    entry
      ? format(new Date(entry.start), "HH:mm")
      : slot
        ? `${String(slot.hour).padStart(2, "0")}:00`
        : "09:00"
  );
  const [endTime, setEndTime] = useState(
    entry && entry.end
      ? format(new Date(entry.end), "HH:mm")
      : slot
        ? `${String(Math.min(slot.hour + 1, 23)).padStart(2, "0")}:${slot.hour + 1 > 23 ? "59" : "00"}`
        : "10:00"
  );
  const [billable, setBillable] = useState(entry?.billable || false);
  const [tags, setTags] = useState<string[]>(entry?.tags || []);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Fetch projects
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data } = await api.get("/projects");
      return Array.isArray(data) ? data : data.items ?? [];
    },
  });

  // REQ-CAL-F14/F15: computed duration, kept editable (REQ-CAL-F16)
  const duration = computeDuration(startTime, endTime);
  const [durationInput, setDurationInput] = useState(duration);
  useEffect(() => {
    setDurationInput(duration);
  }, [duration]);

  // REQ-CAL-F21: billable defaults from the selected project's setting (new entries)
  useEffect(() => {
    if (entry) return;
    const project = projects.find((p: any) => p.id === projectId);
    if (project) setBillable(!!project.billableDefault);
  }, [projectId, projects, entry]);

  // REQ-CAL-F16: editing duration adjusts the end time
  const applyDuration = (value: string) => {
    const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      setDurationInput(duration);
      return;
    }
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const [startHour, startMin] = startTime.split(":").map(Number);
    const endMinutes = Math.min(startHour * 60 + startMin + hours * 60 + minutes, 23 * 60 + 59);
    const endHour = Math.floor(endMinutes / 60);
    const endMin = endMinutes % 60;
    setEndTime(`${String(endHour).padStart(2, "0")}:${String(endMin).padStart(2, "0")}`);
  };

  const handleSubmit = () => {
    if (!isValid) return;
    onSave({
      projectId,
      date,
      startTime,
      endTime,
      description,
      billable,
      tags,
    });
  };

  // REQ-CAL-F23: project is required
  const isValid = Boolean(projectId && startTime && endTime && duration !== "0:00");

  // REQ-CAL-F14/F17: friendly date label
  const dateLabel = isToday(parseISO(date)) ? "Today" : format(parseISO(date), "MMM d");

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h3 className="text-lg font-semibold">
            {entry ? "Edit time entry" : "Add time entry"}
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Time and Date (REQ-CAL-F14) */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Time and date
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <div className="text-sm text-slate-500 mb-1">Duration</div>
                <input
                  type="text"
                  value={durationInput}
                  onChange={(e) => setDurationInput(e.target.value)}
                  onBlur={(e) => applyDuration(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") applyDuration(durationInput);
                  }}
                  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex-1">
                <div className="text-sm text-slate-500 mb-1">Start</div>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex-1">
                <div className="text-sm text-slate-500 mb-1">End</div>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              {/* REQ-CAL-F17: calendar icon opens the date picker */}
              <button
                type="button"
                onClick={() => setShowDatePicker(!showDatePicker)}
                className="p-2 hover:bg-slate-100 rounded"
                aria-label="Pick date"
              >
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </button>
              <span className="text-sm text-slate-700">{dateLabel}</span>
              {showDatePicker && (
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setShowDatePicker(false);
                  }}
                  className="px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              )}
            </div>
          </div>

          {/* Description (REQ-CAL-F18) */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What have you worked on?"
              rows={3}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Project (REQ-CAL-F19) */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Project <span className="text-red-500">*</span>
            </label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Select Project</option>
              {projects.map((project: any) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          {/* Tags (REQ-CAL-F20) */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Tags
            </label>
            <input
              type="text"
              defaultValue={tags.join(", ")}
              onChange={(e) =>
                setTags(e.target.value.split(",").map((t) => t.trim()).filter(Boolean))
              }
              placeholder="Add tags"
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Billable (REQ-CAL-F21) */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-slate-700 flex-1">Billable</label>
            <button
              type="button"
              onClick={() => setBillable(!billable)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                billable ? "bg-indigo-600" : "bg-slate-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  billable ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
            <span className="text-sm text-slate-600 w-8">{billable ? "Yes" : "No"}</span>
          </div>
        </div>

        {/* Footer (REQ-CAL-F22) */}
        <div className="flex items-center justify-between p-6 border-t">
          <div>
            {entry && onDelete && (
              <button
                onClick={() => onDelete(entry.id)}
                className="px-4 py-2 text-red-600 border border-red-300 rounded hover:bg-red-50"
              >
                Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 rounded hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!isValid}
              className="px-6 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {entry ? "SAVE" : "ADD"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
