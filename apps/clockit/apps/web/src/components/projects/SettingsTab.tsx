import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

const COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#64748b"];

export function SettingsTab({ projectId, project }: { projectId: string; project: any }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [clientId, setClientId] = useState(project.clientId ?? "");
  const [color, setColor] = useState(project.color);
  const [billableDefault, setBillableDefault] = useState(project.billableDefault);
  const [rate, setRate] = useState(project.hourlyRate != null ? String(Number(project.hourlyRate)) : "");
  const [estimateType, setEstimateType] = useState(project.estimateType ?? "none");
  const [estimateValue, setEstimateValue] = useState(
    project.estimateValue != null ? String(Number(project.estimateValue)) : ""
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const { data: clients = [] } = useQuery({
    queryKey: ["clients", "all", ""],
    queryFn: async () => (await api.get("/clients", { params: { status: "all" } })).data,
  });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      await api.patch(`/projects/${projectId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setError("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (e: any) => {
      setError(e?.response?.status === 409 ? "A project with that name already exists" : "Failed to save changes");
    },
  });

  const saveGeneral = () =>
    saveMutation.mutate({
      name: name.trim(),
      clientId: clientId || null,
      color,
      billableDefault,
      estimateType,
      estimateValue: estimateType === "none" || estimateValue === "" ? null : Number(estimateValue),
    });

  return (
    <div className="max-w-xl space-y-6">
      {error && (
        <div className="px-4 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>
      )}
      {saved && (
        <div className="px-4 py-2 bg-green-50 border border-green-200 text-green-700 rounded text-sm">
          Changes saved
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border rounded"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Client</label>
          <p className="text-xs text-slate-500 mb-1">Used for grouping similar Projects together.</p>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="w-full px-3 py-2 border rounded"
          >
            <option value="">No client</option>
            {clients.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Color</label>
          <p className="text-xs text-slate-500 mb-2">Shown next to the project name across the app.</p>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full ${c === color ? "ring-2 ring-offset-1 ring-slate-500" : ""}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={billableDefault}
              onChange={(e) => setBillableDefault(e.target.checked)}
            />
            Billable by default
          </label>
          <p className="text-xs text-slate-500 mt-1 ml-6">
            New time entries on this project will be marked billable by default. Existing entries are not changed.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Project estimate</label>
          <p className="text-xs text-slate-500 mb-1">Choose how project progress is tracked.</p>
          <div className="flex gap-2">
            <select
              value={estimateType}
              onChange={(e) => setEstimateType(e.target.value)}
              className="px-3 py-2 border rounded"
            >
              <option value="none">No estimate</option>
              <option value="time">Time (hours)</option>
              <option value="fixed_fee">Fixed fee (USD)</option>
            </select>
            {estimateType !== "none" && (
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder={estimateType === "time" ? "Hours" : "Amount"}
                value={estimateValue}
                onChange={(e) => setEstimateValue(e.target.value)}
                className="w-32 px-3 py-2 border rounded"
              />
            )}
          </div>
        </div>

        <div className="pt-2 border-t flex justify-end">
          <button
            onClick={saveGeneral}
            disabled={!name.trim() || saveMutation.isPending}
            className="px-6 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            SAVE
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="font-semibold mb-1">Project billable rate</h3>
        <p className="text-xs text-slate-500 mb-3">
          Used to calculate billable amounts for time tracked on this project.
        </p>
        <div className="flex gap-2 items-center">
          <label className="text-sm">Hourly rate (USD)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="w-32 px-3 py-2 border rounded"
          />
          <button
            onClick={() => saveMutation.mutate({ hourlyRate: rate === "" ? null : Number(rate) })}
            disabled={saveMutation.isPending}
            className="px-4 py-2 border border-indigo-600 text-indigo-600 rounded hover:bg-indigo-50 disabled:opacity-50"
          >
            Set rate
          </button>
        </div>
      </div>
    </div>
  );
}
