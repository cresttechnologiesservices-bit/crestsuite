import { clockitKey } from "../../lib/storage";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { toast, confirmDialog } from "../ui/notify";
import { usePermissions } from "../../lib/permissions";
import { CreateProjectModal } from "./CreateProjectModal";
import { getFavorites, toggleFavorite } from "./favorites";

type Filters = {
  status: string;
  clients: string[];
  withoutClient: boolean;
  // I21/I22: Access = projects assigned to the selected users/groups
  memberIds: string[];
  billing: string[];
  search: string;
};

const defaultFilters: Filters = {
  status: "active",
  clients: [],
  withoutClient: false,
  memberIds: [],
  billing: [],
  search: "",
};

function filterParams(f: Filters, sortBy: string, sortOrder: string) {
  return {
    status: f.status,
    // B14: trim so a stray leading/trailing space cannot make the search match nothing
    search: f.search.trim() || undefined,
    clients: f.clients.length ? f.clients.join(",") : undefined,
    without_client: f.withoutClient ? "true" : undefined,
    members: f.memberIds.length ? f.memberIds.join(",") : undefined,
    billing: f.billing.length ? f.billing.join(",") : undefined,
    sort_by: sortBy,
    sort_order: sortOrder,
  };
}

// I10: applied filters survive tab navigation within the session
const STORAGE_KEY = clockitKey("projects.filters");

function loadPersisted() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      applied: { ...defaultFilters, ...(parsed.applied ?? {}) } as Filters,
      sortBy: typeof parsed.sortBy === "string" ? parsed.sortBy : "name",
      sortOrder: parsed.sortOrder === "desc" ? ("desc" as const) : ("asc" as const),
    };
  } catch {
    return null;
  }
}

export function ProjectsList() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [draft, setDraft] = useState<Filters>(() => loadPersisted()?.applied ?? defaultFilters);
  const [applied, setApplied] = useState<Filters>(() => loadPersisted()?.applied ?? defaultFilters);
  const [sortBy, setSortBy] = useState(() => loadPersisted()?.sortBy ?? "name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(() => loadPersisted()?.sortOrder ?? "asc");

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ applied, sortBy, sortOrder }));
    } catch {
      /* storage unavailable */
    }
  }, [applied, sortBy, sortOrder]);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(getFavorites());
  const [clientFilterSearch, setClientFilterSearch] = useState("");
  const [clientFilterShow, setClientFilterShow] = useState("active");

  const { data, isLoading } = useQuery({
    queryKey: ["projects", applied, sortBy, sortOrder],
    queryFn: async () =>
      (await api.get("/projects", { params: filterParams(applied, sortBy, sortOrder) })).data,
  });
  const projects: any[] = data?.items ?? [];

  const { data: filterClients = [] } = useQuery({
    queryKey: ["clients", clientFilterShow, clientFilterSearch],
    queryFn: async () =>
      (await api.get("/clients", { params: { status: clientFilterShow, search: clientFilterSearch } })).data,
  });

  const archiveMutation = useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      await api.post(`/projects/${id}/${archived ? "restore" : "archive"}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/projects/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
    onError: () => toast("Cannot delete: project has time entries. Archive it instead.", "error"),
  });

  const toggleSort = (col: string) => {
    if (sortBy === col) setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    else {
      setSortBy(col);
      setSortOrder("asc");
    }
  };

  const toggleSet = (arr: string[], value: string) =>
    arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = projects.length > 0 && projects.every((p) => selected.has(p.id));

  // B4: export through the authenticated axios client (correct /clockit/api base
  // path + session cookie) and download as a blob. The old window.open("/api/...")
  // navigated outside the app, hit the portal unauthenticated and kicked the user
  // to the login screen.
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const response = await api.get("/projects/export", {
        params: filterParams(applied, sortBy, sortOrder),
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `projects-${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast("Export failed. Please try again.", "error");
    } finally {
      setExporting(false);
    }
  };

  const sortHeader = (label: string, col: string) => (
    <th
      className="text-left px-4 py-3 text-sm font-semibold cursor-pointer select-none hover:text-indigo-600"
      onClick={() => toggleSort(col)}
    >
      {label} {sortBy === col ? (sortOrder === "asc" ? "▲" : "▼") : ""}
    </th>
  );

  const filterButton = (key: string, label: string, active: boolean) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setOpenFilter(openFilter === key ? null : key);
      }}
      className={`px-3 py-2 border rounded text-sm ${active ? "border-indigo-500 text-indigo-600 bg-indigo-50" : "hover:bg-slate-50"}`}
    >
      {label} ▾
    </button>
  );

  return (
    <div
      className="p-6 max-w-7xl mx-auto"
      onClick={() => {
        setOpenFilter(null);
        setMenuFor(null);
      }}
    >
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Projects</h1>
        {/* Hidden unless the role may create projects (API enforces it too) */}
        {can("projects", "create") && (
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            + CREATE NEW PROJECT
          </button>
        )}
      </div>

      {/* Filter bar (sticky) */}
      <div className="bg-white rounded-lg shadow p-4 mb-4 sticky top-0 z-20">
        <div className="flex gap-3 items-center flex-wrap">
          <span className="text-xs font-semibold text-slate-500">FILTER</span>

          <select
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value })}
            className="px-3 py-2 border rounded text-sm"
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>

          {/* Client filter */}
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            {filterButton("client", "Client", draft.clients.length > 0 || draft.withoutClient)}
            {openFilter === "client" && (
              <div className="absolute top-11 left-0 z-30 bg-white border rounded shadow-lg w-64 p-3">
                <input
                  type="text"
                  placeholder="Search clients"
                  value={clientFilterSearch}
                  onChange={(e) => setClientFilterSearch(e.target.value)}
                  className="w-full px-2 py-1.5 border rounded text-sm mb-2"
                />
                <div className="flex items-center justify-between mb-2 text-xs text-slate-500">
                  <span className="font-semibold">SHOW</span>
                  <select
                    value={clientFilterShow}
                    onChange={(e) => setClientFilterShow(e.target.value)}
                    className="border rounded px-1 py-0.5 text-xs"
                  >
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                    <option value="all">All</option>
                  </select>
                </div>
                <div className="max-h-48 overflow-y-auto text-sm space-y-1">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={filterClients.length > 0 && filterClients.every((c: any) => draft.clients.includes(c.id))}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          clients: e.target.checked ? filterClients.map((c: any) => c.id) : [],
                        })
                      }
                    />
                    Select all
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.withoutClient}
                      onChange={(e) => setDraft({ ...draft, withoutClient: e.target.checked })}
                    />
                    Without Client
                  </label>
                  {filterClients.map((c: any) => (
                    <label key={c.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={draft.clients.includes(c.id)}
                        onChange={() => setDraft({ ...draft, clients: toggleSet(draft.clients, c.id) })}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* I21/I22: Access filter — users & groups the projects are assigned to */}
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            {filterButton("access", "Access", draft.memberIds.length > 0)}
            {openFilter === "access" && (
              <AccessFilterDropdown
                selected={draft.memberIds}
                onApply={(memberIds) => {
                  const next = { ...draft, memberIds };
                  setDraft(next);
                  setApplied(next);
                  setOpenFilter(null);
                }}
              />
            )}
          </div>

          {/* Billing filter */}
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            {filterButton("billing", "Billing", draft.billing.length > 0)}
            {openFilter === "billing" && (
              <div className="absolute top-11 left-0 z-30 bg-white border rounded shadow-lg w-44 p-3 text-sm space-y-1">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.billing.includes("billable")}
                    onChange={() => setDraft({ ...draft, billing: toggleSet(draft.billing, "billable") })}
                  />
                  Billable
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.billing.includes("nonbillable")}
                    onChange={() => setDraft({ ...draft, billing: toggleSet(draft.billing, "nonbillable") })}
                  />
                  Non billable
                </label>
              </div>
            )}
          </div>

          <input
            type="text"
            placeholder="Find by name..."
            value={draft.search}
            onChange={(e) => setDraft({ ...draft, search: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") setApplied(draft);
            }}
            className="flex-1 min-w-[160px] px-3 py-2 border rounded text-sm"
          />
          <button
            onClick={() => setApplied(draft)}
            className="px-4 py-2 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700"
          >
            APPLY FILTER
          </button>
          {/* I23: reset every filter back to its default */}
          <button
            onClick={() => {
              setDraft(defaultFilters);
              setApplied(defaultFilters);
              setSortBy("name");
              setSortOrder("asc");
              try {
                sessionStorage.removeItem(STORAGE_KEY);
              } catch {
                /* ignore */
              }
            }}
            className="px-3 py-2 text-sm text-indigo-600 hover:underline"
          >
            Clear Filter
          </button>
        </div>
      </div>

      <div className="flex justify-end mb-2">
        <button
          onClick={exportCsv}
          disabled={exporting}
          className="px-3 py-1.5 border rounded text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {exporting ? "Exporting..." : "Export ▾ (CSV)"}
        </button>
      </div>

      <div className="bg-white rounded-lg shadow">
        <table className="w-full">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() =>
                    setSelected(allSelected ? new Set() : new Set<string>(projects.map((p) => p.id)))
                  }
                />
              </th>
              <th className="w-8"></th>
              {sortHeader("NAME", "name")}
              {sortHeader("CLIENT", "client")}
              {sortHeader("TRACKED", "tracked")}
              {sortHeader("AMOUNT", "amount")}
              {sortHeader("PROGRESS", "progress")}
              <th className="text-left px-4 py-3 text-sm font-semibold">ACCESS</th>
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={9} className="text-center py-12 text-slate-500">Loading...</td></tr>
            ) : projects.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-12 text-slate-500">No projects found</td></tr>
            ) : (
              projects.map((p) => (
                <ProjectRow
                  key={p.id}
                  project={p}
                  expanded={expanded.has(p.id)}
                  onToggleExpand={() => toggleExpanded(p.id)}
                  selected={selected.has(p.id)}
                  onToggleSelect={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(p.id)) next.delete(p.id);
                      else next.add(p.id);
                      return next;
                    })
                  }
                  favorite={favorites.has(p.id)}
                  onToggleFavorite={() => setFavorites(new Set(toggleFavorite(p.id)))}
                  menuOpen={menuFor === p.id}
                  onToggleMenu={() => setMenuFor(menuFor === p.id ? null : p.id)}
                  onArchive={() => archiveMutation.mutate({ id: p.id, archived: p.status === "ARCHIVED" })}
                  onDelete={async () => {
                    if (await confirmDialog({ title: "Delete project", message: `Delete project "${p.name}"?`, confirmLabel: "Delete", danger: true })) deleteMutation.mutate(p.id);
                  }}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateProjectModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

// I21/I22: Access dropdown — search users or groups, filter by active status,
// select-all / group / user checkboxes, and an Apply button that narrows the
// project list to projects assigned to the selection.
function AccessFilterDropdown({
  selected,
  onApply,
}: {
  selected: string[];
  onApply: (memberIds: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [picked, setPicked] = useState<string[]>(selected);

  const { data } = useQuery({
    queryKey: ["projects-access-filter", search, status],
    queryFn: async () =>
      (await api.get("/reports/filters/team", { params: { search, status } })).data,
  });

  const users: any[] = data?.users ?? [];
  const groups: any[] = data?.groups ?? [];
  const allUserIds: string[] = users.map((u) => u.id);
  const allSelected = allUserIds.length > 0 && allUserIds.every((id) => picked.includes(id));

  const toggleUser = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="absolute top-11 left-0 z-30 bg-white border rounded shadow-lg w-72 p-3 text-sm">
      <input
        type="text"
        placeholder="Search Users or Groups"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-2 py-1.5 border rounded text-sm mb-2"
        autoFocus
      />
      <div className="flex items-center justify-between mb-2 text-xs text-slate-500">
        <span className="font-semibold uppercase">Show</span>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border rounded px-1 py-0.5 text-xs"
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      <label className="flex items-center gap-2 font-medium border-b pb-2 mb-2">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={(e) => setPicked(e.target.checked ? allUserIds : [])}
        />
        Select All
      </label>
      <div className="max-h-56 overflow-y-auto space-y-1">
        {groups.length > 0 && (
          <div className="text-xs font-semibold text-slate-500 uppercase">Groups</div>
        )}
        {groups.map((g) => {
          const memberIds: string[] = (g.members || []).map((m: any) => m.userId);
          const groupSelected = memberIds.length > 0 && memberIds.every((id) => picked.includes(id));
          return (
            <label key={g.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={groupSelected}
                onChange={(e) => {
                  const rest = picked.filter((id) => !memberIds.includes(id));
                  setPicked(e.target.checked ? [...rest, ...memberIds] : rest);
                }}
              />
              <span className="font-medium">{g.name}</span>
              <span className="text-slate-400">({g.members?.length || 0})</span>
            </label>
          );
        })}
        {users.length > 0 && (
          <div className="text-xs font-semibold text-slate-500 uppercase pt-1">Users</div>
        )}
        {users.map((u) => (
          <label key={u.id} className="flex items-center gap-2">
            <input type="checkbox" checked={picked.includes(u.id)} onChange={() => toggleUser(u.id)} />
            {u.name}
          </label>
        ))}
        {users.length === 0 && groups.length === 0 && (
          <div className="text-slate-500 py-1">No matches</div>
        )}
      </div>
      <div className="flex justify-end pt-2 border-t mt-2">
        <button
          onClick={() => onApply(picked)}
          className="px-4 py-1.5 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700"
        >
          APPLY
        </button>
      </div>
    </div>
  );
}

function ProjectRow({
  project: p,
  expanded,
  onToggleExpand,
  selected,
  onToggleSelect,
  favorite,
  onToggleFavorite,
  menuOpen,
  onToggleMenu,
  onArchive,
  onDelete,
}: {
  project: any;
  expanded: boolean;
  onToggleExpand: () => void;
  selected: boolean;
  onToggleSelect: () => void;
  favorite: boolean;
  onToggleFavorite: () => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const tracked = `${(p.trackedHours ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}h`;
  const amount = `${(p.amount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
  return (
    <>
      <tr className="border-b hover:bg-slate-50">
        <td className="px-4 py-3">
          <input type="checkbox" checked={selected} onChange={onToggleSelect} />
        </td>
        <td className="py-3">
          <button onClick={onToggleExpand} className="px-1 text-slate-400 hover:text-slate-700">
            {expanded ? "▾" : "▸"}
          </button>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
            <Link to={`/projects/${p.id}#tasks`} className="font-medium hover:text-indigo-600">
              {p.name}
            </Link>
            {p.status === "ARCHIVED" && (
              <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded">Archived</span>
            )}
          </div>
        </td>
        <td className="px-4 py-3 text-sm">{p.client?.name || "–"}</td>
        <td className="px-4 py-3 text-sm text-right tabular-nums">{tracked}</td>
        <td className="px-4 py-3 text-sm text-right tabular-nums">{amount}</td>
        <td className="px-4 py-3 text-sm">
          {p.progress === null || p.progress === undefined ? (
            "-"
          ) : (
            <div className="w-24 bg-slate-200 rounded h-2" title={`${p.progress.toFixed(0)}%`}>
              <div className="bg-indigo-500 h-2 rounded" style={{ width: `${Math.min(100, p.progress)}%` }} />
            </div>
          )}
        </td>
        <td className="px-4 py-3 text-sm capitalize">{p.visibility}</td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-1 relative">
            <button
              onClick={onToggleFavorite}
              title={favorite ? "Remove from favorites" : "Add to favorites"}
              className={favorite ? "text-yellow-500" : "text-slate-300 hover:text-yellow-500"}
            >
              ★
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleMenu();
              }}
              className="p-1 text-slate-500 hover:text-slate-800 rounded hover:bg-slate-100"
            >
              ⋮
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-8 z-10 bg-white border rounded shadow-lg w-40 py-1 text-sm"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={async () => {
                    if (await confirmDialog({ title: p.status === "ARCHIVED" ? "Restore project" : "Archive project", message: `${p.status === "ARCHIVED" ? "Restore" : "Archive"} project "${p.name}"?`, confirmLabel: p.status === "ARCHIVED" ? "Restore" : "Archive" })) onArchive();
                  }}
                  className="block w-full text-left px-3 py-1.5 hover:bg-slate-50"
                >
                  {p.status === "ARCHIVED" ? "Restore" : "Archive"}
                </button>
                <button onClick={onDelete} className="block w-full text-left px-3 py-1.5 text-red-600 hover:bg-red-50">
                  Delete
                </button>
              </div>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b bg-slate-50">
          <td colSpan={9} className="px-12 py-3">
            <div className="grid grid-cols-5 gap-4 text-sm">
              <div>
                <div className="text-xs font-semibold text-slate-500">CLIENT</div>
                <div>{p.client?.name || "–"}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">TRACKED</div>
                <div className="tabular-nums">{tracked}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">PROGRESS</div>
                <div>{p.progress === null || p.progress === undefined ? "–" : `${p.progress.toFixed(0)}%`}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">ACCESS</div>
                <div className="capitalize">{p.visibility}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">FAVORITES</div>
                <button
                  onClick={onToggleFavorite}
                  className={favorite ? "text-yellow-500" : "text-slate-300 hover:text-yellow-500"}
                >
                  ★
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
