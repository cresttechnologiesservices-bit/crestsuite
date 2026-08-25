import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export type ColumnVisibility = Record<string, boolean>;

// REQ-REP-F47: every column checked by default
export const DEFAULT_VISIBLE_COLUMNS: ColumnVisibility = {
  client: true,
  description: true,
  project: true,
  status: true,
  tag: true,
  task: true,
  team: true,
};

interface ReportsFiltersProps {
  filters: any;
  onChange: (filters: any) => void;
  visibleColumns: ColumnVisibility;
  onVisibleColumnsChange: (columns: ColumnVisibility) => void;
}

/**
 * id -> display name for every filterable entity, so applied filters can be
 * shown by name instead of just a count. Fetched with status=all so selections
 * that later became inactive still resolve.
 */
function useFilterLabels() {
  const { data: team } = useQuery({
    queryKey: ["filter-labels", "team"],
    queryFn: async () => (await api.get("/reports/filters/team", { params: { status: "all" } })).data,
  });
  const { data: clients } = useQuery({
    queryKey: ["filter-labels", "clients"],
    queryFn: async () => (await api.get("/reports/filters/clients", { params: { status: "all" } })).data,
  });
  const { data: projects } = useQuery({
    queryKey: ["filter-labels", "projects"],
    queryFn: async () => (await api.get("/reports/filters/projects", { params: { status: "all" } })).data,
  });
  const { data: tasks } = useQuery({
    queryKey: ["filter-labels", "tasks"],
    queryFn: async () => (await api.get("/reports/filters/tasks", { params: { status: "all" } })).data,
  });

  const labels: Record<string, string> = {};
  (team?.users ?? []).forEach((u: any) => (labels[u.id] = u.name));
  (team?.groups ?? []).forEach((g: any) => (labels[g.id] = g.name));
  (clients ?? []).forEach((c: any) => (labels[c.id] = c.name));
  (projects ?? []).forEach((p: any) => (labels[p.id] = p.name));
  (tasks ?? []).forEach((t: any) => (labels[t.id] = t.name));
  return labels;
}

/** Human-readable summary of the values selected in one filter category. */
function summarize(ids: string[] | undefined, labels: Record<string, string>, extra?: string) {
  const names = (ids ?? []).map((id) => labels[id] ?? "…");
  if (extra) names.push(extra);
  if (names.length === 0) return null;
  if (names.length <= 2) return names.join(", ");
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

export function ReportsFilters({
  filters,
  onChange,
  visibleColumns,
  onVisibleColumnsChange,
}: ReportsFiltersProps) {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  // REQ-REP-F06: filters are drafted locally and applied via APPLY FILTER
  const [draft, setDraft] = useState<any>(filters);

  // I13: only admins/managers can pick other users' data; the Team filter
  // (self or any individual user/group) is hidden for plain members.
  const { data: profile } = useQuery({
    queryKey: ["user-profile"],
    queryFn: async () => (await api.get("/users/me")).data,
  });
  const canViewTeam = profile ? ["OWNER", "ADMIN", "MANAGER"].includes(profile.role) : false;

  useEffect(() => {
    setDraft(filters);
  }, [filters]);

  const toggle = (name: string) => setOpenDropdown(openDropdown === name ? null : name);
  const updateDraft = (key: string, value: any) => {
    setDraft((prev: any) => ({ ...prev, [key]: value }));
  };

  const applyFilters = () => {
    // REQ-REP-F70: AND across categories; scope switches to team when team members selected
    const next = { ...draft };
    if (next.team_ids?.length) next.scope = "team";
    else delete next.scope;
    onChange(next);
    setOpenDropdown(null);
  };

  const clearAll = () => {
    setDraft({});
    onChange({});
  };

  const hasFilters = Object.values({ ...filters, ...draft }).some((v) =>
    Array.isArray(v) ? v.length > 0 : v !== undefined && v !== "" && v !== false
  );

  const labels = useFilterLabels();

  // Applied (not draft) filters, shown as named chips so it is always clear
  // which filter is active. Each chip removes just that category.
  const appliedChips: { key: string; label: string; clear: () => void }[] = [];
  const addChip = (key: string, label: string | null, clear: () => void) => {
    if (label) appliedChips.push({ key, label, clear });
  };
  const without = (...keys: string[]) => {
    const next = { ...filters };
    keys.forEach((k) => delete next[k]);
    if (!next.team_ids?.length) delete next.scope;
    onChange(next);
  };
  addChip("team", summarize(filters.team_ids, labels), () => without("team_ids", "scope"));
  addChip(
    "client",
    summarize(filters.client_ids, labels, filters.without_client ? "Without client" : undefined),
    () => without("client_ids", "without_client")
  );
  addChip(
    "project",
    summarize(filters.project_ids, labels, filters.without_project ? "Without project" : undefined),
    () => without("project_ids", "without_project")
  );
  addChip(
    "task",
    summarize(filters.task_ids, labels, filters.without_task ? "Without task" : undefined),
    () => without("task_ids", "without_task")
  );
  addChip(
    "tag",
    summarize(filters.tags, {}, filters.without_tag ? "Without tag" : undefined) ??
      (filters.tags?.length ? filters.tags.join(", ") : null),
    () => without("tags", "without_tag")
  );
  addChip(
    "status",
    filters.billable?.length
      ? filters.billable.map((b: boolean) => (b ? "Billable" : "Non-billable")).join(", ")
      : null,
    () => without("billable")
  );
  addChip(
    "description",
    filters.without_description
      ? "Without description"
      : filters.description
        ? `"${filters.description}"`
        : null,
    () => without("description", "without_description")
  );

  const CHIP_TITLES: Record<string, string> = {
    team: "Team",
    client: "Client",
    project: "Project",
    task: "Task",
    tag: "Tag",
    status: "Status",
    description: "Description",
  };

  return (
    <>
    {appliedChips.length > 0 && (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-500 uppercase">Active filters</span>
        {appliedChips.map((chip) => (
          <span
            key={chip.key}
            className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-50 border border-indigo-200 text-indigo-800 rounded text-xs"
          >
            <span className="font-semibold">{CHIP_TITLES[chip.key]}:</span>
            <span>{chip.label}</span>
            <button
              onClick={chip.clear}
              title={`Remove ${CHIP_TITLES[chip.key]} filter`}
              className="ml-0.5 text-indigo-500 hover:text-indigo-900 font-bold leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <button onClick={clearAll} className="text-xs text-indigo-600 hover:underline">
          Clear all
        </button>
      </div>
    )}
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {/* REQ-REP-F46: FILTER control opens column-visibility checklist */}
      <ColumnVisibilityDropdown
        open={openDropdown === "columns"}
        onToggle={() => toggle("columns")}
        visibleColumns={visibleColumns}
        onChange={onVisibleColumnsChange}
      />

      {canViewTeam && (
        <MultiSelectDropdown
          label="Team"
          open={openDropdown === "team"}
          onToggle={() => toggle("team")}
          selectedCount={draft.team_ids?.length || 0}
          selectedLabel={summarize(draft.team_ids, labels)}
          onClear={() => updateDraft("team_ids", [])}
        >
          <TeamFilterContent
            selected={draft.team_ids || []}
            onChange={(ids) => updateDraft("team_ids", ids)}
          />
        </MultiSelectDropdown>
      )}

      <MultiSelectDropdown
        label="Client"
        open={openDropdown === "client"}
        onToggle={() => toggle("client")}
        selectedCount={(draft.client_ids?.length || 0) + (draft.without_client ? 1 : 0)}
        selectedLabel={summarize(draft.client_ids, labels, draft.without_client ? "Without client" : undefined)}
        onClear={() => setDraft((p: any) => ({ ...p, client_ids: [], without_client: false }))}
      >
        <ClientFilterContent
          selected={draft.client_ids || []}
          onChange={(ids) => updateDraft("client_ids", ids)}
          withoutClient={!!draft.without_client}
          onWithoutClientChange={(v) => updateDraft("without_client", v)}
        />
      </MultiSelectDropdown>

      <MultiSelectDropdown
        label="Project"
        open={openDropdown === "project"}
        onToggle={() => toggle("project")}
        selectedCount={(draft.project_ids?.length || 0) + (draft.without_project ? 1 : 0)}
        selectedLabel={summarize(draft.project_ids, labels, draft.without_project ? "Without project" : undefined)}
        onClear={() => setDraft((p: any) => ({ ...p, project_ids: [], without_project: false }))}
      >
        <ProjectFilterContent
          selected={draft.project_ids || []}
          onChange={(ids) => updateDraft("project_ids", ids)}
          withoutProject={!!draft.without_project}
          onWithoutProjectChange={(v) => updateDraft("without_project", v)}
        />
      </MultiSelectDropdown>

      <MultiSelectDropdown
        label="Task"
        open={openDropdown === "task"}
        onToggle={() => toggle("task")}
        selectedCount={(draft.task_ids?.length || 0) + (draft.without_task ? 1 : 0)}
        selectedLabel={summarize(draft.task_ids, labels, draft.without_task ? "Without task" : undefined)}
        onClear={() => setDraft((p: any) => ({ ...p, task_ids: [], without_task: false }))}
      >
        <TaskFilterContent
          selected={draft.task_ids || []}
          onChange={(ids) => updateDraft("task_ids", ids)}
          withoutTask={!!draft.without_task}
          onWithoutTaskChange={(v) => updateDraft("without_task", v)}
        />
      </MultiSelectDropdown>

      <MultiSelectDropdown
        label="Tag"
        open={openDropdown === "tag"}
        onToggle={() => toggle("tag")}
        selectedCount={(draft.tags?.length || 0) + (draft.without_tag ? 1 : 0)}
        selectedLabel={summarize(draft.tags, {}, draft.without_tag ? "Without tag" : undefined) ?? (draft.tags?.length ? draft.tags.join(", ") : null)}
        onClear={() => setDraft((p: any) => ({ ...p, tags: [], without_tag: false }))}
      >
        <TagFilterContent
          selected={draft.tags || []}
          onChange={(tags) => updateDraft("tags", tags)}
          withoutTag={!!draft.without_tag}
          onWithoutTagChange={(v) => updateDraft("without_tag", v)}
        />
      </MultiSelectDropdown>

      <MultiSelectDropdown
        label="Status"
        open={openDropdown === "status"}
        onToggle={() => toggle("status")}
        selectedCount={draft.billable?.length || 0}
        selectedLabel={draft.billable?.length ? draft.billable.map((b: boolean) => (b ? "Billable" : "Non-billable")).join(", ") : null}
        onClear={() => updateDraft("billable", [])}
      >
        {/* REQ-REP-F66: BILLABLE section */}
        <div className="p-3">
          <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Billable</div>
          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.billable?.includes(true) || false}
                onChange={(e) => {
                  const current = draft.billable || [];
                  const next = e.target.checked
                    ? [...current, true]
                    : current.filter((x: any) => x !== true);
                  updateDraft("billable", next);
                }}
              />
              <span className="text-sm">Billable</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.billable?.includes(false) || false}
                onChange={(e) => {
                  const current = draft.billable || [];
                  const next = e.target.checked
                    ? [...current, false]
                    : current.filter((x: any) => x !== false);
                  updateDraft("billable", next);
                }}
              />
              <span className="text-sm">Non-billable</span>
            </label>
          </div>
        </div>
      </MultiSelectDropdown>

      {/* REQ-REP-F67, F68: Description filter with "Without description" */}
      <MultiSelectDropdown
        label="Description"
        open={openDropdown === "description"}
        onToggle={() => toggle("description")}
        selectedCount={(draft.description ? 1 : 0) + (draft.without_description ? 1 : 0)}
        selectedLabel={draft.without_description ? "Without description" : draft.description ? `"${draft.description}"` : null}
        onClear={() => setDraft((p: any) => ({ ...p, description: "", without_description: false }))}
      >
        <div className="p-3 space-y-2">
          <input
            type="text"
            placeholder="Enter description..."
            value={draft.description || ""}
            disabled={!!draft.without_description}
            onChange={(e) => updateDraft("description", e.target.value)}
            className="w-full px-2 py-1 border rounded text-sm disabled:bg-slate-50"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!draft.without_description}
              onChange={(e) => updateDraft("without_description", e.target.checked)}
            />
            Without description
          </label>
        </div>
      </MultiSelectDropdown>

      {/* REQ-REP-F06: APPLY FILTER */}
      <button
        onClick={applyFilters}
        className="px-4 py-1.5 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700"
      >
        APPLY FILTER
      </button>

      {hasFilters && (
        <button onClick={clearAll} className="text-sm text-indigo-600 hover:underline">
          Clear filters
        </button>
      )}
    </div>
    </>
  );
}

// REQ-REP-F46..F48: column visibility checklist panel
function ColumnVisibilityDropdown({
  open,
  onToggle,
  visibleColumns,
  onChange,
}: {
  open: boolean;
  onToggle: () => void;
  visibleColumns: ColumnVisibility;
  onChange: (columns: ColumnVisibility) => void;
}) {
  const columns = [
    { key: "client", label: "Client" },
    { key: "description", label: "Description" },
    { key: "project", label: "Project" },
    { key: "status", label: "Status" },
    { key: "tag", label: "Tag" },
    { key: "task", label: "Task" },
    { key: "team", label: "Team" },
  ];

  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className="px-3 py-1.5 text-sm font-medium text-slate-700 border rounded flex items-center gap-2 hover:bg-slate-50"
      >
        FILTER
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={onToggle} />
          <div className="absolute top-full mt-1 left-0 w-56 bg-white border rounded-lg shadow-lg z-20 p-3">
            <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Show columns</div>
            <div className="space-y-1">
              {columns.map((col) => (
                <label key={col.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={visibleColumns[col.key] !== false}
                    onChange={(e) =>
                      onChange({ ...visibleColumns, [col.key]: e.target.checked })
                    }
                  />
                  {col.label}
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MultiSelectDropdown({
  label,
  open,
  onToggle,
  selectedCount,
  selectedLabel,
  onClear,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  selectedCount: number;
  /** Names of the values selected in this category (shown on the control) */
  selectedLabel?: string | null;
  onClear: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        title={selectedLabel ? `${label}: ${selectedLabel}` : label}
        className={`px-3 py-1.5 border rounded text-sm flex items-center gap-2 hover:bg-slate-50 max-w-[240px] ${
          selectedCount > 0 ? "border-indigo-300 bg-indigo-50 text-indigo-800" : ""
        }`}
      >
        <span className="shrink-0">{label}</span>
        {selectedLabel && (
          <span className="truncate font-medium">: {selectedLabel}</span>
        )}
        {selectedCount > 0 && !selectedLabel && (
          <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full">
            {selectedCount}
          </span>
        )}
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={onToggle} />
          <div className="absolute top-full mt-1 left-0 w-72 bg-white border rounded-lg shadow-lg z-20 max-h-96 overflow-y-auto">
            {selectedCount > 0 && (
              <div className="p-2 border-b">
                <button onClick={onClear} className="text-xs text-indigo-600 hover:underline">
                  Clear selection
                </button>
              </div>
            )}
            {children}
          </div>
        </>
      )}
    </div>
  );
}

// REQ-REP-F50 etc: SHOW status toggle shared by several filters
function StatusToggle({
  status,
  onChange,
}: {
  status: string;
  onChange: (status: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-xs font-semibold text-slate-500 uppercase">Show</span>
      <select
        value={status}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-0.5 border rounded text-xs"
      >
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="all">All</option>
      </select>
    </div>
  );
}

function SelectAllCheckbox({
  allIds,
  selected,
  onChange,
}: {
  allIds: string[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.includes(id));
  return (
    <label className="flex items-center gap-2 text-sm font-medium border-b pb-2 mb-2">
      <input
        type="checkbox"
        checked={allSelected}
        onChange={(e) => onChange(e.target.checked ? allIds : [])}
      />
      Select all
    </label>
  );
}

// REQ-REP-F49..F53: Team filter
function TeamFilterContent({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const { data } = useQuery({
    queryKey: ["reports-team-filter", search, status],
    queryFn: async () =>
      (await api.get("/reports/filters/team", { params: { search, status } })).data,
  });

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const allUserIds: string[] = (data?.users || []).map((u: any) => u.id);

  return (
    <div className="p-3">
      <input
        type="text"
        placeholder="Search users or groups..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-2 py-1 border rounded text-sm mb-2"
      />
      <StatusToggle status={status} onChange={setStatus} />
      <SelectAllCheckbox allIds={allUserIds} selected={selected} onChange={onChange} />
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {data?.groups?.length > 0 && (
          <div className="text-xs font-semibold text-slate-500 uppercase">Groups</div>
        )}
        {data?.groups?.map((g: any) => {
          const memberIds: string[] = (g.members || []).map((m: any) => m.userId);
          const groupSelected = memberIds.length > 0 && memberIds.every((id) => selected.includes(id));
          return (
            <label key={g.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={groupSelected}
                onChange={(e) => {
                  // Selecting a group selects all of its members
                  const rest = selected.filter((id) => !memberIds.includes(id));
                  onChange(e.target.checked ? [...rest, ...memberIds] : rest);
                }}
              />
              <span className="font-medium">{g.name}</span>
              <span className="text-slate-500">({g.members?.length || 0})</span>
            </label>
          );
        })}
        {data?.users?.length > 0 && (
          <div className="text-xs font-semibold text-slate-500 uppercase pt-1">Users</div>
        )}
        {data?.users?.map((u: any) => (
          <label key={u.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
            <span>{u.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// REQ-REP-F54, F55: Client filter
function ClientFilterContent({
  selected,
  onChange,
  withoutClient,
  onWithoutClientChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  withoutClient: boolean;
  onWithoutClientChange: (v: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const { data = [] } = useQuery({
    queryKey: ["reports-client-filter", search, status],
    queryFn: async () =>
      (await api.get("/reports/filters/clients", { params: { search, status } })).data,
  });

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <div className="p-3">
      <input
        type="text"
        placeholder="Search clients..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-2 py-1 border rounded text-sm mb-2"
      />
      <StatusToggle status={status} onChange={setStatus} />
      <SelectAllCheckbox allIds={data.map((c: any) => c.id)} selected={selected} onChange={onChange} />
      <label className="flex items-center gap-2 text-sm mb-2">
        <input
          type="checkbox"
          checked={withoutClient}
          onChange={(e) => onWithoutClientChange(e.target.checked)}
        />
        Without Client
      </label>
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {data.map((c: any) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
            <span>{c.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// REQ-REP-F56..F58: Project filter grouped by client
function ProjectFilterContent({
  selected,
  onChange,
  withoutProject,
  onWithoutProjectChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  withoutProject: boolean;
  onWithoutProjectChange: (v: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const { data = [] } = useQuery({
    queryKey: ["reports-project-filter", search, status],
    queryFn: async () =>
      (await api.get("/reports/filters/projects", { params: { search, status } })).data,
  });

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  // REQ-REP-F58: group by client
  const grouped: Record<string, any[]> = {};
  data.forEach((p: any) => {
    const client = p.client?.name || "NO CLIENT";
    if (!grouped[client]) grouped[client] = [];
    grouped[client].push(p);
  });

  return (
    <div className="p-3">
      <input
        type="text"
        placeholder="Search Projects..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-2 py-1 border rounded text-sm mb-2"
      />
      <StatusToggle status={status} onChange={setStatus} />
      <SelectAllCheckbox allIds={data.map((p: any) => p.id)} selected={selected} onChange={onChange} />
      <label className="flex items-center gap-2 text-sm mb-2">
        <input
          type="checkbox"
          checked={withoutProject}
          onChange={(e) => onWithoutProjectChange(e.target.checked)}
        />
        Without Project
      </label>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {Object.entries(grouped).map(([client, projects]) => (
          <div key={client}>
            <div className="text-xs font-semibold text-slate-500 uppercase mb-1">{client}</div>
            {projects.map((p: any) => (
              <label key={p.id} className="flex items-center gap-2 text-sm ml-2">
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  onChange={() => toggle(p.id)}
                />
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                <span>{p.name}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// REQ-REP-F59..F62: Task filter grouped by parent project
function TaskFilterContent({
  selected,
  onChange,
  withoutTask,
  onWithoutTaskChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  withoutTask: boolean;
  onWithoutTaskChange: (v: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const { data = [] } = useQuery({
    queryKey: ["reports-task-filter", search, status],
    queryFn: async () =>
      (await api.get("/reports/filters/tasks", { params: { search, status } })).data,
  });

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  // REQ-REP-F61: group under "PROJECT:CLIENT" headers
  const grouped: Record<string, any[]> = {};
  data.forEach((t: any) => {
    const project = t.project?.name || "NO PROJECT";
    const client = t.project?.client?.name;
    const header = client ? `${project}:${client}` : project;
    if (!grouped[header]) grouped[header] = [];
    grouped[header].push(t);
  });

  return (
    <div className="p-3">
      <input
        type="text"
        placeholder="Search Tasks..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-2 py-1 border rounded text-sm mb-2"
      />
      <StatusToggle status={status} onChange={setStatus} />
      <SelectAllCheckbox allIds={data.map((t: any) => t.id)} selected={selected} onChange={onChange} />
      <label className="flex items-center gap-2 text-sm mb-2">
        <input
          type="checkbox"
          checked={withoutTask}
          onChange={(e) => onWithoutTaskChange(e.target.checked)}
        />
        Without Task
      </label>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {Object.entries(grouped).map(([header, tasks]) => (
          <div key={header}>
            <div className="text-xs font-semibold text-slate-500 uppercase mb-1">{header}</div>
            {tasks.map((t: any) => (
              <label key={t.id} className="flex items-center gap-2 text-sm ml-2">
                <input
                  type="checkbox"
                  checked={selected.includes(t.id)}
                  onChange={() => toggle(t.id)}
                />
                <span>{t.name}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// REQ-REP-F63..F65: Tag filter
function TagFilterContent({
  selected,
  onChange,
  withoutTag,
  onWithoutTagChange,
}: {
  selected: string[];
  onChange: (tags: string[]) => void;
  withoutTag: boolean;
  onWithoutTagChange: (v: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [matchType, setMatchType] = useState("contains");
  const { data = [] } = useQuery({
    queryKey: ["reports-tag-filter", search],
    queryFn: async () => (await api.get("/reports/filters/tags", { params: { search } })).data,
  });

  const toggle = (tag: string) => {
    onChange(selected.includes(tag) ? selected.filter((x) => x !== tag) : [...selected, tag]);
  };

  return (
    <div className="p-3">
      <input
        type="text"
        placeholder="Search tags..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-2 py-1 border rounded text-sm mb-2"
      />
      {/* REQ-REP-F64: two independent SHOW controls */}
      <div className="flex items-center gap-3 mb-2">
        <StatusToggle status={status} onChange={setStatus} />
        <select
          value={matchType}
          onChange={(e) => setMatchType(e.target.value)}
          className="px-2 py-0.5 border rounded text-xs mb-2"
        >
          <option value="contains">Contains</option>
          <option value="exact">Exact</option>
        </select>
      </div>
      <SelectAllCheckbox allIds={data} selected={selected} onChange={onChange} />
      <label className="flex items-center gap-2 text-sm mb-2">
        <input
          type="checkbox"
          checked={withoutTag}
          onChange={(e) => onWithoutTagChange(e.target.checked)}
        />
        Without tag
      </label>
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {data.map((tag: string) => (
          <label key={tag} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={selected.includes(tag)} onChange={() => toggle(tag)} />
            <span>{tag}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
