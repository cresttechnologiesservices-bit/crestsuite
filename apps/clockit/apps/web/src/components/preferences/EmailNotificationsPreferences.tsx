import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

const NOTIFICATION_TYPES = [
  { key: "newsletter", label: "Newsletter", description: "Product updates and news" },
  { key: "onboarding", label: "Onboarding", description: "Getting started guides and tips" },
  { key: "weekly_report", label: "Weekly report", description: "Summary of your weekly time tracking" },
  { key: "long_running_timer", label: "Long-running timer", description: "Alert when a timer runs too long" },
  { key: "scheduled_reports", label: "Scheduled reports", description: "Reports you've scheduled to receive" },
  { key: "approval", label: "Approval", description: "Timesheet approval notifications" },
  { key: "time_off", label: "Time off", description: "Time off requests and approvals" },
  { key: "alerts", label: "Alerts", description: "Important system alerts" },
  { key: "reminders", label: "Reminders", description: "Timesheet and task reminders" },
  { key: "schedule", label: "Schedule", description: "Schedule changes and updates" },
  { key: "invoices", label: "Invoices", description: "Invoice notifications" },
];

export function EmailNotificationsPreferences() {
  const queryClient = useQueryClient();
  const { data: prefs, isLoading } = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: async () => (await api.get("/users/preferences/email-notifications")).data,
  });
  const updateMutation = useMutation({
    mutationFn: async (updates: any) => {
      // REQ-ACC-F20: persist automatically on toggle
      await api.patch("/users/preferences/email-notifications", updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-preferences"] });
    },
  });

  const handleToggle = (key: string) => {
    if (!prefs) return;
    updateMutation.mutate({ [key]: !prefs[key] });
  };

  if (isLoading) {
    return <div className="text-center py-12 text-slate-500">Loading...</div>;
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold mb-2">Manage notifications</h2>
      <p className="text-sm text-slate-600 mb-6">
        Choose which email notifications you'd like to receive. You can update these preferences at any time.
      </p>
      <div className="space-y-4">
        {NOTIFICATION_TYPES.map((type) => (
          <div key={type.key} className="flex items-start justify-between py-3 border-b last:border-b-0">
            <div className="flex-1">
              <div className="font-medium text-slate-900">{type.label}</div>
              <div className="text-sm text-slate-500 mt-0.5">{type.description}</div>
            </div>
            <button
              type="button"
              onClick={() => handleToggle(type.key)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ml-4 ${
                prefs?.[type.key] ? "bg-indigo-600" : "bg-slate-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  prefs?.[type.key] ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
