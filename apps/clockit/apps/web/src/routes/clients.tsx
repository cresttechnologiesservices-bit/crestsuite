import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { ClientEditModal } from "../components/clients/ClientEditModal";
import { confirmDialog } from "../components/ui/notify";

export function Clients() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("active");
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<any>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["clients", status, search],
    queryFn: async () =>
      (await api.get("/clients", { params: { status, search } })).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["clients"] });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      await api.post("/clients", { name });
    },
    onSuccess: () => {
      invalidate();
      setNewName("");
      setError("");
    },
    onError: (e: any) => {
      setError(e?.response?.status === 409 ? "A client with that name already exists" : "Failed to create client");
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      await api.post(`/clients/${id}/${archived ? "restore" : "archive"}`);
    },
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/clients/${id}`);
    },
    onSuccess: invalidate,
    onError: (e: any) => {
      setError(
        e?.response?.status === 409
          ? "Cannot delete: client has associated projects. Archive it instead."
          : "Failed to delete client"
      );
    },
  });

  const allSelected = clients.length > 0 && clients.every((c: any) => selected.has(c.id));
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set<string>(clients.map((c: any) => c.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto" onClick={() => setMenuFor(null)}>
      <h1 className="text-2xl font-bold mb-6">Clients</h1>

      <div className="bg-white rounded-lg shadow p-4 mb-4 flex gap-3 flex-wrap">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 border rounded"
        >
          <option value="active">Show active</option>
          <option value="archived">Show archived</option>
          <option value="all">Show all</option>
        </select>
        <div className="relative flex-1 min-w-[200px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
          <input
            type="text"
            placeholder="Search by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border rounded"
          />
        </div>
        <input
          type="text"
          placeholder="Add new Client"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newName.trim()) createMutation.mutate(newName.trim());
          }}
          className="px-3 py-2 border rounded"
        />
        <button
          onClick={() => createMutation.mutate(newName.trim())}
          disabled={!newName.trim() || createMutation.isPending}
          className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
        >
          ADD
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2 bg-red-50 border border-red-200 text-red-700 rounded flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="font-bold">×</button>
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-visible">
        <table className="w-full">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="px-4 py-3 w-10">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th className="text-left px-4 py-3 text-sm font-semibold">NAME</th>
              <th className="text-left px-4 py-3 text-sm font-semibold">ADDRESS</th>
              <th className="text-left px-4 py-3 text-sm font-semibold">CURRENCY</th>
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="text-center py-12 text-slate-500">Loading...</td></tr>
            ) : clients.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-12 text-slate-500">No clients found</td></tr>
            ) : (
              clients.map((c: any) => (
                <tr key={c.id} className="border-b hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} />
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {c.name}
                    {c.status === "archived" && (
                      <span className="ml-2 text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded">Archived</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{c.address || ""}</td>
                  <td className="px-4 py-3 text-sm">{c.currency}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1 relative">
                      <button
                        onClick={() => setEditing(c)}
                        title="Edit"
                        className="p-1 text-slate-500 hover:text-indigo-600 rounded hover:bg-slate-100"
                      >
                        ✎
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuFor(menuFor === c.id ? null : c.id);
                        }}
                        className="p-1 text-slate-500 hover:text-slate-800 rounded hover:bg-slate-100"
                      >
                        ⋮
                      </button>
                      {menuFor === c.id && (
                        <div className="absolute right-0 top-8 z-10 bg-white border rounded shadow-lg w-36 py-1 text-sm">
                          <button
                            onClick={() => {
                              setEditing(c);
                              setMenuFor(null);
                            }}
                            className="block w-full text-left px-3 py-1.5 hover:bg-slate-50"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              archiveMutation.mutate({ id: c.id, archived: c.status === "archived" });
                              setMenuFor(null);
                            }}
                            className="block w-full text-left px-3 py-1.5 hover:bg-slate-50"
                          >
                            {c.status === "archived" ? "Restore" : "Archive"}
                          </button>
                          <button
                            onClick={async () => {
                              setMenuFor(null);
                              if (
                                await confirmDialog({
                                  title: "Delete client",
                                  message: `Delete client "${c.name}"? Clients with existing projects cannot be deleted.`,
                                  confirmLabel: "Delete",
                                  danger: true,
                                })
                              ) {
                                deleteMutation.mutate(c.id);
                              }
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

      {editing && (
        <ClientEditModal
          client={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}
