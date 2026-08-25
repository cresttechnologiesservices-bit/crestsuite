import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

interface BreakdownSectionProps {
  data: {
    total: string;
    totalMinutes: number;
    breakdown: Array<{
      key: string;
      name: string;
      duration: string;
      minutes: number;
      percentage: number;
      color?: string;
      clientName?: string;
    }>;
  };
  groupBy: "project" | "billability";
  className?: string;
}

const COLORS = ["#4f46e5", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

export function BreakdownSection({ data, groupBy, className = "" }: BreakdownSectionProps) {
  if (!data || data.breakdown.length === 0) {
    return (
      <div className={`bg-white rounded-lg shadow p-6 ${className}`}>
        <div className="text-center text-slate-500 py-12">
          No data to show
        </div>
      </div>
    );
  }
  const chartData = data.breakdown.map((item, index) => ({
    name: item.name,
    value: item.minutes,
    duration: item.duration,
    percentage: item.percentage,
    color: item.color || COLORS[index % COLORS.length],
  }));
  return (
    <div className={`bg-white rounded-lg shadow p-6 ${className}`}>
      <h3 className="text-lg font-semibold text-slate-900 mb-4">
        Breakdown by {groupBy === "project" ? "Project" : "Billability"}
      </h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Donut Chart */}
        <div className="relative">
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const item = payload[0].payload;
                    return (
                      <div className="bg-white p-3 border rounded shadow-lg">
                        <p className="font-semibold text-slate-900">{item.name}</p>
                        <p className="text-sm text-slate-600">{item.duration}</p>
                        <p className="text-sm text-slate-500">{item.percentage}%</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Center Label */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="text-2xl font-bold text-slate-900">{data.total}</div>
              <div className="text-sm text-slate-500">Total</div>
            </div>
          </div>
        </div>

        {/* Breakdown List */}
        <div className="space-y-3">
          {data.breakdown.map((item, index) => (
            <div key={item.key} className="flex items-center gap-3">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: item.color || COLORS[index % COLORS.length] }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-medium text-slate-900 truncate">{item.name}</div>
                  <div className="text-sm text-slate-600 ml-2">{item.duration}</div>
                </div>
                {item.clientName && (
                  <div className="text-xs text-slate-500 mb-1">{item.clientName}</div>
                )}
                <div className="w-full bg-slate-100 rounded-full h-2">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{
                      width: `${item.percentage}%`,
                      backgroundColor: item.color || COLORS[index % COLORS.length],
                    }}
                  />
                </div>
                <div className="text-xs text-slate-500 mt-1">{item.percentage}%</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
