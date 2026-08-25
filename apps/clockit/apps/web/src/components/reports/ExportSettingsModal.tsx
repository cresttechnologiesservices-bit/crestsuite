import { useState } from "react";

export interface ExportConfigState {
  reportName: string;
  notes: string;
  rightToLeft: boolean;
  columns: Record<string, boolean>;
}

// REQ-REP-F88: all columns checked by default
export const DEFAULT_EXPORT_CONFIG: ExportConfigState = {
  reportName: "",
  notes: "",
  rightToLeft: false,
  columns: {
    project: true,
    client: true,
    description: true,
    task: true,
    user: true,
    tags: true,
    startDate: true,
    startTime: true,
    endTime: true,
    durationH: true,
    dateOfCreation: true,
    email: true,
    billable: true,
    endDate: true,
    durationDecimal: true,
    group: true,
    notesIncluded: true,
  },
};

const STORAGE_KEY = "reports-export-config";

export function loadExportConfig(): ExportConfigState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_EXPORT_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_EXPORT_CONFIG,
      ...parsed,
      columns: { ...DEFAULT_EXPORT_CONFIG.columns, ...(parsed.columns || {}) },
    };
  } catch {
    return DEFAULT_EXPORT_CONFIG;
  }
}

export function saveExportConfig(config: ExportConfigState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

// REQ-REP-F84..F86: column groupings per visibility scope
const ALL_FORMAT_COLUMNS: { key: string; label: string }[] = [
  { key: "project", label: "Project" },
  { key: "client", label: "Client" },
  { key: "description", label: "Description" },
  { key: "task", label: "Task" },
  { key: "user", label: "User" },
  { key: "tags", label: "Tags" },
  { key: "startDate", label: "Start Date" },
  { key: "startTime", label: "Start Time" },
  { key: "endTime", label: "End Time" },
  { key: "durationH", label: "Duration (h)" },
  { key: "dateOfCreation", label: "Date of creation" },
];

const CSV_EXCEL_COLUMNS: { key: string; label: string }[] = [
  { key: "email", label: "Email" },
  { key: "billable", label: "Billable" },
  { key: "endDate", label: "End Date" },
  { key: "durationDecimal", label: "Duration (decimal)" },
  { key: "group", label: "Group" },
];

interface ExportSettingsModalProps {
  initialConfig: ExportConfigState;
  onSave: (config: ExportConfigState) => void;
  onClose: () => void;
}

// REQ-REP-F79..F91: Detailed export settings modal
export function ExportSettingsModal({ initialConfig, onSave, onClose }: ExportSettingsModalProps) {
  const [config, setConfig] = useState<ExportConfigState>({
    ...initialConfig,
    columns: { ...initialConfig.columns },
  });

  const allKeys = [
    ...ALL_FORMAT_COLUMNS.map((c) => c.key),
    ...CSV_EXCEL_COLUMNS.map((c) => c.key),
    "notesIncluded",
  ];
  const allChecked = allKeys.every((k) => config.columns[k]);

  const toggleColumn = (key: string) => {
    setConfig((prev) => ({
      ...prev,
      columns: { ...prev.columns, [key]: !prev.columns[key] },
    }));
  };

  // REQ-REP-F83: Select all toggles every checkbox across all sections
  const toggleAll = () => {
    const next = !allChecked;
    setConfig((prev) => ({
      ...prev,
      columns: allKeys.reduce((acc, k) => ({ ...acc, [k]: next }), {} as Record<string, boolean>),
    }));
  };

  const checkboxList = (items: { key: string; label: string }[]) => (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <label key={item.key} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!config.columns[item.key]}
            onChange={() => toggleColumn(item.key)}
          />
          {item.label}
        </label>
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b">
          <h3 className="text-lg font-semibold">Detailed export settings</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded" aria-label="Close">
            ×
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          {/* REQ-REP-F81: plan tier badge */}
          <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 font-medium">
            BASIC feature — export customization is included in the Basic plan.
          </div>

          {/* REQ-REP-F82: report name */}
          <div>
            <label className="block text-sm font-medium mb-1">Report name</label>
            <input
              type="text"
              placeholder="Detailed name"
              value={config.reportName}
              onChange={(e) => setConfig({ ...config, reportName: e.target.value })}
              className="w-full px-3 py-2 border rounded"
            />
          </div>

          {/* REQ-REP-F83: select all */}
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} />
            Select all
          </label>

          {/* REQ-REP-F85 */}
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase mb-2">
              Visible in PDF, CSV and Excel
            </div>
            {checkboxList(ALL_FORMAT_COLUMNS)}
          </div>

          {/* REQ-REP-F86 */}
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase mb-2">
              Visible only in CSV and Excel
            </div>
            {checkboxList(CSV_EXCEL_COLUMNS)}
          </div>

          {/* REQ-REP-F80, F87 */}
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase mb-2">
              Visible only in PDF
            </div>
            <label className="flex items-center gap-2 text-sm mb-2">
              <input
                type="checkbox"
                checked={config.rightToLeft}
                onChange={(e) => setConfig({ ...config, rightToLeft: e.target.checked })}
              />
              Display text right-to-left
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!config.columns.notesIncluded}
                onChange={() => toggleColumn("notesIncluded")}
              />
              Notes
            </label>
            {config.columns.notesIncluded && (
              <textarea
                placeholder="Add notes..."
                value={config.notes}
                onChange={(e) => setConfig({ ...config, notes: e.target.value })}
                className="w-full px-3 py-2 border rounded mt-2 text-sm"
                rows={3}
              />
            )}
          </div>
        </div>

        {/* REQ-REP-F89: Close discards, SAVE persists */}
        <div className="flex justify-end gap-2 p-6 border-t">
          <button onClick={onClose} className="px-4 py-2 border rounded hover:bg-slate-50">
            Close
          </button>
          <button
            onClick={() => onSave(config)}
            className="px-6 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}
