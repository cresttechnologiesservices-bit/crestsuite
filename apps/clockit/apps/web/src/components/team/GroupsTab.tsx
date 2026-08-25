import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { toast, confirmDialog } from "../ui/notify";

export function GroupsTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [addUserSelections, setAddUserSelections] = useState<Record<string, string>>({});

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ["groups-list", search],
    queryFn: async () => (await api.get("/team/groups", { params: { search } })).data,
  });

  // All workspace members, used to add members to a group
  const { data: allMembers } = useQuery({
    queryKey: ["team-members-all"],
    queryFn: async () =>
      (await api.get("/team/members", { params: { status: "all", page_size: 500 } })).data,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["groups-list"] });
    queryClient.invalidateQueries({ queryKey: ["team-members"] });
  };

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      await api.post("/team/groups", { name });
    },
    onSuccess: () => {
      invalidate();
      setNewGroupName("");
    },
    onError: (error: any) => {
      toast(error?.response?.data?.error || "Failed to create group", "error");
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      await api.patch(`/team/groups/${id}`, { name });
    },
    onSuccess: () => {
      invalidate();
      setEditingId(null);
    },
    onError: (error: any) => {
      toast(error?.response?.data?.error || "Failed to rename group", "error");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/team/groups/${id}`);
    },
    onSuccess: invalidate,
  });

  const addMemberMutation = useMutation({
    mutationFn: async ({ groupId, userId }: { groupId: string; userId: string }) => {
      await api.post(`/team/groups/${groupId}/members`, { userId });
    },
    onSuccess: (_data, { groupId }) => {
      invalidate();
      setAddUserSelections((prev) => ({ ...prev, [groupId]: "" }));
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async ({ groupId, userId }: { groupId: string; userId: string }) => {
      await api.delete(`/team/groups/${groupId}/members/${userId}`);
    },
    onSuccess: invalidate,
  });

  const handleCreate = () => {
    if (newGroupName.trim()) {
      createMutation.mutate(newGroupName.trim());
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center gap-3">
          {/* REQ-TEAM-F28: search groups by username or group name */}
          <input
            type="text"
            placeholder="Search by username or group name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-3 py-2 border rounded"
          />
          {/* REQ-TEAM-F29/F30: add new group, disabled when empty */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Add new group"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              className="px-3 py-2 border rounded"
            />
            <button
              onClick={handleCreate}
              disabled={!newGroupName.trim() || createMutation.isPending}
              className="px-4 py-2 bg-indigo-600 text-white rounded disabled:opacity-50"
            >
              ADD
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="px-4 py-3 w-8"></th>
              <th className="text-left px-4 py-3 text-sm font-semibold">NAME</th>
              <th className="text-left px-4 py-3 text-sm font-semibold">MEMBERS</th>
              <th className="text-left px-4 py-3 text-sm font-semibold">ACCESS</th>
              <th className="px-4 py-3 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="text-center py-12 text-slate-500">Loading...</td></tr>
            ) : groups.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-12 text-slate-500">No groups found</td></tr>
            ) : (
              groups.map((group: any) => {
                const expanded = expandedIds.includes(group.id);
                const memberIds = new Set(group.members.map((m: any) => m.id));
                const addable = (allMembers?.members || []).filter(
                  (m: any) => !memberIds.has(m.id)
                );
                return (
                  <FragmentRow
                    key={group.id}
                    group={group}
                    expanded={expanded}
                    editing={editingId === group.id}
                    editingName={editingName}
                    addable={addable}
                    addSelection={addUserSelections[group.id] || ""}
                    onToggleExpanded={() => toggleExpanded(group.id)}
                    onEditStart={() => {
                      setEditingId(group.id);
                      setEditingName(group.name);
                    }}
                    onEditCancel={() => setEditingId(null)}
                    onEditNameChange={setEditingName}
                    onRename={() => {
                      if (editingName.trim()) {
                        renameMutation.mutate({ id: group.id, name: editingName.trim() });
                      }
                    }}
                    onDelete={async () => {
                      if (await confirmDialog({ title: "Delete group", message: `Delete group "${group.name}"?`, confirmLabel: "Delete", danger: true })) {
                        deleteMutation.mutate(group.id);
                      }
                    }}
                    onAddSelectionChange={(userId) =>
                      setAddUserSelections((prev) => ({ ...prev, [group.id]: userId }))
                    }
                    onAddMember={(userId) =>
                      addMemberMutation.mutate({ groupId: group.id, userId })
                    }
                    onRemoveMember={(userId) =>
                      removeMemberMutation.mutate({ groupId: group.id, userId })
                    }
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRow({
  group,
  expanded,
  editing,
  editingName,
  addable,
  addSelection,
  onToggleExpanded,
  onEditStart,
  onEditCancel,
  onEditNameChange,
  onRename,
  onDelete,
  onAddSelectionChange,
  onAddMember,
  onRemoveMember,
}: {
  group: any;
  expanded: boolean;
  editing: boolean;
  editingName: string;
  addable: any[];
  addSelection: string;
  onToggleExpanded: () => void;
  onEditStart: () => void;
  onEditCancel: () => void;
  onEditNameChange: (name: string) => void;
  onRename: () => void;
  onDelete: () => void;
  onAddSelectionChange: (userId: string) => void;
  onAddMember: (userId: string) => void;
  onRemoveMember: (userId: string) => void;
}) {
  return (
    <>
      <tr className="border-b hover:bg-slate-50">
        <td className="px-4 py-3">
          {/* REQ-TEAM-F12: expand/collapse via chevron */}
          <button
            onClick={onToggleExpanded}
            className="text-slate-500 hover:text-slate-700"
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? "▾" : "▸"}
          </button>
        </td>
        <td className="px-4 py-3">
          {editing ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={editingName}
                onChange={(e) => onEditNameChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") onRename(); }}
                className="px-2 py-1 border rounded text-sm"
                autoFocus
              />
              <button onClick={onRename} className="text-sm text-indigo-600">
                Save
              </button>
              <button onClick={onEditCancel} className="text-sm text-slate-500">
                Cancel
              </button>
            </div>
          ) : (
            <span className="font-medium">{group.name}</span>
          )}
        </td>
        <td className="px-4 py-3 text-sm text-slate-600">{group.memberCount} members</td>
        <td className="px-4 py-3 text-sm">
          <button className="text-indigo-600 text-xs hover:underline">+ Access</button>
        </td>
        <td className="px-4 py-3">
          <div className="flex gap-2">
            <button
              onClick={onEditStart}
              className="text-slate-500 hover:text-slate-700"
              title="Edit"
            >
              ✎
            </button>
            <button
              onClick={onDelete}
              className="text-red-500 hover:text-red-700"
              title="Delete"
            >
              ✕
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b bg-slate-50">
          <td></td>
          <td colSpan={4} className="px-4 py-3">
            {/* REQ-TEAM-F13: MEMBERS section per group */}
            <div className="text-xs font-semibold text-slate-500 mb-2">MEMBERS</div>
            {group.members.length === 0 ? (
              <div className="text-sm text-slate-500 mb-2">No members in this group</div>
            ) : (
              <ul className="space-y-1 mb-3">
                {group.members.map((m: any) => (
                  <li key={m.id} className="flex items-center gap-2 text-sm">
                    <span>{m.name}</span>
                    <span className="text-slate-400">{m.email}</span>
                    <button
                      onClick={() => onRemoveMember(m.id)}
                      className="text-red-500 hover:text-red-700 text-xs"
                      title="Remove from group"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2">
              <select
                value={addSelection}
                onChange={(e) => onAddSelectionChange(e.target.value)}
                className="px-2 py-1 border rounded text-sm bg-white"
              >
                <option value="">Add member...</option>
                {addable.map((m: any) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.email})
                  </option>
                ))}
              </select>
              <button
                onClick={() => addSelection && onAddMember(addSelection)}
                disabled={!addSelection}
                className="px-3 py-1 bg-indigo-600 text-white rounded text-sm disabled:opacity-50"
              >
                ADD
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
