import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { confirmDialog } from "../ui/notify";

export function AccessTab({ projectId, project }: { projectId: string; project: any }) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // B9: the action menu is fixed-positioned so the scrolling table container
  // (max-h + overflow) cannot clip it.
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [editingRateFor, setEditingRateFor] = useState<string | null>(null);
  const [rateValue, setRateValue] = useState("");

  const members: any[] = project.members ?? [];

  const { data: users = [] } = useQuery({
    queryKey: ["project-meta-users"],
    queryFn: async () => (await api.get("/projects/meta/users")).data,
  });
  const available = users.filter((u: any) => !members.some((m) => m.user?.id === u.id));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["project", projectId] });

  const visibilityMutation = useMutation({
    mutationFn: async (visibility: string) => {
      await api.patch(`/projects/${projectId}`, { visibility });
    },
    onSuccess: invalidate,
  });

  const addMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      await api.post(`/projects/${projectId}/members`, { userIds: [userId] });
    },
    onSuccess: () => {
      invalidate();
      setAddOpen(false);
    },
  });

  const updateMemberMutation = useMutation({
    mutationFn: async ({ userId, data }: { userId: string; data: any }) => {
      await api.patch(`/projects/${projectId}/members/${userId}`, data);
    },
    onSuccess: () => {
      invalidate();
      setEditingRateFor(null);
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      await api.delete(`/projects/${projectId}/members/${userId}`);
    },
    onSuccess: invalidate,
  });

  return (
    <div
      onClick={() => {
        setMenuFor(null);
        setAddOpen(false);
      }}
    >
      {/* Visibility */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h3 className="font-semibold mb-1">Visibility</h3>
        <p className="text-sm text-slate-500 mb-3">Only people you add to the Project can track time on it.</p>
        <div className="flex gap-6">
          {["private", "public"].map((v) => (
            <label key={v} className="flex items-center gap-2 text-sm capitalize">
              <input
                type="radio"
                name="visibility"
                checked={project.visibility === v}
                onChange={() => visibilityMutation.mutate(v)}
              />
              {v}
            </label>
          ))}
        </div>
      </div>

      {/* Members */}
      <div className="bg-white rounded-lg shadow">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">Users</h3>
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setAddOpen(!addOpen)}
              className="text-sm text-indigo-600 hover:underline"
            >
              + Add members
            </button>
            {addOpen && (
              <div className="absolute right-0 top-8 z-10 bg-white border rounded shadow-lg w-56 py-1 text-sm max-h-56 overflow-y-auto">
                {available.length === 0 ? (
                  <div className="px-3 py-2 text-slate-500">All workspace users are already members</div>
                ) : (
                  available.map((u: any) => (
                    <button
                      key={u.id}
                      onClick={() => addMemberMutation.mutate(u.id)}
                      className="block w-full text-left px-3 py-1.5 hover:bg-slate-50"
                    >
                      {u.name} <span className="text-slate-400">({u.email})</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b sticky top-0">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-semibold">NAME</th>
                <th className="text-left px-4 py-3 text-sm font-semibold">BILLABLE RATE (USD)</th>
                <th className="text-left px-4 py-3 text-sm font-semibold">ROLE</th>
                <th className="px-4 py-3 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-10 text-slate-500">No members added yet</td></tr>
              ) : (
                members.map((m) => (
                  <tr key={m.id} className="border-b hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{m.user?.name}</td>
                    <td className="px-4 py-3 text-sm">
                      {editingRateFor === m.user.id ? (
                        <span className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={rateValue}
                            onChange={(e) => setRateValue(e.target.value)}
                            className="w-24 px-2 py-1 border rounded"
                            autoFocus
                          />
                          <button
                            onClick={() =>
                              updateMemberMutation.mutate({
                                userId: m.user.id,
                                data: { billableRate: rateValue === "" ? null : Number(rateValue) },
                              })
                            }
                            className="text-indigo-600 hover:underline"
                          >
                            Save
                          </button>
                          <button onClick={() => setEditingRateFor(null)} className="text-slate-500 hover:underline">
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          {m.billableRate != null ? Number(m.billableRate).toFixed(2) : "-"}
                          <button
                            onClick={() => {
                              setEditingRateFor(m.user.id);
                              setRateValue(m.billableRate != null ? String(Number(m.billableRate)) : "");
                            }}
                            className="text-indigo-600 text-xs hover:underline"
                          >
                            Change
                          </button>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">{m.role || "-"}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                            setMenuFor(menuFor === m.user.id ? null : m.user.id);
                          }}
                          className="p-1 text-slate-500 hover:text-slate-800 rounded hover:bg-slate-100"
                        >
                          ⋮
                        </button>
                        {menuFor === m.user.id && menuPos && (
                          <div
                            className="fixed z-30 bg-white border rounded shadow-lg w-48 py-1 text-sm"
                            style={{ top: menuPos.top, right: menuPos.right }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => {
                                updateMemberMutation.mutate({
                                  userId: m.user.id,
                                  data: { role: m.role === "manager" ? null : "manager" },
                                });
                                setMenuFor(null);
                              }}
                              className="block w-full text-left px-3 py-1.5 hover:bg-slate-50"
                            >
                              {m.role === "manager" ? "Revoke manager rights" : "Give manager rights"}
                            </button>
                            <button
                              onClick={async () => {
                                setMenuFor(null);
                                if (await confirmDialog({ title: "Remove member", message: `Remove ${m.user?.name} from this project? Their time entries will be kept.`, confirmLabel: "Remove", danger: true })) {
                                  removeMemberMutation.mutate(m.user.id);
                                }
                              }}
                              className="block w-full text-left px-3 py-1.5 text-red-600 hover:bg-red-50"
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
