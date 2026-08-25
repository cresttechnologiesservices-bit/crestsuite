interface GroupingDropdownProps {
  value: "project" | "billability";
  onChange: (value: "project" | "billability") => void;
}

export function GroupingDropdown({ value, onChange }: GroupingDropdownProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-slate-700">Group by:</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as "project" | "billability")}
        className="px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <option value="project">Project</option>
        <option value="billability">Billability</option>
      </select>
    </div>
  );
}
