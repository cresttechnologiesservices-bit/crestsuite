import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

/**
 * Renders the active custom fields for an entity and reports edits back as a
 * `{ fieldId: value }` map.
 *
 * Only fields the role may see are returned by the API, and fields it may not
 * edit render read-only. The server re-checks both, so this is presentation.
 */
export interface CustomFieldDef {
  id: string;
  name: string;
  type: string;
  required: boolean;
  active: boolean;
  allowedValues: string[];
  defaultValue: any;
  editable?: boolean;
  placeholder?: string | null;
}

/** Active definitions for one entity (empty while none are configured). */
export function useCustomFields(entity: "timeEntry" | "project" | "user") {
  const { data = [] } = useQuery({
    queryKey: ["custom-fields", entity],
    queryFn: async () => (await api.get("/custom-fields", { params: { entity } })).data,
    staleTime: 30_000,
  });
  return (data as CustomFieldDef[]).filter((f) => f.active);
}

/** Defaults for a new record, so required fields start pre-filled. */
export function defaultValuesFor(fields: CustomFieldDef[]): Record<string, any> {
  const values: Record<string, any> = {};
  for (const f of fields) {
    if (f.defaultValue !== null && f.defaultValue !== undefined) values[f.id] = f.defaultValue;
  }
  return values;
}

export function CustomFieldInputs({
  fields,
  values,
  onChange,
  compact = false,
}: {
  fields: CustomFieldDef[];
  values: Record<string, any>;
  onChange: (values: Record<string, any>) => void;
  compact?: boolean;
}) {
  if (!fields.length) return null;
  const set = (id: string, value: any) => onChange({ ...values, [id]: value });
  const base = `border rounded px-2 ${compact ? "py-1 text-xs" : "py-1.5 text-sm"}`;

  return (
    <div className={`flex flex-wrap gap-3 ${compact ? "" : "mt-2"}`}>
      {fields.map((field) => {
        const value = values[field.id] ?? field.defaultValue ?? (field.type === "multiselect" ? [] : "");
        const disabled = field.editable === false;
        const label = (
          <span className="block text-xs text-slate-500 mb-0.5">
            {field.name}
            {field.required && <span className="text-red-500"> *</span>}
          </span>
        );

        if (field.type === "switch") {
          return (
            <label key={field.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value === true}
                disabled={disabled}
                onChange={(e) => set(field.id, e.target.checked)}
              />
              {field.name}
              {field.required && <span className="text-red-500">*</span>}
            </label>
          );
        }

        if (field.type === "select") {
          return (
            <div key={field.id}>
              {label}
              <select
                value={value ?? ""}
                disabled={disabled}
                onChange={(e) => set(field.id, e.target.value)}
                className={`${base} disabled:bg-slate-100`}
              >
                <option value="">— none —</option>
                {(field.allowedValues ?? []).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        if (field.type === "multiselect") {
          const selected: string[] = Array.isArray(value) ? value : [];
          return (
            <div key={field.id}>
              {label}
              <div className="flex flex-wrap gap-1">
                {(field.allowedValues ?? []).map((v) => {
                  const on = selected.includes(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        set(field.id, on ? selected.filter((x) => x !== v) : [...selected, v])
                      }
                      className={`px-2 py-0.5 rounded border text-xs disabled:opacity-50 ${
                        on ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600"
                      }`}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        }

        return (
          <div key={field.id}>
            {label}
            <input
              type={field.type === "number" ? "number" : field.type === "link" ? "url" : "text"}
              value={value ?? ""}
              disabled={disabled}
              placeholder={field.placeholder ?? (field.type === "link" ? "https://…" : "")}
              onChange={(e) => set(field.id, e.target.value)}
              className={`${base} disabled:bg-slate-100 ${compact ? "w-32" : "w-44"}`}
            />
          </div>
        );
      })}
    </div>
  );
}
