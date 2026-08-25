import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { WINDOWS_TIMEZONES, resolveTimezoneValue } from "../../lib/timezones";

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
        checked ? "bg-indigo-600" : "bg-slate-300"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export function GeneralPreferences() {
  const queryClient = useQueryClient();
  const { data: prefs, isLoading } = useQuery({
    queryKey: ["general-preferences"],
    queryFn: async () => (await api.get("/users/preferences/general")).data,
  });
  const updateMutation = useMutation({
    mutationFn: async (updates: any) => {
      // REQ-ACC-B03: persist general preferences
      await api.patch("/users/preferences/general", updates);
      // REQ-ACC-F15: apply theme immediately, without a reload
      if (updates.theme) {
        document.documentElement.classList.toggle("dark", updates.theme === "dark");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["general-preferences"] });
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
    },
  });

  if (isLoading) {
    return <div className="text-center py-12 text-slate-500">Loading...</div>;
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 space-y-6">
      {/* REQ-ACC-F07: Theme */}
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Themes</h3>
        <div className="flex gap-3">
          {["light", "dark"].map((theme) => (
            <label key={theme} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="theme"
                value={theme}
                checked={prefs?.theme === theme}
                onChange={() => updateMutation.mutate({ theme })}
              />
              <span className="capitalize">{theme}</span>
            </label>
          ))}
        </div>
      </div>

      {/* REQ-ACC-F08: Language */}
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Language</h3>
        <select
          value={prefs?.language || "en"}
          onChange={(e) => updateMutation.mutate({ language: e.target.value })}
          className="px-3 py-2 border rounded dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
        >
          <option value="en">English</option>
          <option value="es">Español</option>
          <option value="fr">Français</option>
          <option value="de">Deutsch</option>
        </select>
      </div>

      {/* REQ-ACC-F09: Group time entries */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Group time entries</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Group similar time entries — entries for the same activity are grouped for easier overview.
          </p>
        </div>
        <Toggle
          checked={!!prefs?.groupSimilarEntries}
          onChange={() =>
            updateMutation.mutate({ groupSimilarEntries: !prefs?.groupSimilarEntries })
          }
        />
      </div>

      {/* REQ-ACC-F10: Compact project list */}
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Compact project list</h3>
        <div className="flex gap-3">
          <select
            value={prefs?.compactProjectListMode || "collapse"}
            onChange={(e) => updateMutation.mutate({ compactProjectListMode: e.target.value })}
            className="px-3 py-2 border rounded dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
          >
            <option value="collapse">Collapse if too many projects</option>
            <option value="always">Always collapse</option>
            <option value="never">Never collapse</option>
          </select>
          <input
            type="number"
            min={1}
            value={prefs?.compactProjectListThreshold ?? 50}
            onChange={(e) => {
              const value = parseInt(e.target.value, 10);
              if (Number.isInteger(value) && value > 0) {
                updateMutation.mutate({ compactProjectListThreshold: value });
              }
            }}
            className="w-24 px-3 py-2 border rounded dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
          />
        </div>
      </div>

      {/* REQ-ACC-F11: Task filter */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Task filter</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Activate task filter — look up tasks with "task@project" syntax in the project picker.
          </p>
        </div>
        <Toggle
          checked={!!prefs?.taskFilter}
          onChange={() => updateMutation.mutate({ taskFilter: !prefs?.taskFilter })}
        />
      </div>

      {/* REQ-ACC-F12/F13/F14: Time Settings */}
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Time settings</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">Time zone</label>
            <select
              value={resolveTimezoneValue(prefs?.timezone)}
              onChange={(e) => updateMutation.mutate({ timezone: e.target.value })}
              className="w-full px-3 py-2 border rounded dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
            >
              {/* A zone saved before this list existed still shows up */}
              {!WINDOWS_TIMEZONES.some((tz) => tz.value === resolveTimezoneValue(prefs?.timezone)) && (
                <option value={resolveTimezoneValue(prefs?.timezone)}>
                  {resolveTimezoneValue(prefs?.timezone)}
                </option>
              )}
              {WINDOWS_TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">Date format</label>
              <select
                value={prefs?.dateFormat || "DD/MM/YYYY"}
                onChange={(e) => updateMutation.mutate({ dateFormat: e.target.value })}
                className="w-full px-3 py-2 border rounded dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
              >
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">Time format</label>
              <select
                value={prefs?.timeFormat || "24"}
                onChange={(e) => updateMutation.mutate({ timeFormat: e.target.value })}
                className="w-full px-3 py-2 border rounded dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
              >
                <option value="24">24-hour</option>
                <option value="12">12-hour</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">Day start</label>
            <input
              type="time"
              value={prefs?.dayStart || "09:00"}
              onChange={(e) => updateMutation.mutate({ dayStart: e.target.value })}
              className="px-3 py-2 border rounded dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
