import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { toast, confirmDialog } from "../ui/notify";

/**
 * Workspace Settings → Custom Fields.
 *
 * Definitions live in their own table so their values can be attached to time
 * entries, projects and members, and pulled into reports and exports.
 */

export const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "link", label: "Link" },
  { value: "switch", label: "Switch" },
  { value: "select", label: "Select" },
  { value: "multiselect", label: "Multi-select" },
];

export const ENTITY_LABELS: Record<string, string> = {
  timeEntry: "Time entry",
  project: "Project",
  user: "Member",
};

const ACCESS_LABELS: Record<string, string> = {
  everyone: "Everyone",
  managers: "Managers & admins",
  admins: "Admins only",
};

const needsValues = (type: string) => type === "select" || type === "multiselect";
const inputClass = "px-3 py-1.5 border rounded text-sm";

const EMPTY_FIELD = {
  name: "",
  type: "text",
  entity: "timeEntry",
  required: false,
  active: true,
  visibility: "everyone",
  editPermission: "everyone",
  allowedValues: [] as string[],
  defaultValue: "" as any,
  placeholder: "",
};

export function CustomFieldsTab() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);

  const { data: fields = [], isLoading } = useQuery({
    queryKey: ["custom-fields"],
    queryFn: async () => (await api.get("/custom-fields")).data,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["custom-fields"] });

  const saveField = useMutation({
    mutationFn: async (field: any) => {
      const payload = {
        name: field.name,
        type: field.type,
        entity: field.entity,
        required: !!field.required,
        active: field.active !== false,
        visibility: field.visibility,
        editPermission: field.editPermission,
        allowedValues: needsValues(field.type) ? field.allowedValues ?? [] : [],
        defaultValue:
          field.defaultValue === "" || field.defaultValue === undefined ? null : field.defaultValue,
        placeholder: field.placeholder || null,
      };
      return field.id
        ? (await api.patch(`/custom-fields/${field.id}`, payload)).data
        : (await api.post("/custom-fields", payload)).data;
    },
    onSuccess: () => {
      refresh();
      setEditing(null);
      toast("Custom field saved", "success");
    },
    onError: (e: any) => toast(e?.response?.data?.error || "Could not save the custom field", "error"),
  });

  const toggleActive = useMutation({
    mutationFn: async (field: any) =>
      (await api.patch(`/custom-fields/${field.id}`, { active: !field.active })).data,
    onSuccess: (data: any) => {
      refresh();
      toast(data.active ? `${data.name} activated` : `${data.name} deactivated`, "success");
    },
    onError: () => toast("Could not change the field", "error"),
  });

  const removeField = useMutation({
    mutationFn: async (id: string) => api.delete(`/custom-fields/${id}`),
    onSuccess: () => {
      refresh();
      toast("Custom field deleted", "success");
    },
    onError: () => toast("Could not delete the field", "error"),
  });

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="pt-2 pb-1">
        <h2 className="text-base font-semibold text-slate-900">Custom Fields</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Extra information captured on time entries, projects and members. Active fields appear on
          the matching screens, and their values flow into reports and exports.
        </p>
      </div>

      <div className="flex justify-end py-3 border-b">
        <button
          onClick={() => setEditing({ ...EMPTY_FIELD })}
          className="px-4 py-1.5 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700"
        >
          + Add custom field
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500 py-4">Loading…</p>
      ) : fields.length === 0 ? (
        <p className="text-sm text-slate-500 py-6">
          No custom fields yet. Add one to start capturing extra information.
        </p>
      ) : (
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs font-semibold text-slate-500 uppercase">
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Applies to</th>
                <th className="py-2 pr-3">Visible to</th>
                <th className="py-2 pr-3">Editable by</th>
                <th className="py-2 pr-3 text-center">Required</th>
                <th className="py-2 pr-3 text-center">Status</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f: any) => (
                <tr key={f.id} className={`border-b last:border-0 ${f.active ? "" : "opacity-60"}`}>
                  <td className="py-2 pr-3 font-medium">
                    {f.name}
                    {needsValues(f.type) && (
                      <div className="text-xs text-slate-500">
                        {(f.allowedValues ?? []).join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">
                    {FIELD_TYPES.find((t) => t.value === f.type)?.label ?? f.type}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">{ENTITY_LABELS[f.entity] ?? f.entity}</td>
                  <td className="py-2 pr-3 text-slate-600">{ACCESS_LABELS[f.visibility]}</td>
                  <td className="py-2 pr-3 text-slate-600">{ACCESS_LABELS[f.editPermission]}</td>
                  <td className="py-2 pr-3 text-center">{f.required ? "Yes" : "—"}</td>
                  <td className="py-2 pr-3 text-center">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        f.active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {f.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => setEditing({ ...f, defaultValue: f.defaultValue ?? "" })}
                      className="text-xs text-indigo-600 hover:underline mr-3"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => toggleActive.mutate(f)}
                      className="text-xs text-slate-600 hover:underline mr-3"
                    >
                      {f.active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      onClick={async () => {
                        const ok = await confirmDialog({
                          title: "Delete custom field",
                          message: `Delete "${f.name}"? Values already saved on records are removed too.`,
                          confirmLabel: "Delete",
                          danger: true,
                        });
                        if (ok) removeField.mutate(f.id);
                      }}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <CustomFieldDialog
          field={editing}
          saving={saveField.isPending}
          onChange={setEditing}
          onCancel={() => setEditing(null)}
          onSave={() => saveField.mutate(editing)}
        />
      )}
    </div>
  );
}

function CustomFieldDialog({
  field,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  field: any;
  saving: boolean;
  onChange: (f: any) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const set = (patch: any) => onChange({ ...field, ...patch });
  const [valueText, setValueText] = useState((field.allowedValues ?? []).join("\n"));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">
          {field.id ? `Edit ${field.name}` : "Add custom field"}
        </h3>

        <label className="block text-sm text-slate-600 mb-1">Field name</label>
        <input
          value={field.name}
          autoFocus
          onChange={(e) => set({ name: e.target.value })}
          className={`${inputClass} w-full mb-3`}
          placeholder="e.g. Cost centre"
        />

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-sm text-slate-600 mb-1">Type</label>
            <select
              value={field.type}
              onChange={(e) => set({ type: e.target.value, defaultValue: "" })}
              className={`${inputClass} w-full`}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1">Applies to</label>
            <select
              value={field.entity}
              disabled={!!field.id}
              title={field.id ? "The entity cannot change once values exist" : undefined}
              onChange={(e) => set({ entity: e.target.value })}
              className={`${inputClass} w-full disabled:bg-slate-100`}
            >
              {Object.entries(ENTITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {needsValues(field.type) && (
          <>
            <label className="block text-sm text-slate-600 mb-1">
              Allowed values (one per line)
            </label>
            <textarea
              value={valueText}
              rows={4}
              onChange={(e) => {
                setValueText(e.target.value);
                set({
                  allowedValues: e.target.value
                    .split("\n")
                    .map((v) => v.trim())
                    .filter(Boolean),
                });
              }}
              className={`${inputClass} w-full mb-3 font-mono text-xs`}
              placeholder={"Engineering\nOperations\nSales"}
            />
          </>
        )}

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-sm text-slate-600 mb-1">Visible to</label>
            <select
              value={field.visibility}
              onChange={(e) => set({ visibility: e.target.value })}
              className={`${inputClass} w-full`}
            >
              {Object.entries(ACCESS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1">Editable by</label>
            <select
              value={field.editPermission}
              onChange={(e) => set({ editPermission: e.target.value })}
              className={`${inputClass} w-full`}
            >
              {Object.entries(ACCESS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="block text-sm text-slate-600 mb-1">Default value (optional)</label>
        {field.type === "switch" ? (
          <select
            value={String(field.defaultValue === true)}
            onChange={(e) => set({ defaultValue: e.target.value === "true" })}
            className={`${inputClass} w-full mb-3`}
          >
            <option value="false">Off</option>
            <option value="true">On</option>
          </select>
        ) : needsValues(field.type) ? (
          <select
            value={
              Array.isArray(field.defaultValue)
                ? field.defaultValue[0] ?? ""
                : field.defaultValue ?? ""
            }
            onChange={(e) =>
              set({
                defaultValue:
                  e.target.value === ""
                    ? ""
                    : field.type === "multiselect"
                      ? [e.target.value]
                      : e.target.value,
              })
            }
            className={`${inputClass} w-full mb-3`}
          >
            <option value="">— none —</option>
            {(field.allowedValues ?? []).map((v: string) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={field.defaultValue ?? ""}
            type={field.type === "number" ? "number" : "text"}
            onChange={(e) => set({ defaultValue: e.target.value })}
            className={`${inputClass} w-full mb-3`}
          />
        )}

        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!field.required}
              onChange={(e) => set({ required: e.target.checked })}
            />
            Required
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={field.active !== false}
              onChange={(e) => set({ active: e.target.checked })}
            />
            Active
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-slate-300 rounded hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving || !field.name.trim()}
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            {field.id ? "Save changes" : "Create field"}
          </button>
        </div>
      </div>
    </div>
  );
}
