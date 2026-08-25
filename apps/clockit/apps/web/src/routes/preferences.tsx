import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { GeneralPreferences } from "../components/preferences/GeneralPreferences";
import { EmailNotificationsPreferences } from "../components/preferences/EmailNotificationsPreferences";
import { useI18n } from "../i18n";

export function Preferences() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useI18n();
  const path = location.pathname.split("/").pop() || "general";
  const tabIds = ["general", "email-notifications", "pumble-notifications", "advanced"];
  const activeTab = tabIds.includes(path) ? path : "general";
  // REQ-ACC-F06: tab bar with General, Email Notifications, Pumble Notifications, Advanced
  const tabs = [
    { id: "general", label: t("prefs.general") },
    { id: "email-notifications", label: t("prefs.emailNotifications") },
    { id: "pumble-notifications", label: t("prefs.pumbleNotifications") },
    { id: "advanced", label: t("prefs.advanced") },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">{t("prefs.title")}</h1>

      <div className="border-b border-slate-200 dark:border-slate-700 mb-6">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => navigate(`/preferences/${tab.id}`)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                  : "border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <Routes>
        <Route index element={<GeneralPreferences />} />
        <Route path="general" element={<GeneralPreferences />} />
        <Route path="email-notifications" element={<EmailNotificationsPreferences />} />
        <Route
          path="pumble-notifications"
          element={
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-12 text-center text-slate-500 dark:text-slate-400">
              Pumble notifications coming soon
            </div>
          }
        />
        <Route
          path="advanced"
          element={
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-12 text-center text-slate-500 dark:text-slate-400">
              Advanced settings coming soon
            </div>
          }
        />
      </Routes>
    </div>
  );
}
