import { useState } from "react";

/**
 * REQ-TEAM-F06/F07: multi-select filter dropdown with checkboxes,
 * optional search input, "Select all", and a count badge.
 */
export function CheckboxDropdown({
  label,
  options,
  selected,
  onChange,
  searchable = false,
  badge = 0,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
  badge?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const visible = options.filter((o) =>
    o.label.toLowerCase().includes(query.toLowerCase())
  );
  const allSelected = options.length > 0 && selected.length === options.length;

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value]
    );
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="px-3 py-1.5 border rounded text-sm bg-white hover:bg-slate-50 flex items-center gap-1"
      >
        {label}
        {badge > 0 && (
          <span className="ml-1 px-1.5 py-0.5 bg-indigo-600 text-white rounded-full text-xs leading-none">
            {badge}
          </span>
        )}
        <span className="text-slate-400">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)}></div>
          <div className="absolute left-0 top-full mt-1 bg-white border rounded shadow-lg z-20 w-56 p-2 max-h-64 overflow-y-auto">
            {searchable && (
              <input
                type="text"
                placeholder={`Search ${label.toLowerCase()}...`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full px-2 py-1 border rounded text-sm mb-2"
                autoFocus
              />
            )}
            <label className="flex items-center gap-2 px-1 py-1 text-sm cursor-pointer font-medium">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => onChange(allSelected ? [] : options.map((o) => o.value))}
              />
              Select all
            </label>
            {visible.length === 0 ? (
              <div className="px-1 py-2 text-sm text-slate-500">No matches</div>
            ) : (
              visible.map((o) => (
                <label
                  key={o.value}
                  className="flex items-center gap-2 px-1 py-1 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(o.value)}
                    onChange={() => toggle(o.value)}
                  />
                  {o.label}
                </label>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
