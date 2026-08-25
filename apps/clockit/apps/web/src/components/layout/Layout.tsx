import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Sidebar } from "./Sidebar";
import { NotificationBell } from "./NotificationBell";
import { useWorkspace } from "../../lib/workspace";

export function Layout() {
  const navigate = useNavigate();
  const workspace = useWorkspace();
  // Auth guard: redirect to login when there is no valid session
  const { data: user, isError } = useQuery({
    queryKey: ["user-profile"],
    queryFn: async () => (await api.get("/users/me")).data,
    retry: false,
  });

  useEffect(() => {
    if (isError) navigate("/login", { replace: true });
  }, [isError, navigate]);

  // B7: apply the persisted theme preference (User.theme) by toggling the
  // Tailwind `dark` class on the root element.
  useEffect(() => {
    if (user?.theme) {
      document.documentElement.classList.toggle("dark", user.theme === "dark");
    }
  }, [user?.theme]);

  return (
    <div className="h-screen flex flex-col bg-slate-50 dark:bg-slate-900">
      {/* I20: top bar with the ClockIT logo/title and the notification bell */}
      <header className="h-14 flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-4">
        {/* Workspace logo and name come from Workspace Settings → General */}
        <div className="flex items-center gap-2 min-w-0">
          {workspace.logoDataUrl ? (
            <img
              src={workspace.logoDataUrl}
              alt={workspace.name}
              className="h-8 w-auto max-w-[120px] object-contain"
            />
          ) : (
            <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white font-bold">
              C
            </div>
          )}
          <span className="font-bold text-slate-900 dark:text-slate-100">ClockIT</span>
          <span className="text-slate-400 dark:text-slate-500">·</span>
          <span className="text-sm text-slate-600 dark:text-slate-300 truncate">
            {workspace.name}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          {/* REQ-NAV-F01: app-switcher grid icon (moved from the sidebar header) */}
          <button
            type="button"
            title="Switch apps"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg leading-none px-1"
          >
            ▦
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <Sidebar />

        {/* Main content */}
        <main className="flex-1 overflow-auto dark:text-slate-100">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
