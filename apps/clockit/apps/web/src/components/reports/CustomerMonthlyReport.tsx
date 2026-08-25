import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { format, parseISO } from "date-fns";
import { toast } from "../ui/notify";

/** CSV / Excel / PDF export of the month currently on screen. */
function MonthlyExportDropdown({ month }: { month: string }) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = async (fmt: "csv" | "excel" | "pdf") => {
    setExporting(true);
    try {
      const response = await api.get(`/reports/customer-monthly/export/${fmt}`, {
        params: { month },
        responseType: "blob",
      });
      const ext = fmt === "excel" ? "xlsx" : fmt;
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `customer-monthly-${month}.${ext}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      toast("Export failed. Please try again.", "error");
    } finally {
      setExporting(false);
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={exporting}
        className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 flex items-center gap-2 disabled:opacity-50"
      >
        {exporting ? "Exporting..." : "EXPORT"}
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-1 w-44 bg-white border rounded-lg shadow-lg z-20 py-1">
            <button
              onClick={() => handleExport("csv")}
              className="w-full text-left px-4 py-2 hover:bg-slate-50 text-sm"
            >
              Save as CSV
            </button>
            <button
              onClick={() => handleExport("excel")}
              className="w-full text-left px-4 py-2 hover:bg-slate-50 text-sm"
            >
              Save as Excel
            </button>
            <button
              onClick={() => handleExport("pdf")}
              className="w-full text-left px-4 py-2 hover:bg-slate-50 text-sm"
            >
              Save as PDF
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Customer Monthly report — web port of the VBA billing-workbook generator.
 * Shows, for the calendar weeks covering the selected month:
 *  1. one grid per project (task + employee rows, CW week / day columns);
 *  2. per-project Billable / Non-Billable / Total summary (Total_Sheet);
 *  3. consolidated hours per employee (Consolidated Hours sheet).
 */
export function CustomerMonthlyReport() {
  const [month, setMonth] = useState(() => format(new Date(), "yyyy-MM"));

  const { data, isLoading } = useQuery({
    queryKey: ["report-customer-monthly", month],
    queryFn: async () => (await api.get("/reports/customer-monthly", { params: { month } })).data,
  });

  const fmtHours = (h: number | undefined) => (h == null || h === 0 ? "" : h.toFixed(2));
  const isWeekend = (d: string) => {
    const day = parseISO(d).getDay();
    return day === 0 || day === 6;
  };
  const inMonth = (d: string) => d.slice(0, 7) === month;

  return (
    <div className="space-y-6">
      {/* Month selector */}
      <div className="bg-white rounded-lg shadow p-4 flex items-center justify-between print:hidden">
        <div>
          <div className="font-semibold text-slate-900">Customer Monthly report</div>
          <div className="text-sm text-slate-500">
            Hours per project, task and employee for the calendar weeks of the month
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-slate-600">Month</label>
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
          />
          <MonthlyExportDropdown month={month} />
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-slate-500">Loading...</div>
      ) : !data || data.projects.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center text-slate-500">
          No time entries in {format(parseISO(`${month}-01`), "MMMM yyyy")}.
        </div>
      ) : (
        <>
          {/* 1. Per-project grids */}
          {data.projects.map((p: any) => (
            <div key={p.id} className="bg-white rounded-lg shadow overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }} />
                <h3 className="font-semibold text-slate-900">{p.name}</h3>
                {p.clientName && <span className="text-sm text-slate-500">• {p.clientName}</span>}
                <span className="ml-auto text-sm text-slate-500">
                  Total: <span className="font-semibold text-slate-900">{p.total.toFixed(2)} h</span>
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-orange-100 border-b">
                      <th rowSpan={2} className="px-3 py-2 text-left font-semibold border-r min-w-[180px] sticky left-0 bg-orange-100 z-10">
                        Task Name
                      </th>
                      <th rowSpan={2} className="px-3 py-2 text-left font-semibold border-r min-w-[130px]">
                        Employee Name
                      </th>
                      {p.internal && (
                        <th rowSpan={2} className="px-3 py-2 text-left font-semibold border-r min-w-[160px]">
                          Description
                        </th>
                      )}
                      {data.weeks.map((w: any) => (
                        <th key={w.cw} colSpan={7} className="px-2 py-1 text-center font-semibold border-r border-l">
                          CW{w.cw}
                        </th>
                      ))}
                      <th rowSpan={2} className="px-3 py-2 text-right font-semibold border-l">
                        TOTAL
                      </th>
                    </tr>
                    <tr className="bg-orange-50 border-b">
                      {data.days.map((d: string) => (
                        <th
                          key={d}
                          className={`px-1 py-1 text-center font-medium whitespace-nowrap border-r ${
                            isWeekend(d) ? "bg-slate-100 text-slate-400" : inMonth(d) ? "" : "text-slate-400"
                          }`}
                        >
                          {format(parseISO(d), "d MMM")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {p.rows.map((r: any, i: number) => (
                      <tr key={i} className="border-b hover:bg-slate-50">
                        <td className="px-3 py-1.5 border-r font-medium sticky left-0 bg-white z-10">{r.task}</td>
                        <td className="px-3 py-1.5 border-r">{r.employee}</td>
                        {p.internal && <td className="px-3 py-1.5 border-r text-slate-600">{r.description}</td>}
                        {data.days.map((d: string) => (
                          <td
                            key={d}
                            className={`px-1 py-1.5 text-center tabular-nums border-r ${
                              isWeekend(d) ? "bg-slate-50" : ""
                            }`}
                          >
                            {fmtHours(r.daily[d])}
                          </td>
                        ))}
                        <td className="px-3 py-1.5 text-right font-semibold tabular-nums border-l">
                          {r.total.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    {/* Project total row */}
                    <tr className="bg-slate-50 font-semibold">
                      <td colSpan={p.internal ? 3 : 2} className="px-3 py-2 border-r sticky left-0 bg-slate-50 z-10">
                        TOTAL
                      </td>
                      {data.days.map((d: string) => (
                        <td key={d} className="px-1 py-2 text-center tabular-nums border-r">
                          {fmtHours(p.dailyTotals[d])}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right text-indigo-600 tabular-nums border-l">
                        {p.total.toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* 2. Project totals (Total_Sheet) */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b">
              <h3 className="font-semibold text-slate-900">Project totals</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-orange-100 border-b text-left">
                    <th className="px-4 py-2 font-semibold">PROJECT NAME</th>
                    <th className="px-4 py-2 font-semibold text-right">BILLABLE</th>
                    <th className="px-4 py-2 font-semibold text-right">NON-BILLABLE</th>
                    <th className="px-4 py-2 font-semibold text-right">TOTAL HOURS</th>
                  </tr>
                </thead>
                <tbody>
                  {data.projectTotals.map((p: any) => (
                    <tr key={p.name} className="border-b hover:bg-slate-50">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                          <span className="font-medium">{p.name}</span>
                          {p.clientName && <span className="text-xs text-slate-500">• {p.clientName}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-green-700">{p.billable.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-500">{p.nonBillable.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">{p.total.toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-semibold">
                    <td className="px-4 py-2">TOTAL</td>
                    <td className="px-4 py-2 text-right tabular-nums text-green-700">{data.grand.billable.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">{data.grand.nonBillable.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-indigo-600">{data.grand.total.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* 3. Consolidated hours per employee */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b">
              <h3 className="font-semibold text-slate-900">Consolidated hours</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-orange-100 border-b text-left">
                    <th className="px-4 py-2 font-semibold">Employee Name</th>
                    <th className="px-4 py-2 font-semibold">Project Name</th>
                    <th className="px-4 py-2 font-semibold text-right">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {data.consolidated.map((emp: any) => (
                    <Fragment key={emp.employee}>
                      {emp.rows.map((r: any, i: number) => (
                        <tr key={r.project} className="border-b hover:bg-slate-50">
                          {i === 0 && (
                            <td
                              rowSpan={emp.rows.length + 1}
                              className="px-4 py-2 font-medium border-r align-middle"
                            >
                              {emp.employee}
                            </td>
                          )}
                          <td className="px-4 py-2">{r.project}</td>
                          <td className="px-4 py-2 text-right tabular-nums bg-yellow-50">{r.hours.toFixed(2)}</td>
                        </tr>
                      ))}
                      <tr className="border-b bg-slate-50 font-semibold">
                        <td className="px-4 py-2">Total</td>
                        <td className="px-4 py-2 text-right tabular-nums">{emp.total.toFixed(2)}</td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
