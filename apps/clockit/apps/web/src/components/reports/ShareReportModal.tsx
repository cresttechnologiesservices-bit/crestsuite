import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

interface ShareReportModalProps {
  onClose: () => void;
  filters?: any;
}

// REQ-REP-F36..F42: Share report modal
export function ShareReportModal({ onClose, filters = {} }: ShareReportModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [alwaysThisWeek, setAlwaysThisWeek] = useState(false);
  const [lockDates, setLockDates] = useState(false);
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      await api.post("/reports/share", {
        name,
        visibility,
        alwaysThisWeek,
        lockDates,
        filters,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shared-reports"] });
      onClose();
    },
    onError: (err: any) => setError(err.response?.data?.error || "Failed to create"),
  });

  // REQ-REP-F37: 2-250 character validation
  const isValid = name.length >= 2 && name.length <= 250;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-6 border-b">
          <h3 className="text-lg font-semibold">Share report</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Report name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My report"
              className="w-full px-3 py-2 border rounded"
            />
            {name.length > 0 && !isValid && (
              <div className="text-xs text-red-600 mt-1">
                Name must be between 2 and 250 characters
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Visibility</label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as any)}
              className="w-full px-3 py-2 border rounded"
            >
              <option value="public">Public - Anyone with the link can view</option>
              <option value="private">Private - Only workspace members</option>
            </select>
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={alwaysThisWeek}
              onChange={(e) => setAlwaysThisWeek(e.target.checked)}
            />
            <div>
              <div className="text-sm font-medium">Always open as this week</div>
              <div className="text-xs text-slate-500">Report always shows current week's data</div>
            </div>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={lockDates}
              onChange={(e) => setLockDates(e.target.checked)}
            />
            <div>
              <div className="text-sm font-medium flex items-center gap-1">
                Lock dates
                <span
                  className="text-slate-400 cursor-help"
                  title="When enabled, viewers cannot change the shared report's date range"
                >
                  ⓘ
                </span>
              </div>
              <div className="text-xs text-slate-500">Viewers cannot change the date range</div>
            </div>
          </label>

          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 p-6 border-t">
          <button onClick={onClose} className="px-4 py-2 border rounded hover:bg-slate-50">
            Close
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!isValid || mutation.isPending}
            className="px-6 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            CREATE LINK
          </button>
        </div>
      </div>
    </div>
  );
}
