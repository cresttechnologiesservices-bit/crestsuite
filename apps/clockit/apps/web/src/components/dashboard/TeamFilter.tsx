import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

interface TeamFilterProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function TeamFilter({ selectedIds, onChange }: TeamFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: teamMembers = [] } = useQuery({
    queryKey: ["dashboard-team-members", search],
    queryFn: async () => {
      const response = await api.get("/dashboard/team-members", {
        params: { search },
      });
      return response.data;
    },
  });

  const handleToggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((sid) => sid !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const handleSelectAll = () => {
    if (selectedIds.length === teamMembers.length) {
      onChange([]);
    } else {
      onChange(teamMembers.map((m: any) => m.id));
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-2 border border-slate-300 rounded hover:bg-slate-50 flex items-center gap-2"
      >
        <span className="text-sm font-medium text-slate-700">Team</span>
        {selectedIds.length > 0 && (
          <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full">
            {selectedIds.length}
          </span>
        )}
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full mt-2 left-0 w-80 bg-white border border-slate-200 rounded-lg shadow-lg z-20">
            <div className="p-3 border-b">
              <input
                type="text"
                placeholder="Search users..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="max-h-80 overflow-y-auto">
              <div className="p-2 border-b">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === teamMembers.length && teamMembers.length > 0}
                    onChange={handleSelectAll}
                    className="rounded"
                  />
                  <span className="text-sm font-medium text-slate-700">Select all</span>
                </label>
              </div>
              {teamMembers.map((member: any) => (
                <div key={member.id} className="p-2 hover:bg-slate-50">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(member.id)}
                      onChange={() => handleToggle(member.id)}
                      className="rounded"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-slate-900">{member.name}</div>
                      <div className="text-xs text-slate-500">{member.email}</div>
                    </div>
                  </label>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
