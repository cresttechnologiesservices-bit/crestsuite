import { useState } from "react";
import { api } from "../../api/client";
import { toast } from "../ui/notify";
import {
  ExportSettingsModal,
  ExportConfigState,
  loadExportConfig,
  saveExportConfig,
} from "./ExportSettingsModal";

interface ExportDropdownProps {
  dateParams: { start_date: string; end_date: string };
  filters: any;
  rounding?: number;
}

export function ExportDropdown({ dateParams, filters, rounding }: ExportDropdownProps) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState<ExportConfigState>(() => loadExportConfig());

  const buildQueryString = () => {
    const params = new URLSearchParams({
      ...dateParams,
      ...Object.entries(filters).reduce((acc, [k, v]) => {
        if (Array.isArray(v) && v.length > 0) acc[k] = v.join(",");
        else if (v !== undefined && v !== "" && v !== null && v !== false) acc[k] = String(v);
        return acc;
      }, {} as Record<string, string>),
    });
    if (rounding) params.append("rounding", String(rounding));
    // REQ-REP-F90, B49: pass the saved column configuration with each export
    params.append("config", JSON.stringify(config));
    return params.toString();
  };

  // REQ-REP-F44: trigger file download of current report view
  const handleExport = async (format: "pdf" | "csv" | "excel") => {
    setExporting(true);
    try {
      const qs = buildQueryString();
      const response = await api.get(`/reports/export/${format}?${qs}`, {
        responseType: "blob",
      });

      const ext = format === "excel" ? "xlsx" : format;
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `report-${Date.now()}.${ext}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      toast(err.response?.data?.error || "Export failed", "error");
    } finally {
      setExporting(false);
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
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
          <div className="absolute top-full right-0 mt-1 w-48 bg-white border rounded-lg shadow-lg z-20">
            <button
              onClick={() => handleExport("pdf")}
              className="w-full text-left px-4 py-2 hover:bg-slate-50 text-sm"
            >
              Save as PDF
            </button>
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
            {/* REQ-REP-F45: Customization opens export settings */}
            <button
              onClick={() => {
                setOpen(false);
                setShowSettings(true);
              }}
              className="w-full text-left px-4 py-2 hover:bg-slate-50 text-sm border-t"
            >
              Customization
            </button>
          </div>
        </>
      )}

      {showSettings && (
        <ExportSettingsModal
          initialConfig={config}
          onSave={(next) => {
            setConfig(next);
            saveExportConfig(next);
            setShowSettings(false);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
