import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { toast, confirmDialog } from "../components/ui/notify";
import { CustomFieldsTab } from "../components/workspace/CustomFieldsTab";
import { currencySymbol, currencyDecimals, hasDistinctSymbol } from "../lib/workspace";

/**
 * Workspace Settings — admin-only, workspace-wide configuration.
 *
 * Saved values become the workspace defaults and are persisted server-side
 * (WorkspaceSettings), so they survive refresh and re-login. Non-admins never
 * see this route: the sidebar entry is admin-gated and the page itself refuses
 * to render for anyone the API reports as unable to manage the workspace.
 */

const TABS = [
  { id: "general", label: "General" },
  { id: "permissions", label: "Permissions" },
  { id: "alerts", label: "Alerts" },
  { id: "accounts", label: "Accounts" },
  { id: "authentication", label: "Authentication" },
  { id: "custom-fields", label: "Custom Fields" },
  { id: "integrations", label: "Integrations" },
  { id: "add-ons", label: "Add-ons" },
  { id: "import", label: "Import" },
] as const;

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "AUD", "CAD", "JPY", "CHF", "SGD", "AED"];

/**
 * The Currency format options depend on the selected Currency: the preview uses
 * that currency's symbol and decimal places, and currencies with no distinct
 * symbol (CHF, AED) only offer the code placements — a "symbol" form would just
 * repeat the code.
 */
function currencyFormatOptions(currency: string, numberFormat: string) {
  const symbol = currencySymbol(currency);
  // numberFormat is itself a sample ("1,000.00"); drop the minor unit for
  // zero-decimal currencies, whichever separator the sample uses
  const sample = currencyDecimals(currency) === 0 ? numberFormat.slice(0, -3) : numberFormat;
  const options: { value: string; label: string }[] = [];
  if (hasDistinctSymbol(currency)) {
    options.push({ value: "symbol-before", label: `${symbol}${sample}` });
    options.push({ value: "symbol-after", label: `${sample}${symbol}` });
  }
  options.push({ value: "code-before", label: `${currency} ${sample}` });
  options.push({ value: "code-after", label: `${sample} ${currency}` });
  return options;
}

/**
 * Keep the chosen format when the new currency still supports it, otherwise
 * fall back to the same placement in code form.
 */
function formatForCurrency(currency: string, current: string, numberFormat: string) {
  const options = currencyFormatOptions(currency, numberFormat);
  if (options.some((o) => o.value === current)) return current;
  if (current === "symbol-after") return "code-after";
  return "code-before";
}

// ---------- small shared UI pieces ----------

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${
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

function Setting({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-4 border-b last:border-b-0 flex items-start justify-between gap-6">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-900">{title}</div>
        {description && <p className="text-sm text-slate-500 mt-0.5">{description}</p>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">{children}</div>
    </div>
  );
}

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="pt-2 pb-1">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {description && <p className="text-sm text-slate-500 mt-0.5">{description}</p>}
    </div>
  );
}

const inputClass = "px-3 py-1.5 border rounded text-sm";

// ---------- page ----------

export function Workspace() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<string>("general");

  const { data: settings, isLoading } = useQuery({
    queryKey: ["workspace-settings"],
    queryFn: async () => (await api.get("/workspace/settings")).data,
  });

  const saveMutation = useMutation({
    mutationFn: async (patch: any) => (await api.patch("/workspace/settings", patch)).data,
    onSuccess: (data) => {
      queryClient.setQueryData(["workspace-settings"], data);
      queryClient.invalidateQueries({ queryKey: ["workspace-settings"] });
      // Feature toggles change the sidebar, so refresh navigation too
      queryClient.invalidateQueries({ queryKey: ["navigation-menu"] });
      // Permission edits change what every screen may show
      queryClient.invalidateQueries({ queryKey: ["workspace-permissions"] });
      toast("Workspace settings saved", "success");
    },
    onError: (error: any) => {
      toast(error?.response?.data?.error || "Could not save workspace settings", "error");
    },
  });

  if (isLoading) {
    return <div className="p-12 text-center text-slate-500">Loading workspace settings…</div>;
  }
  if (!settings?.canManage) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <h1 className="text-lg font-semibold text-slate-900">Workspace Settings</h1>
          <p className="text-slate-600 mt-2">
            Only workspace administrators can view or change these settings.
          </p>
        </div>
      </div>
    );
  }

  const save = (patch: any) => saveMutation.mutate(patch);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Workspace Settings</h1>
        <p className="text-slate-600 mt-1">
          Workspace-wide configuration. Changes apply as the default for everyone.
        </p>
      </div>

      {/* Tab bar */}
      <div className="border-b mb-6 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t.id
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "general" && <GeneralTab settings={settings} save={save} saving={saveMutation.isPending} />}
      {tab === "permissions" && <PermissionsTab settings={settings} save={save} />}
      {tab === "alerts" && <AlertsTab settings={settings} save={save} />}
      {tab === "accounts" && <AccountsTab settings={settings} save={save} />}
      {tab === "authentication" && <AuthenticationTab settings={settings} save={save} />}
      {tab === "custom-fields" && <CustomFieldsTab />}
      {tab === "integrations" && <IntegrationsTab settings={settings} save={save} />}
      {tab === "add-ons" && <AddOnsTab settings={settings} save={save} />}
      {tab === "import" && <ImportTab />}
    </div>
  );
}

// ---------- General (incl. Time & Attendance, Billing & Currency) ----------

function GeneralTab({
  settings,
  save,
  saving,
}: {
  settings: any;
  save: (patch: any) => void;
  saving: boolean;
}) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(settings.name);
  const [capacity, setCapacity] = useState(String(settings.dailyWorkCapacity ?? 8));
  const [rate, setRate] = useState(settings.billableRate == null ? "" : String(settings.billableRate));
  const [capacityError, setCapacityError] = useState("");
  const [rateError, setRateError] = useState("");

  useEffect(() => {
    setName(settings.name);
    setCapacity(String(settings.dailyWorkCapacity ?? 8));
    setRate(settings.billableRate == null ? "" : String(settings.billableRate));
  }, [settings.name, settings.dailyWorkCapacity, settings.billableRate]);

  const uploadLogo = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast("Please choose an image file", "error");
      return;
    }
    if (file.size > 700 * 1024) {
      toast("Logo is too large — please use an image under 700 KB", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = (await api.put("/workspace/settings/logo", { logoDataUrl: reader.result })).data;
        queryClient.setQueryData(["workspace-settings"], data);
        queryClient.invalidateQueries({ queryKey: ["workspace-settings"] });
        toast("Company logo updated", "success");
      } catch (error: any) {
        toast(error?.response?.data?.error || "Could not upload the logo", "error");
      }
    };
    reader.onerror = () => toast("Could not read the selected file", "error");
    reader.readAsDataURL(file);
  };

  const removeLogo = async () => {
    if (!(await confirmDialog({ title: "Remove logo", message: "Remove the company logo?", confirmLabel: "Remove", danger: true }))) {
      return;
    }
    try {
      const data = (await api.delete("/workspace/settings/logo")).data;
      queryClient.setQueryData(["workspace-settings"], data);
      queryClient.invalidateQueries({ queryKey: ["workspace-settings"] });
      toast("Company logo removed", "success");
    } catch {
      toast("Could not remove the logo", "error");
    }
  };

  const toggleWorkingDay = (day: string) => {
    const current: string[] = settings.workingDays ?? [];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    save({ workingDays: DAYS.filter((d) => next.includes(d)) });
  };

  const saveCapacity = () => {
    const value = Number(capacity);
    if (!Number.isFinite(value) || value < 0 || value > 24) {
      setCapacityError("Enter between 0 and 24 hours");
      return;
    }
    setCapacityError("");
    save({ dailyWorkCapacity: value });
  };

  const saveRate = () => {
    if (rate.trim() === "") {
      setRateError("");
      save({ billableRate: null });
      return;
    }
    const value = Number(rate);
    if (!Number.isFinite(value) || value < 0) {
      setRateError("Enter a valid amount");
      return;
    }
    setRateError("");
    save({ billableRate: value });
  };

  return (
    <div className="space-y-6">
      {/* --- General --- */}
      <div className="bg-white rounded-lg shadow p-6">
        <SectionHeading title="General" description="Workspace identity and the features available to its members." />

        <Setting title="Company logo" description="Shown across the workspace. PNG, JPG or SVG up to 700 KB.">
          <div className="flex items-center gap-3">
            {settings.logoDataUrl ? (
              <img
                src={settings.logoDataUrl}
                alt="Company logo"
                className="h-10 w-auto max-w-[120px] object-contain border rounded bg-white"
              />
            ) : (
              <span className="text-sm text-slate-400">No logo</span>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadLogo(file);
                e.target.value = "";
              }}
            />
            <button onClick={() => fileRef.current?.click()} className="px-3 py-1.5 border rounded text-sm hover:bg-slate-50">
              {settings.logoDataUrl ? "Change" : "Upload"}
            </button>
            {settings.logoDataUrl && (
              <button onClick={removeLogo} className="px-3 py-1.5 border border-red-300 text-red-600 rounded text-sm hover:bg-red-50">
                Remove
              </button>
            )}
          </div>
        </Setting>

        <Setting title="Workspace name" description="The name shown to everyone in this workspace.">
          <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputClass} w-56`} />
          <button
            onClick={() => (name.trim() ? save({ name: name.trim() }) : toast("Workspace name cannot be empty", "error"))}
            disabled={saving || name === settings.name}
            className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            Save
          </button>
          {name !== settings.name && (
            <button onClick={() => setName(settings.name)} className="px-3 py-1.5 border rounded text-sm hover:bg-slate-50">
              Cancel
            </button>
          )}
        </Setting>

        <Setting title="Timesheet" description="Let members log time on a weekly grid.">
          <Toggle checked={settings.timesheetEnabled} onChange={(v) => save({ timesheetEnabled: v })} />
        </Setting>
        <Setting title="Time Tracker" description="Let members start/stop a timer and add entries manually.">
          <Toggle checked={settings.timeTrackerEnabled} onChange={(v) => save({ timeTrackerEnabled: v })} />
        </Setting>
        <Setting title="Kiosk" description="Shared device where members clock in and out with a PIN.">
          <Toggle checked={settings.kioskEnabled} onChange={(v) => save({ kioskEnabled: v })} />
        </Setting>

        <Setting title="New projects are" description="Default billability applied to newly created projects.">
          <label className="flex items-center gap-1.5 text-sm">
            <input type="radio" name="billable" checked={settings.defaultBillable} onChange={() => save({ defaultBillable: true })} />
            Billable
          </label>
          <label className="flex items-center gap-1.5 text-sm ml-3">
            <input type="radio" name="billable" checked={!settings.defaultBillable} onChange={() => save({ defaultBillable: false })} />
            Non-billable
          </label>
        </Setting>
        <Setting title="New project visibility" description="Public projects are visible to everyone; private ones only to their members.">
          <label className="flex items-center gap-1.5 text-sm">
            <input type="radio" name="visibility" checked={settings.defaultProjectPublic} onChange={() => save({ defaultProjectPublic: true })} />
            Public
          </label>
          <label className="flex items-center gap-1.5 text-sm ml-3">
            <input type="radio" name="visibility" checked={!settings.defaultProjectPublic} onChange={() => save({ defaultProjectPublic: false })} />
            Private
          </label>
        </Setting>
      </div>

      {/* --- Time & attendance --- */}
      <div className="bg-white rounded-lg shadow p-6">
        <SectionHeading title="Time &amp; Attendance" description="How time is organised, displayed and measured across the workspace." />

        <Setting title="Organize time by" description="The hierarchy members pick when logging time.">
          <select value={settings.organizeTimeBy} onChange={(e) => save({ organizeTimeBy: e.target.value })} className={inputClass}>
            <option value="client-project-task">Client → Project → Task</option>
            <option value="project-task">Project → Task</option>
            <option value="project-only">Project only</option>
          </select>
        </Setting>
        <Setting title="Duration format" description="How tracked durations are displayed in lists and reports.">
          <select value={settings.durationFormat} onChange={(e) => save({ durationFormat: e.target.value })} className={inputClass}>
            <option value="compact">Compact (2:30)</option>
            <option value="full">Full (2h 30m)</option>
            <option value="decimal">Decimal (2.50)</option>
          </select>
        </Setting>
        <Setting title="Week start" description="First day of the week in timesheets, reports and the calendar.">
          <select value={settings.weekStart} onChange={(e) => save({ weekStart: e.target.value })} className={inputClass}>
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Setting>
        <Setting title="Working days" description="Days counted towards expected working time.">
          <div className="flex flex-wrap gap-1 justify-end max-w-md">
            {DAYS.map((d) => {
              const active = (settings.workingDays ?? []).includes(d);
              return (
                <button
                  key={d}
                  onClick={() => toggleWorkingDay(d)}
                  className={`px-2 py-1 text-xs rounded border ${
                    active ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {d.slice(0, 3)}
                </button>
              );
            })}
          </div>
        </Setting>
        <Setting title="Daily work capacity" description="Expected hours per working day, used for capacity and overtime.">
          <div className="text-right">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={24}
                step={0.5}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                className={`${inputClass} w-24 text-right`}
              />
              <span className="text-sm text-slate-500">hours</span>
              <button onClick={saveCapacity} className="px-3 py-1.5 border rounded text-sm hover:bg-slate-50">
                Change
              </button>
            </div>
            {capacityError && <div className="text-xs text-red-600 mt-1">{capacityError}</div>}
          </div>
        </Setting>
        <Setting title="Overtime calculation period" description="The window over which time above capacity counts as overtime.">
          <select value={settings.overtimePeriod} onChange={(e) => save({ overtimePeriod: e.target.value })} className={inputClass}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="none">Do not calculate</option>
          </select>
        </Setting>
      </div>

      {/* --- Billing & currency --- */}
      <div className="bg-white rounded-lg shadow p-6">
        <SectionHeading title="Billing &amp; Currency" description="Default rate and the way money is formatted in reports." />

        <Setting title="Workspace billable rate" description="Applied when a project or member has no rate of its own.">
          <div className="text-right">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step={0.01}
                placeholder="Not set"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className={`${inputClass} w-28 text-right`}
              />
              <span className="text-sm text-slate-500">{settings.currency} / h</span>
              <button onClick={saveRate} className="px-3 py-1.5 border rounded text-sm hover:bg-slate-50">
                Change
              </button>
            </div>
            {rateError && <div className="text-xs text-red-600 mt-1">{rateError}</div>}
          </div>
        </Setting>
        <Setting title="Currency" description="Currency used for billable amounts across the workspace.">
          <select
            value={settings.currency}
            onChange={(e) => {
              const currency = e.target.value;
              // Saved together so the stored format is always valid for the currency
              save({
                currency,
                currencyFormat: formatForCurrency(currency, settings.currencyFormat, settings.numberFormat),
              });
            }}
            className={inputClass}
          >
            {(CURRENCIES.includes(settings.currency) ? CURRENCIES : [settings.currency, ...CURRENCIES]).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Setting>
        <Setting title="Number format" description="Thousands and decimal separators used for numbers.">
          <select value={settings.numberFormat} onChange={(e) => save({ numberFormat: e.target.value })} className={inputClass}>
            <option value="1,000.00">1,000.00</option>
            <option value="1.000,00">1.000,00</option>
            <option value="1 000.00">1 000.00</option>
          </select>
        </Setting>
        <Setting
          title="Currency format"
          description={`How amounts in ${settings.currency} are written.`}
        >
          <select
            value={settings.currencyFormat}
            onChange={(e) => save({ currencyFormat: e.target.value })}
            className={inputClass}
          >
            {currencyFormatOptions(settings.currency, settings.numberFormat).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Setting>
      </div>
    </div>
  );
}

// ---------- Permissions ----------

const PERMISSION_RESOURCES = [
  { key: "projects", label: "Projects" },
  { key: "clients", label: "Clients" },
  { key: "tasks", label: "Tasks" },
  { key: "timeEntries", label: "Time entries" },
  { key: "reports", label: "Reports" },
  { key: "team", label: "Team" },
];
const PERMISSION_ACTIONS = ["view", "create", "edit", "delete", "manage"];
const PERMISSION_ROLES = [
  { key: "MANAGER", label: "Manager" },
  { key: "MEMBER", label: "Member" },
];

function PermissionsTab({ settings, save }: { settings: any; save: (patch: any) => void }) {
  const permissions = settings.permissions ?? {};
  const [role, setRole] = useState("MANAGER");
  const rolePerms = permissions[role] ?? {};

  const toggle = (resource: string, action: string) => {
    const current: string[] = rolePerms[resource] ?? [];
    const next = current.includes(action)
      ? current.filter((a) => a !== action)
      : [...current, action];
    save({
      permissions: {
        ...permissions,
        [role]: { ...rolePerms, [resource]: PERMISSION_ACTIONS.filter((a) => next.includes(a)) },
      },
    });
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <SectionHeading
        title="Permissions"
        description="What each role may do in this workspace. Administrators always have full access, and only administrators can change these settings."
      />
      <div className="flex items-center gap-2 py-4 border-b">
        <label className="text-sm text-slate-600">Role</label>
        <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
          {PERMISSION_ROLES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="overflow-x-auto mt-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs font-semibold text-slate-500 uppercase">
              <th className="py-2 pr-4">Resource</th>
              {PERMISSION_ACTIONS.map((a) => (
                <th key={a} className="py-2 px-3 text-center capitalize">
                  {a}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_RESOURCES.map((resource) => (
              <tr key={resource.key} className="border-b last:border-0">
                <td className="py-2 pr-4 font-medium text-slate-700">{resource.label}</td>
                {PERMISSION_ACTIONS.map((action) => (
                  <td key={action} className="py-2 px-3 text-center">
                    <input
                      type="checkbox"
                      checked={(rolePerms[resource.key] ?? []).includes(action)}
                      onChange={() => toggle(resource.key, action)}
                      className="accent-indigo-600"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Alerts ----------

const ALERT_SETTINGS = [
  { key: "timerStillRunning", label: "Timer still running", description: "Remind a member when a timer has been running for an unusually long time." },
  { key: "missingTimeEntries", label: "Missing time entries", description: "Notify members who logged no time on a working day." },
  { key: "overtimeReached", label: "Overtime reached", description: "Alert when a member exceeds the configured overtime threshold." },
  { key: "dailyCapacityReached", label: "Daily capacity reached", description: "Notify when a member reaches their daily work capacity." },
  { key: "timesheetSubmitted", label: "Timesheet submitted", description: "Notify approvers when a timesheet is submitted for approval." },
  { key: "timesheetApproved", label: "Timesheet approved", description: "Notify the member when their timesheet is approved or rejected." },
  { key: "timesheetReminder", label: "Timesheet reminder", description: "Remind members to submit their timesheet at the end of the week." },
  { key: "missingClockOut", label: "Missing clock-out", description: "Alert when an attendance session was never closed." },
  { key: "weeklyDigest", label: "Weekly digest", description: "Send a weekly summary of tracked time to administrators." },
];

function AlertsTab({ settings, save }: { settings: any; save: (patch: any) => void }) {
  const alerts = settings.alerts ?? {};
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <SectionHeading
        title="Alerts &amp; Notifications"
        description="Workspace-level reminders and notifications. Members can still mute individual channels in their own preferences."
      />
      {ALERT_SETTINGS.map((alert) => (
        <Setting key={alert.key} title={alert.label} description={alert.description}>
          <Toggle
            checked={!!alerts[alert.key]}
            onChange={(v) => save({ alerts: { ...alerts, [alert.key]: v } })}
          />
        </Setting>
      ))}
    </div>
  );
}

// ---------- Accounts ----------

function AccountsTab({ settings, save }: { settings: any; save: (patch: any) => void }) {
  const accounts = settings.accounts ?? {};
  const update = (patch: any) => save({ accounts: { ...accounts, ...patch } });
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <SectionHeading title="Accounts" description="Defaults applied to member accounts in this workspace." />
      <Setting title="Default role for new members" description="Role assigned when someone joins or is invited.">
        <select value={accounts.defaultRole ?? "MEMBER"} onChange={(e) => update({ defaultRole: e.target.value })} className={inputClass}>
          <option value="MEMBER">Member</option>
          <option value="MANAGER">Manager</option>
          <option value="ADMIN">Admin</option>
        </select>
      </Setting>
      <Setting title="Allow self sign-up" description="Let people create their own account with a company email address.">
        <Toggle checked={!!accounts.allowSelfSignup} onChange={(v) => update({ allowSelfSignup: v })} />
      </Setting>
      <Setting title="Require complete profile" description="Ask new members to fill in their profile before tracking time.">
        <Toggle checked={!!accounts.requireProfileCompletion} onChange={(v) => update({ requireProfileCompletion: v })} />
      </Setting>
      <Setting title="Deactivate after inactivity" description="Days of inactivity before an account is deactivated (0 = never).">
        <input
          type="number"
          min={0}
          value={accounts.deactivateAfterInactiveDays ?? 0}
          onChange={(e) => update({ deactivateAfterInactiveDays: Number(e.target.value) || 0 })}
          className={`${inputClass} w-24 text-right`}
        />
      </Setting>
    </div>
  );
}

// ---------- Authentication ----------

function AuthenticationTab({ settings, save }: { settings: any; save: (patch: any) => void }) {
  const auth = settings.authentication ?? {};
  const update = (patch: any) => save({ authentication: { ...auth, ...patch } });
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <SectionHeading title="Authentication" description="How members sign in to this workspace." />
      <Setting title="Password sign-in" description="Allow signing in with an email address and password.">
        <Toggle checked={auth.passwordLoginEnabled !== false} onChange={(v) => update({ passwordLoginEnabled: v })} />
      </Setting>
      <Setting title="One-time code sign-in" description="Allow signing in with a code sent by email.">
        <Toggle checked={auth.otpLoginEnabled !== false} onChange={(v) => update({ otpLoginEnabled: v })} />
      </Setting>
      <Setting title="Enforce strong passwords" description="Require a minimum length and a mix of character types.">
        <Toggle checked={auth.enforceStrongPasswords !== false} onChange={(v) => update({ enforceStrongPasswords: v })} />
      </Setting>
      <Setting title="Google SSO" description="Let members sign in with a Google account.">
        <Toggle checked={!!auth.googleSso} onChange={(v) => update({ googleSso: v })} />
      </Setting>
      <Setting title="Microsoft SSO" description="Let members sign in with a Microsoft account.">
        <Toggle checked={!!auth.microsoftSso} onChange={(v) => update({ microsoftSso: v })} />
      </Setting>
      <Setting title="Apple SSO" description="Let members sign in with an Apple account.">
        <Toggle checked={!!auth.appleSso} onChange={(v) => update({ appleSso: v })} />
      </Setting>
      <Setting title="Session timeout" description="Hours before an inactive session is signed out.">
        <input
          type="number"
          min={1}
          value={auth.sessionTimeoutHours ?? 168}
          onChange={(e) => update({ sessionTimeoutHours: Number(e.target.value) || 1 })}
          className={`${inputClass} w-24 text-right`}
        />
      </Setting>
    </div>
  );
}

// ---------- Custom fields ----------

// ---------- Integrations ----------

function IntegrationsTab({ settings, save }: { settings: any; save: (patch: any) => void }) {
  const integrations = settings.integrations ?? {};
  const update = (patch: any) => save({ integrations: { ...integrations, ...patch } });
  const [webhook, setWebhook] = useState(integrations.webhookUrl ?? "");
  useEffect(() => setWebhook(integrations.webhookUrl ?? ""), [integrations.webhookUrl]);

  const items = [
    { key: "googleCalendar", label: "Google Calendar", description: "Show calendar events alongside tracked time." },
    { key: "outlookCalendar", label: "Outlook Calendar", description: "Show Outlook events alongside tracked time." },
    { key: "slack", label: "Slack", description: "Post reminders and approvals to a Slack workspace." },
    { key: "jira", label: "Jira", description: "Link time entries to Jira issues." },
  ];

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <SectionHeading title="Integrations" description="Connect this workspace to the tools your team already uses." />
      {items.map((item) => (
        <Setting key={item.key} title={item.label} description={item.description}>
          <Toggle checked={!!integrations[item.key]} onChange={(v) => update({ [item.key]: v })} />
        </Setting>
      ))}
      <Setting title="Outgoing webhook" description="POST workspace events to this URL (leave empty to disable).">
        <input
          placeholder="https://example.com/hook"
          value={webhook}
          onChange={(e) => setWebhook(e.target.value)}
          className={`${inputClass} w-64`}
        />
        <button
          onClick={() => update({ webhookUrl: webhook.trim() })}
          className="px-3 py-1.5 border rounded text-sm hover:bg-slate-50"
        >
          Save
        </button>
      </Setting>
    </div>
  );
}

// ---------- Add-ons ----------

function AddOnsTab({ settings, save }: { settings: any; save: (patch: any) => void }) {
  const addons = settings.addons ?? {};
  const items = [
    { key: "kiosk", label: "Kiosk", description: "Clock in and out from a shared device." },
    { key: "screenshots", label: "Screenshots", description: "Capture periodic screenshots while the timer runs." },
    { key: "gpsTracking", label: "GPS tracking", description: "Record location with mobile time entries." },
    { key: "invoicing", label: "Invoicing", description: "Turn billable time into invoices." },
    { key: "scheduling", label: "Scheduling", description: "Plan assignments and capacity ahead of time." },
  ];
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <SectionHeading title="Add-ons" description="Optional capabilities that can be switched on for this workspace." />
      {items.map((item) => (
        <Setting key={item.key} title={item.label} description={item.description}>
          <Toggle checked={!!addons[item.key]} onChange={(v) => save({ addons: { ...addons, [item.key]: v } })} />
        </Setting>
      ))}
    </div>
  );
}

// ---------- Import ----------

/** Characters Postgres cannot store; also the signature of a mis-decoded file. */
function stripControlChars(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 32 || code === 9 || code === 10 || code === 13) out += value[i];
  }
  return out;
}

/**
 * Decode an uploaded file as text, honouring the encoding it was actually
 * saved in. Excel's "Unicode Text" export is UTF-16, which decodes as UTF-8
 * into a string full of NUL characters — those used to be posted straight to
 * the API. Spreadsheet binaries (.xlsx) are rejected outright.
 */
function decodeTextFile(buffer: ArrayBuffer): { text: string } | { error: string } {
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) return { error: "The file is empty." };

  // ZIP magic — .xlsx/.ods are archives, not text
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return {
      error:
        "That looks like an Excel workbook (.xlsx). Save it as CSV (File → Save As → CSV UTF-8) and try again.",
    };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)) };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)) };
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)) };
  }

  // No BOM: UTF-16 without one shows up as every other byte being NUL
  const sample = bytes.subarray(0, Math.min(bytes.length, 512));
  const nulCount = sample.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0);
  if (nulCount > sample.length / 4) {
    const evenNuls = sample.reduce((c, b, i) => c + (i % 2 === 0 && b === 0 ? 1 : 0), 0);
    return {
      text: new TextDecoder(evenNuls > nulCount / 2 ? "utf-16be" : "utf-16le").decode(bytes),
    };
  }
  return { text: new TextDecoder("utf-8").decode(bytes) };
}

/** Minimal CSV parser handling quoted fields — enough for "name,client" imports. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(value.trim());
      value = "";
    } else if (char === "\n") {
      row.push(value.trim());
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") value += char;
  }
  row.push(value.trim());
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

function ImportTab() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null);

  const MAX_ROWS = 500;

  const importProjects = async (file: File) => {
    setBusy(true);
    setResult(null);
    try {
      if (file.size > 2 * 1024 * 1024) {
        toast("That file is larger than 2 MB — please split the import.", "error");
        return;
      }
      const decoded = decodeTextFile(await file.arrayBuffer());
      if ("error" in decoded) {
        toast(decoded.error, "error");
        return;
      }
      const rows = parseCsv(stripControlChars(decoded.text));
      if (!rows.length) {
        toast("No rows found in the file", "error");
        return;
      }
      // Skip a header row when it names the columns
      const header = rows[0].map((c) => c.toLowerCase());
      let dataRows = header.includes("name") || header.includes("project") ? rows.slice(1) : rows;
      if (dataRows.length > MAX_ROWS) {
        toast(`Only the first ${MAX_ROWS} rows were imported.`, "info");
        dataRows = dataRows.slice(0, MAX_ROWS);
      }

      const clients = (await api.get("/clients")).data;
      const clientList: any[] = Array.isArray(clients) ? clients : clients.items ?? [];
      const clientByName = new Map<string, string>(
        clientList.map((c: any) => [String(c.name).toLowerCase(), c.id])
      );

      let created = 0;
      let skipped = 0;
      const errors: string[] = [];
      for (const row of dataRows) {
        const name = (row[0] ?? "").trim().slice(0, 255);
        if (!name) {
          skipped++;
          continue;
        }
        const clientName = (row[1] ?? "").trim();
        try {
          const payload: any = { name };
          if (clientName) {
            const clientId = clientByName.get(clientName.toLowerCase());
            if (clientId) payload.clientId = clientId;
          }
          await api.post("/projects", payload);
          created++;
        } catch (error: any) {
          skipped++;
          const message = error?.response?.data?.error || "could not be created";
          if (errors.length < 5) errors.push(`${name}: ${message}`);
        }
      }
      setResult({ created, skipped, errors });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast(`Imported ${created} project${created === 1 ? "" : "s"}`, created ? "success" : "error");
    } catch {
      toast("Could not read the CSV file", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <SectionHeading title="Import" description="Bring existing data into this workspace from a CSV file." />
      <div className="py-4 border-b">
        <div className="text-sm font-medium text-slate-900">Import projects</div>
        <p className="text-sm text-slate-500 mt-0.5">
          One project per line: <code className="bg-slate-100 px-1 rounded">name,client</code>. The
          client column is optional and is matched against existing clients by name; a header row is
          detected automatically.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importProjects(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="px-4 py-2 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Importing…" : "Choose CSV file"}
          </button>
        </div>
        {result && (
          <div className="mt-3 text-sm">
            <div className="text-slate-700">
              Created <strong>{result.created}</strong>, skipped <strong>{result.skipped}</strong>.
            </div>
            {result.errors.length > 0 && (
              <ul className="mt-1 text-xs text-red-600 list-disc list-inside">
                {result.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="py-4">
        <div className="text-sm font-medium text-slate-900">Import time entries</div>
        <p className="text-sm text-slate-500 mt-0.5">
          Time entries are imported per member from Reports → Detailed, so each row keeps its owner.
          Export the data from your previous tool, then use the tracker's manual entry mode or the
          timesheet grid to bring it in.
        </p>
      </div>
    </div>
  );
}
