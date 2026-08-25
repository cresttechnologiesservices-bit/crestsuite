import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LabelList } from "recharts";
import { format, parseISO } from "date-fns";

interface ChartSeries {
  key: string;
  name: string;
  color: string;
}

interface ChartDay {
  date: string;
  total: string;
  totalMinutes: number;
  segments: Record<string, number>;
}

interface DashboardChartProps {
  days: ChartDay[];
  series: ChartSeries[];
  groupBy: "project" | "billability";
  className?: string;
}

export function DashboardChart({ days, series, groupBy, className = "" }: DashboardChartProps) {
  if (!days || days.length === 0) {
    return (
      <div className={`bg-white rounded-lg shadow p-6 ${className}`}>
        <div className="text-center text-slate-500 py-12">
          No data to show
        </div>
      </div>
    );
  }

  // If there are no segments at all (empty period), still render bars with a fallback series
  const effectiveSeries: ChartSeries[] = series.length > 0
    ? series
    : [{ key: "total", name: "Total", color: "#4f46e5" }];

  // Prepare data for chart: one row per day, one numeric field per series (hours)
  const chartData = days.map((day) => {
    const row: any = {
      name: format(parseISO(day.date), "EEE d"),
      // REQ-DASH-F08/F11: label every bar with its duration ("0:00" for empty days)
      displayTotal: day.total,
      totalMinutes: day.totalMinutes,
    };
    effectiveSeries.forEach((s) => {
      const minutes = day.segments?.[s.key] || 0;
      row[s.key] = Number((minutes / 60).toFixed(2));
    });
    return row;
  });

  const legendLabel = (s: ChartSeries) =>
    groupBy === "billability" && s.key === "billable" ? "$ Billable" : s.name;

  return (
    <div className={`bg-white rounded-lg shadow p-6 ${className}`}>
      <h3 className="text-lg font-semibold text-slate-900 mb-4">Time Distribution</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ top: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" stroke="#64748b" />
          <YAxis stroke="#64748b" label={{ value: "Hours", angle: -90, position: "insideLeft" }} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (active && payload && payload.length) {
                const row = payload[0].payload;
                return (
                  <div className="bg-white p-3 border rounded shadow-lg">
                    <p className="font-semibold text-slate-900">{label}</p>
                    <p className="text-sm text-slate-600">Total: {row.displayTotal}</p>
                    {effectiveSeries.map((s) =>
                      row[s.key] > 0 ? (
                        <p key={s.key} className="text-sm" style={{ color: s.color }}>
                          {legendLabel(s)}: {row[s.key]}h
                        </p>
                      ) : null
                    )}
                  </div>
                );
              }
              return null;
            }}
          />
          <Legend formatter={(value) => {
            const s = effectiveSeries.find((es) => es.key === value);
            return s ? legendLabel(s) : value;
          }} />
          {effectiveSeries.map((s, index) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId="a"
              fill={s.color}
              radius={index === effectiveSeries.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            >
              {index === effectiveSeries.length - 1 && (
                <LabelList dataKey="displayTotal" position="top" style={{ fill: "#64748b", fontSize: 12 }} />
              )}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
