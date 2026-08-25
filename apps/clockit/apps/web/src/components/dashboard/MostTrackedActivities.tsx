import { useState } from "react";

interface MostTrackedActivitiesProps {
  activities: Array<{
    description: string;
    projectName: string;
    clientName?: string | null;
    duration: string;
    minutes: number;
  }>;
}

export function MostTrackedActivities({ activities }: MostTrackedActivitiesProps) {
  const [limit, setLimit] = useState(10);
  const displayActivities = activities.slice(0, limit);
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-900">Most tracked activities</h3>
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="px-3 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value={5}>Top 5</option>
          <option value={10}>Top 10</option>
          <option value={20}>Top 20</option>
        </select>
      </div>

      {displayActivities.length === 0 ? (
        <div className="text-center text-slate-500 py-8">
          No activities found
        </div>
      ) : (
        <div className="space-y-3">
          {displayActivities.map((activity, index) => (
            <div key={index} className="flex items-center justify-between p-3 border border-slate-200 rounded hover:bg-slate-50">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-900 truncate">
                  {activity.description || "(no description)"}
                </div>
                <div className="text-sm text-slate-500 truncate">
                  {activity.projectName}
                  {activity.clientName ? ` • ${activity.clientName}` : ""}
                </div>
              </div>
              <div className="text-lg font-semibold text-indigo-600 ml-4">
                {activity.duration}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
