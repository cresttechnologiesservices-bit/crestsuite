import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { confirmDialog } from "../ui/notify";

export function TasksTab({ projectId, project }: { projectId: string; project: any }) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("active");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [newTask, setNewTask] = useState("");
  const [error, setError] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [assigneesFor, setAssigneesFor] = useState<string | null>(null);
  // Proper edit dialog (instead of a browser prompt)
  const [editTask, setEditTask] = useState<any | null>(null);
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState("active");

  const members: any[] = project.members ?? [];

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["project-tasks", projectId, statusFilter, search, sortOrder],
    queryFn: async () =>
      (
        await api.get(`/projects/${projectId}/tasks`, {
          params: { status: statusFilter, search, sort_order: sortOrder },
        })
      ).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] });

  const addMutation = useMutation({
    mutationFn: async (name: string) => {
      await api.post(`/projects/${projectId}/tasks`, { name });
    },
    onSuccess: () => {
      invalidate();
      setNewTask("");
      setError("");
    },
    onError: (e: any) => {
      setError(e?.response?.status === 409 ? "A task with that name already exists in this project" : "Failed to add task");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ taskId, data }: { taskId: string; data: any }) => {
      await api.patch(`/projects/${projectId}/tasks/${taskId}`, data);
    },
    onSuccess: invalidate,
    onError: (e: any) => {
      setError(e?.response?.status === 409 ? "A task with that name already exists in this project" : "Failed to update task");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (taskId: string) => {
      await api.delete(`/projects/${projectId}/tasks/${taskId}`);
    },
    onSuccess: invalidate,
  });

  const assigneeNames = (t: any) => {
    const ids: string[] = Array.isArray(t.assignees) ? t.assignees : [];
    if (ids.length === 0) return "Anyone";
    return ids
      .map((id) => members.find((m) => m.user?.id === id)?.user?.name ?? "Unknown")
      .join(", ");
  };

  const toggleAssignee = (t: any, userId: string) => {
    const ids: string[] = Array.isArray(t.assignees) ? [...t.assignees] : [];
    const next = ids.includes(userId) ? ids.filter((id) => id !== userId) : [...ids, userId];
    updateMutation.mutate({ taskId: t.id, data: { assignees: next } });
  };

  return (
    <div
      onClick={() => {
        setMenuFor(null);
        setAssigneesFor(null);
      }}
    >
      <div className="flex gap-3 mb-4 flex-wrap">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border rounded text-sm"
        >
          <option value="active">Show active</option>
          <option value="done">Show done</option>
          <option value="all">Show all</option>
        </select>
        <div className="relative flex-1 min-w-[180px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
          <input
            type="text"
            placeholder="Search by name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border rounded text-sm"
          />
        </div>
        <input
          type="text"
          placeholder="Add new Task"
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newTask.trim()) addMutation.mutate(newTask.trim());
          }}
          className="px-3 py-2 border rounded text-sm"
        />
        <button
          onClick={() => addMutation.mutate(newTask.trim())}
          disabled={!newTask.trim() || addMutation.isPending}
          className="px-4 py-2 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          ADD
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="font-bold">×</button>
        </div>
      )}

      <div className="bg-white rounded-lg shadow">
        <table className="w-full">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th
                className="text-left px-4 py-3 text-sm font-semibold cursor-pointer select-none hover:text-indigo-600"
                onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
              >
                NAME {sortOrder === "asc" ? "▲" : "▼"}
              </th>
              <th className="text-left px-4 py-3 text-sm font-semibold">ASSIGNEES</th>
              <th className="px-4 py-3 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={3} className="text-center py-10 text-slate-500">Loading...</td></tr>
            ) : tasks.length === 0 ? (
              <tr><td colSpan={3} className="text-center py-10 text-slate-500">No tasks found</td></tr>
            ) : (
              tasks.map((t: any) => (
                <tr key={t.id} className="border-b hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <span className={t.status === "done" ? "line-through text-slate-400" : "font-medium"}>
                      {t.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setAssigneesFor(assigneesFor === t.id ? null : t.id);
                      }}
                      title={assigneeNames(t)}
                      className="px-2 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 max-w-[240px] truncate"
                    >
                      {assigneeNames(t)} ▾
                    </button>
                    {assigneesFor === t.id && (
                      <div
                        className="absolute left-4 top-11 z-10 bg-white border rounded shadow-lg w-56 p-2 text-sm"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {members.length === 0 ? (
                          <div className="px-2 py-1.5 text-slate-500">
                            No members on this project. Add members in the Access tab.
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => updateMutation.mutate({ taskId: t.id, data: { assignees: [] } })}
                              className="block w-full text-left px-2 py-1.5 hover:bg-slate-50"
                            >
                              Anyone
                            </button>
                            {members.map((m) => (
                              <label key={m.user.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50">
                                <input
                                  type="checkbox"
                                  checked={Array.isArray(t.assignees) && t.assignees.includes(m.user.id)}
                                  onChange={() => toggleAssignee(t, m.user.id)}
                                />
                                {m.user.name}
                              </label>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="relative flex justify-end">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuFor(menuFor === t.id ? null : t.id);
                        }}
                        className="p-1 text-slate-500 hover:text-slate-800 rounded hover:bg-slate-100"
                      >
                        ⋮
                      </button>
                      {menuFor === t.id && (
                        <div
                          className="absolute right-0 top-8 z-10 bg-white border rounded shadow-lg w-40 py-1 text-sm"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => {
                              setEditTask(t);
                              setEditName(t.name);
                              setEditStatus(t.status);
                              setMenuFor(null);
                            }}
                            className="block w-full text-left px-3 py-1.5 hover:bg-slate-50"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              updateMutation.mutate({
                                taskId: t.id,
                                data: { status: t.status === "done" ? "active" : "done" },
                              });
                              setMenuFor(null);
                            }}
                            className="block w-full text-left px-3 py-1.5 hover:bg-slate-50"
                          >
                            {t.status === "done" ? "Mark active" : "Mark done"}
                          </button>
                          <button
                            onClick={async () => {
                              setMenuFor(null);
                              if (await confirmDialog({ title: "Delete task", message: `Delete task "${t.name}"?`, confirmLabel: "Delete", danger: true })) deleteMutation.mutate(t.id);
                            }}
                            className="block w-full text-left px-3 py-1.5 text-red-600 hover:bg-red-50"
                          >
                            Delete
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

      {/* Edit task dialog */}
      {editTask && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold mb-4">Edit task</h3>
            <label className="block text-sm text-slate-600 mb-1">Task name</label>
            <input
              type="text"
              value={editName}
              autoFocus
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && editName.trim()) {
                  updateMutation.mutate({
                    taskId: editTask.id,
                    data: { name: editName.trim(), status: editStatus },
                  });
                  setEditTask(null);
                }
                if (e.key === "Escape") setEditTask(null);
              }}
              className="w-full px-3 py-2 border rounded text-sm mb-4"
            />
            <label className="block text-sm text-slate-600 mb-1">Status</label>
            <select
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value)}
              className="w-full px-3 py-2 border rounded text-sm mb-6"
            >
              <option value="active">Active</option>
              <option value="done">Done</option>
            </select>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditTask(null)}
                className="px-4 py-2 border border-slate-300 rounded hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                disabled={!editName.trim() || updateMutation.isPending}
                onClick={() => {
                  updateMutation.mutate({
                    taskId: editTask.id,
                    data: { name: editName.trim(), status: editStatus },
                  });
                  setEditTask(null);
                }}
                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
