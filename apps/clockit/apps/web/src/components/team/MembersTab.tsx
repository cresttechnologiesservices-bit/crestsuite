import { clockitKey } from "../../lib/storage";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { CheckboxDropdown } from "./CheckboxDropdown";

const ROLES = [
  { value: "OWNER", label: "Owner" },
  { value: "ADMIN", label: "Admin" },
  { value: "MANAGER", label: "Manager" },
  { value: "MEMBER", label: "Member" },
];

// I10: applied filters survive tab navigation within the session
const STORAGE_KEY = clockitKey("team.filters");

function loadPersisted() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function MembersTab() {
  const queryClient = useQueryClient();
  const persisted = loadPersisted();
  const [status, setStatus] = useState<string>(persisted?.status ?? "active");
  const [searchInput, setSearchInput] = useState<string>(persisted?.search ?? "");
  const [search, setSearch] = useState<string>(persisted?.search ?? "");
  const [roleFilter, setRoleFilter] = useState<string[]>(persisted?.roleFilter ?? []);
  const [groupFilter, setGroupFilter] = useState<string[]>(persisted?.groupFilter ?? []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ status, search, roleFilter, groupFilter }));
    } catch {
      /* storage unavailable */
    }
  }, [status, search, roleFilter, groupFilter]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [editingMember, setEditingMember] = useState<any | null>(null);
  const [openGroupEditorId, setOpenGroupEditorId] = useState<string | null>(null);
  // B6: row dropdowns are fixed-positioned so the table's overflow container
  // cannot clip them (Group popover was partially hidden).
  const [groupPos, setGroupPos] = useState<{ top: number; left: number } | null>(null);
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [rateValue, setRateValue] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["team-members", status, search, roleFilter, groupFilter, sortBy, sortOrder, page],
    queryFn: async () => {
      const params: any = { status, sort_by: sortBy, sort_order: sortOrder, page, page_size: 50 };
      if (search) params.search = search;
      if (roleFilter.length) params.role = roleFilter.join(",");
      if (groupFilter.length) params.group_ids = groupFilter.join(",");
      const response = await api.get("/team/members", { params });
      return response.data;
    },
  });

  const { data: groups = [] } = useQuery({
    queryKey: ["groups-list"],
    queryFn: async () => (await api.get("/team/groups")).data,
  });

  const inviteMutation = useMutation({
    mutationFn: async (email: string) => {
      await api.post("/team/members/invite", { email });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
      setShowInviteModal(false);
    },
  });

  // REQ-TEAM-F12: inline billable rate editing
  const rateMutation = useMutation({
    mutationFn: async ({ id, rate }: { id: string; rate: number }) => {
      await api.patch(`/team/members/${id}/billable-rate`, { rate });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
      setEditingRateId(null);
    },
  });

  // REQ-TEAM-F13: role assignment
  // REQ-TEAM-F14: group assignment
  const assignGroupsMutation = useMutation({
    mutationFn: async ({ id, groupIds }: { id: string; groupIds: string[] }) => {
      await api.post(`/team/members/${id}/groups`, { groupIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
      queryClient.invalidateQueries({ queryKey: ["groups-list"] });
      setOpenGroupEditorId(null);
    },
  });

  // REQ-TEAM-F25: edit profile
  const profileMutation = useMutation({
    mutationFn: async ({ id, ...body }: { id: string; name: string; email: string; billableRate?: number }) => {
      await api.put(`/team/members/${id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
      setEditingMember(null);
    },
  });

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortOrder("asc");
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === data?.members?.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(data?.members?.map((m: any) => m.id) || []);
    }
  };

  // REQ-TEAM-F09: APPLY FILTER applies the free-text search
  const applyFilter = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const clearFilters = () => {
    setStatus("active");
    setSearch("");
    setSearchInput("");
    setRoleFilter([]);
    setGroupFilter([]);
    setPage(1);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  };

  const hasActiveFilters =
    status !== "active" || search !== "" || roleFilter.length > 0 || groupFilter.length > 0;

  const handleExport = async () => {
    const params: any = { status };
    if (search) params.search = search;
    if (roleFilter.length) params.role = roleFilter.join(",");
    if (groupFilter.length) params.group_ids = groupFilter.join(",");
    const response = await api.get("/team/members/export", {
      params,
      responseType: "blob",
    });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `team-members-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  // REQ-TEAM-F19: bulk edit applies role/rate to all selected members
  const handleBulkEdit = async ({ role, rate }: { role?: string; rate?: number }) => {
    for (const id of selectedIds) {
      if (role) await api.post(`/team/members/${id}/roles`, { roles: [role] });
      if (rate !== undefined) await api.patch(`/team/members/${id}/billable-rate`, { rate });
    }
    queryClient.invalidateQueries({ queryKey: ["team-members"] });
    setShowBulkEdit(false);
    setSelectedIds([]);
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-slate-700">FILTER</span>

          {/* REQ-TEAM-F05: single-choice status filter */}
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="px-3 py-1.5 border rounded text-sm"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="invited">Invited</option>
            <option value="all">All</option>
          </select>

          {/* REQ-TEAM-F06: searchable role dropdown with checkboxes + select all */}
          <CheckboxDropdown
            label="Role"
            options={ROLES}
            selected={roleFilter}
            onChange={(next) => { setRoleFilter(next); setPage(1); }}
            searchable
          />

          {/* REQ-TEAM-F07: multi-select group filter with count badge */}
          <CheckboxDropdown
            label="Group"
            options={groups.map((g: any) => ({ value: g.id, label: g.name }))}
            selected={groupFilter}
            onChange={(next) => { setGroupFilter(next); setPage(1); }}
            badge={groupFilter.length}
          />

          {/* REQ-TEAM-F08: search by name or email */}
          <input
            type="text"
            placeholder="Search by name or email"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") applyFilter(); }}
            className="flex-1 min-w-[200px] px-3 py-1.5 border rounded text-sm"
          />

          <button
            onClick={applyFilter}
            className="px-4 py-1.5 border border-indigo-600 text-indigo-600 rounded text-sm hover:bg-indigo-50"
          >
            APPLY FILTER
          </button>

          {/* REQ-TEAM-F10: clear filters */}
          {hasActiveFilters && (
            <button onClick={clearFilters} className="text-sm text-indigo-600 hover:underline">
              Clear filters
            </button>
          )}

          <div className="flex-1"></div>

          <button
            onClick={handleExport}
            className="px-3 py-1.5 border rounded text-sm hover:bg-slate-50"
          >
            Export
          </button>

          {/* Accounts are created in the central User Management app */}
          <a
            href="/usermgmt"
            className="px-4 py-1.5 border border-indigo-300 text-indigo-700 rounded text-sm hover:bg-indigo-50"
          >
            Manage accounts →
          </a>
        </div>
      </div>

      <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2 text-sm text-indigo-900">
        <strong>User accounts are managed centrally.</strong> People are added, edited and
        removed in the CrestSuite <a className="underline" href="/usermgmt">User Management</a>{" "}
        app, which covers ClockIT, Leave Management and QMS. This page shows the roster and
        ClockIT-specific settings (billable rate and groups).
      </div>

      {/* Members table */}
      <div className="bg-white rounded-lg shadow">
        {/* B6: no fixed max-height — the nested scroll trap made the list
            impossible to scroll cleanly and clipped the row dropdowns.
            The page itself scrolls; only horizontal overflow stays local. */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 w-10 bg-slate-50">
                  <input
                    type="checkbox"
                    checked={selectedIds.length > 0 && selectedIds.length === data?.members?.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th
                  className="text-left px-4 py-3 text-sm font-semibold cursor-pointer hover:bg-slate-100 bg-slate-50"
                  onClick={() => handleSort("name")}
                >
                  NAME {sortBy === "name" && (sortOrder === "asc" ? "↑" : "↓")}
                </th>
                <th
                  className="text-left px-4 py-3 text-sm font-semibold cursor-pointer hover:bg-slate-100 bg-slate-50"
                  onClick={() => handleSort("email")}
                >
                  EMAIL {sortBy === "email" && (sortOrder === "asc" ? "↑" : "↓")}
                </th>
                <th className="text-left px-4 py-3 text-sm font-semibold bg-slate-50">BILLABLE RATE (USD)</th>
                <th className="text-left px-4 py-3 text-sm font-semibold bg-slate-50">ROLE</th>
                <th className="text-left px-4 py-3 text-sm font-semibold bg-slate-50">GROUP</th>
                <th className="px-4 py-3 w-10 bg-slate-50"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-500">Loading...</td></tr>
              ) : !data?.members?.length ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-500">No members found</td></tr>
              ) : (
                data.members.map((member: any) => (
                  <tr key={member.id} className="border-b hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(member.id)}
                        onChange={() => toggleSelect(member.id)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {/* REQ-TEAM-F21: strikethrough for deactivated members */}
                      <span className={member.status === "inactive" ? "line-through text-slate-400" : "font-medium"}>
                        {member.name}
                      </span>
                      {member.status === "invited" && (
                        <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-xs">
                          Invited
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{member.email}</td>
                    <td className="px-4 py-3 text-sm">
                      {editingRateId === member.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={rateValue}
                            onChange={(e) => setRateValue(e.target.value)}
                            className="w-20 px-2 py-1 border rounded text-sm"
                            autoFocus
                          />
                          <button
                            onClick={() => {
                              const rate = Number(rateValue);
                              if (!Number.isNaN(rate) && rate >= 0) {
                                rateMutation.mutate({ id: member.id, rate });
                              }
                            }}
                            className="text-indigo-600 text-xs hover:underline"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingRateId(null)}
                            className="text-slate-500 text-xs hover:underline"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          {member.billableRate !== null && <span>${member.billableRate}/hr</span>}
                          <button
                            onClick={() => {
                              setEditingRateId(member.id);
                              setRateValue(member.billableRate !== null ? String(member.billableRate) : "");
                            }}
                            className="text-indigo-600 text-xs hover:underline"
                          >
                            {member.billableRate !== null ? "Change" : "+ Rate"}
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {/* REQ-TEAM-F17: role badge. The directory owns the role,
                          so it is changed via Manage, not here. */}
                      <span
                        title="Roles are set in User Management"
                        className="px-2 py-0.5 bg-slate-100 rounded text-xs"
                      >
                        {ROLES.find((r) => r.value === member.role)?.label ?? member.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="relative inline-block">
                        {member.groups.map((g: any) => (
                          <span key={g.id} className="inline-block px-2 py-0.5 bg-slate-100 rounded text-xs mr-1">
                            {g.name}
                          </span>
                        ))}
                        <button
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setGroupPos({ top: rect.bottom + 4, left: rect.left });
                            setOpenGroupEditorId(openGroupEditorId === member.id ? null : member.id);
                          }}
                          className="text-indigo-600 text-xs hover:underline"
                        >
                          + Group
                        </button>
                        {openGroupEditorId === member.id && groupPos && (
                          <GroupAssignPopover
                            member={member}
                            groups={groups}
                            saving={assignGroupsMutation.isPending}
                            position={groupPos}
                            onApply={(groupIds) =>
                              assignGroupsMutation.mutate({ id: member.id, groupIds })
                            }
                            onClose={() => setOpenGroupEditorId(null)}
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {/* Editing, deactivating and reactivating an account is
                          done centrally in User Management */}
                      <a
                        href={`/usermgmt?user=${encodeURIComponent(member.email)}`}
                        title={`Manage ${member.email} in User Management`}
                        className="text-xs text-indigo-600 hover:underline"
                      >
                        Manage
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.total > 50 && (
          <div className="border-t px-4 py-3 flex items-center justify-between text-sm">
            <div className="text-slate-600">
              Page {data.page} of {Math.ceil(data.total / data.pageSize)}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(page - 1)}
                disabled={page === 1}
                className="px-3 py-1 border rounded disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page >= Math.ceil(data.total / data.pageSize)}
                className="px-3 py-1 border rounded disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <InviteModal
          onClose={() => setShowInviteModal(false)}
          onInvite={(email) => inviteMutation.mutate(email)}
          inviting={inviteMutation.isPending}
          error={(inviteMutation.error as any)?.response?.data?.error}
        />
      )}

      {/* Edit Profile Modal */}
      {editingMember && (
        <EditProfileModal
          member={editingMember}
          onClose={() => setEditingMember(null)}
          onSave={(body) => profileMutation.mutate({ id: editingMember.id, ...body })}
          saving={profileMutation.isPending}
          error={(profileMutation.error as any)?.response?.data?.error}
        />
      )}

      {/* Bulk Edit Modal */}
      {showBulkEdit && (
        <BulkEditModal
          count={selectedIds.length}
          onClose={() => setShowBulkEdit(false)}
          onApply={handleBulkEdit}
        />
      )}
    </div>
  );
}

function GroupAssignPopover({
  member,
  groups,
  saving,
  position,
  onApply,
  onClose,
}: {
  member: any;
  groups: any[];
  saving: boolean;
  position: { top: number; left: number };
  onApply: (groupIds: string[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(member.groups.map((g: any) => g.id));
  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose}></div>
      {/* B6: fixed positioning keeps the popover fully visible above the scroll container */}
      <div
        className="fixed bg-white border rounded shadow-lg z-20 w-56 p-2"
        style={{ top: position.top, left: position.left }}
      >
        {groups.length === 0 ? (
          <div className="px-1 py-2 text-sm text-slate-500">No groups yet</div>
        ) : (
          groups.map((g: any) => (
            <label key={g.id} className="flex items-center gap-2 px-1 py-1 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(g.id)}
                onChange={() => toggle(g.id)}
              />
              {g.name}
            </label>
          ))
        )}
        <div className="flex justify-end gap-2 pt-2 border-t mt-2">
          <button onClick={onClose} className="px-2 py-1 text-xs text-slate-500 hover:underline">
            Cancel
          </button>
          <button
            onClick={() => onApply(selected)}
            disabled={saving}
            className="px-3 py-1 bg-indigo-600 text-white rounded text-xs disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      </div>
    </>
  );
}

function InviteModal({
  onClose,
  onInvite,
  inviting,
  error,
}: {
  onClose: () => void;
  onInvite: (email: string) => void;
  inviting: boolean;
  error?: string;
}) {
  const [email, setEmail] = useState("");
  const isValid = /^\S+@\S+\.\S+$/.test(email);
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-6 border-b">
          <h3 className="text-lg font-semibold">Invite team member</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              className="w-full px-3 py-2 border rounded"
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 p-6 border-t">
          <button onClick={onClose} className="px-4 py-2 border rounded hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={() => onInvite(email)}
            disabled={!isValid || inviting}
            className="px-6 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            INVITE
          </button>
        </div>
      </div>
    </div>
  );
}

function EditProfileModal({
  member,
  onClose,
  onSave,
  saving,
  error,
}: {
  member: any;
  onClose: () => void;
  onSave: (body: { name: string; email: string; billableRate?: number }) => void;
  saving: boolean;
  error?: string;
}) {
  const [name, setName] = useState(member.name);
  const email: string = member.email; // I11: fixed, not editable
  const [rate, setRate] = useState(member.billableRate !== null ? String(member.billableRate) : "");
  const isValid = name.trim().length > 0 && /^\S+@\S+\.\S+$/.test(email);
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-6 border-b">
          <h3 className="text-lg font-semibold">Edit profile</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">×</button>
        </div>
        <div className="p-6 space-y-4">
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
            <label className="block text-sm font-medium mb-1">Email</label>
            {/* I11: the email identifies the account and is not editable */}
            <input
              type="email"
              value={email}
              disabled
              readOnly
              title="Email cannot be changed"
              className="w-full px-3 py-2 border rounded bg-slate-50 text-slate-500 cursor-not-allowed"
            />
            <p className="text-xs text-slate-400 mt-1">Email cannot be changed.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Billable rate (USD/hr)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="w-full px-3 py-2 border rounded"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 p-6 border-t">
          <button onClick={onClose} className="px-4 py-2 border rounded hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={() =>
              onSave({
                name: name.trim(),
                email,
                billableRate: rate === "" ? undefined : Number(rate),
              })
            }
            disabled={!isValid || saving}
            className="px-6 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkEditModal({
  count,
  onClose,
  onApply,
}: {
  count: number;
  onClose: () => void;
  onApply: (changes: { role?: string; rate?: number }) => void;
}) {
  const [role, setRole] = useState("");
  const [rate, setRate] = useState("");
  const [applying, setApplying] = useState(false);
  const hasChanges = role !== "" || rate !== "";
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-6 border-b">
          <h3 className="text-lg font-semibold">Bulk edit {count} members</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2 border rounded"
            >
              <option value="">(no change)</option>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Billable rate (USD/hr)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="(no change)"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="w-full px-3 py-2 border rounded"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 p-6 border-t">
          <button onClick={onClose} className="px-4 py-2 border rounded hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={async () => {
              setApplying(true);
              await onApply({
                role: role || undefined,
                rate: rate === "" ? undefined : Number(rate),
              });
              setApplying(false);
            }}
            disabled={!hasChanges || applying}
            className="px-6 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            APPLY
          </button>
        </div>
      </div>
    </div>
  );
}
