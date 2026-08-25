interface ScopeDropdownProps {
  value: "me" | "team";
  onChange: (value: "me" | "team") => void;
  canViewTeam?: boolean;
}

export function ScopeDropdown({ value, onChange, canViewTeam = true }: ScopeDropdownProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-slate-700">Scope:</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as "me" | "team")}
        className="px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <option value="me">Only me</option>
        {/* REQ-DASH-B06: Team scope only for privileged roles */}
        {canViewTeam && <option value="team">Team</option>}
      </select>
    </div>
  );
}
