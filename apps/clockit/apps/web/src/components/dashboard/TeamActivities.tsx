import { useState } from "react";
import { formatDistanceToNow } from "date-fns";

interface TeamActivitiesProps {
  activities: Array<{
    userId: string;
    name: string;
    email: string;
    totalDuration: string;
    totalMinutes: number;
    latestActivity: {
      description: string;
      projectName: string;
      timestamp: string;
    } | null;
    composition?: Array<{
      key: string;
      name: string;
      color: string;
      minutes: number;
      percentage: number;
    }>;
  }>;
}

export function TeamActivities({ activities }: TeamActivitiesProps) {
  const [sortBy, setSortBy] = useState<"name" | "total" | "latest">("total");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [pinned, setPinned] = useState(false);

  const handleSort = (column: "name" | "total" | "latest") => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("desc");
    }
  };

  const sortedActivities = [...activities].sort((a, b) => {
    let comparison = 0;
    if (sortBy === "name") {
      comparison = a.name.localeCompare(b.name);
    } else if (sortBy === "total") {
      comparison = a.totalMinutes - b.totalMinutes;
    } else if (sortBy === "latest") {
      const aTime = a.latestActivity?.timestamp ? new Date(a.latestActivity.timestamp).getTime() : 0;
      const bTime = b.latestActivity?.timestamp ? new Date(b.latestActivity.timestamp).getTime() : 0;
      comparison = aTime - bTime;
    }
    return sortOrder === "desc" ? -comparison : comparison;
  });

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getAvatarColor = (name: string) => {
    const colors = ["#4f46e5", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  return (
    <div className={`bg-white rounded-lg shadow p-6 ${pinned ? "sticky top-4 z-10" : ""}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-900">Team activities</h3>
        {/* REQ-DASH-F23: pin/unpin to keep the section fixed while scrolling */}
        <button
          onClick={() => setPinned(!pinned)}
          className={`p-2 rounded hover:bg-slate-100 ${pinned ? "text-indigo-600" : "text-slate-400"}`}
          aria-label={pinned ? "Unpin section" : "Pin section"}
          title={pinned ? "Unpin section" : "Pin section"}
        >
          <svg className="w-5 h-5" fill={pinned ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M16 4v4l2 3v2h-5v7l-1 2-1-2v-7H6v-2l2-3V4h8z"
            />
          </svg>
        </button>
      </div>

      {sortedActivities.length === 0 ? (
        <div className="text-center text-slate-500 py-8">
          No team activities found
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th
                  className="text-left py-3 px-4 cursor-pointer hover:bg-slate-50"
                  onClick={() => handleSort("name")}
                >
                  <div className="flex items-center gap-2">
                    Team Member
                    {sortBy === "name" && (
                      <span className="text-indigo-600">{sortOrder === "asc" ? "↑" : "↓"}</span>
                    )}
                  </div>
                </th>
                <th
                  className="text-left py-3 px-4 cursor-pointer hover:bg-slate-50"
                  onClick={() => handleSort("latest")}
                >
                  <div className="flex items-center gap-2">
                    Latest Activity
                    {sortBy === "latest" && (
                      <span className="text-indigo-600">{sortOrder === "asc" ? "↑" : "↓"}</span>
                    )}
                  </div>
                </th>
                <th
                  className="text-right py-3 px-4 cursor-pointer hover:bg-slate-50"
                  onClick={() => handleSort("total")}
                >
                  <div className="flex items-center gap-2 justify-end">
                    Total Tracked
                    {sortBy === "total" && (
                      <span className="text-indigo-600">{sortOrder === "asc" ? "↑" : "↓"}</span>
                    )}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedActivities.map((member) => (
                <tr key={member.userId} className="border-b hover:bg-slate-50">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm"
                        style={{ backgroundColor: getAvatarColor(member.name) }}
                      >
                        {getInitials(member.name)}
                      </div>
                      <div>
                        <div className="font-medium text-slate-900">{member.name}</div>
                        <div className="text-sm text-slate-500">{member.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {member.latestActivity ? (
                      <div>
                        <div className="text-sm text-slate-900">
                          {member.latestActivity.description || "(no description)"}
                        </div>
                        <div className="text-xs text-slate-500">
                          {member.latestActivity.projectName} •{" "}
                          {formatDistanceToNow(new Date(member.latestActivity.timestamp), { addSuffix: true })}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-slate-400">No activity</div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="text-lg font-semibold text-indigo-600">
                      {member.totalDuration}
                    </div>
                    {/* REQ-DASH-F21: proportional bar of tracked time composition */}
                    {member.composition && member.composition.length > 0 && (
                      <div className="flex w-32 h-2 rounded-full overflow-hidden bg-slate-100 ml-auto mt-1">
                        {member.composition.map((segment) => (
                          <div
                            key={segment.key}
                            title={`${segment.name}: ${segment.percentage}%`}
                            style={{
                              width: `${segment.percentage}%`,
                              backgroundColor: segment.color,
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
