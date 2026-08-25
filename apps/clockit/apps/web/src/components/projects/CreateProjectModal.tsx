import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

const COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#64748b"];

export function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientOpen, setClientOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [colorOpen, setColorOpen] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  // I2: Billable is checked by default for new projects
  const [billableDefault, setBillableDefault] = useState(true);
  const [error, setError] = useState("");

  const { data: clients = [] } = useQuery({
    queryKey: ["clients", "active", clientSearch],
    queryFn: async () =>
      (await api.get("/clients", { params: { status: "active", search: clientSearch } })).data,
  });

  const createClientMutation = useMutation({
    mutationFn: async (newClientName: string) =>
      (await api.post("/clients", { name: newClientName })).data,
    onSuccess: (created: any) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setClientId(created.id);
      setClientName(created.name);
      setClientOpen(false);
      setClientSearch("");
    },
    onError: () => setError("Failed to create client (name may already exist)"),
  });

  const createProjectMutation = useMutation({
    mutationFn: async () => {
      await api.post("/projects", {
        name: name.trim(),
        clientId: clientId ?? undefined,
        color,
        visibility: isPublic ? "public" : "private",
        billableDefault,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    },
    onError: (e: any) => {
      setError(e?.response?.status === 409 ? "A project with that name already exists" : "Failed to create project");
    },
  });

  const exactMatch = clients.some((c: any) => c.name.toLowerCase() === clientSearch.trim().toLowerCase());

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-6 border-b">
          <h3 className="text-lg font-semibold">Create new Project</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">×</button>
        </div>
        <div className="p-6 space-y-4">
          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>
          )}
          <input
            type="text"
            placeholder="Enter Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border rounded"
            autoFocus
          />

          <div className="flex gap-3 items-start">
            {/* Client picker */}
            <div className="relative flex-1">
              <button
                onClick={() => setClientOpen(!clientOpen)}
                className="w-full px-3 py-2 border rounded text-left text-sm flex justify-between items-center"
              >
                <span className={clientName ? "" : "text-slate-400"}>{clientName || "Select client"}</span>
                <span>▾</span>
              </button>
              {clientOpen && (
                <div className="absolute top-11 left-0 right-0 z-10 bg-white border rounded shadow-lg p-2">
                  <input
                    type="text"
                    placeholder="Add/Search Client"
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    className="w-full px-2 py-1.5 border rounded text-sm mb-2"
                    autoFocus
                  />
                  <div className="max-h-40 overflow-y-auto text-sm">
                    <button
                      onClick={() => {
                        setClientId(null);
                        setClientName("");
                        setClientOpen(false);
                      }}
                      className="block w-full text-left px-2 py-1.5 hover:bg-slate-50 text-slate-500"
                    >
                      No client
                    </button>
                    {clients.map((c: any) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setClientId(c.id);
                          setClientName(c.name);
                          setClientOpen(false);
                        }}
                        className="block w-full text-left px-2 py-1.5 hover:bg-slate-50"
                      >
                        {c.name}
                      </button>
                    ))}
                    {clientSearch.trim() && !exactMatch && (
                      <button
                        onClick={() => createClientMutation.mutate(clientSearch.trim())}
                        className="block w-full text-left px-2 py-1.5 text-indigo-600 hover:bg-indigo-50"
                      >
                        + Create client "{clientSearch.trim()}"
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Color picker */}
            <div className="relative">
              <button
                onClick={() => setColorOpen(!colorOpen)}
                className="px-2 py-2 border rounded flex items-center gap-1"
              >
                <span className="w-5 h-5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-xs">▾</span>
              </button>
              {colorOpen && (
                <div className="absolute top-11 right-0 z-10 bg-white border rounded shadow-lg p-2 grid grid-cols-4 gap-2 w-32">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => {
                        setColor(c);
                        setColorOpen(false);
                      }}
                      className={`w-6 h-6 rounded-full ${c === color ? "ring-2 ring-offset-1 ring-slate-400" : ""}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
            Public
            <span
              className="text-slate-400 cursor-help"
              title="Public projects can be seen and tracked on by everyone in the workspace. Private projects are visible only to members you add."
            >
              ⓘ
            </span>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={billableDefault}
              onChange={(e) => setBillableDefault(e.target.checked)}
            />
            Billable by default
          </label>
        </div>
        <div className="flex justify-end gap-2 p-6 border-t">
          <button onClick={onClose} className="px-4 py-2 border rounded hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={() => createProjectMutation.mutate()}
            disabled={!name.trim() || createProjectMutation.isPending}
            className="px-6 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            CREATE
          </button>
        </div>
      </div>
    </div>
  );
}
