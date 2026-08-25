import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useI18n } from "../../i18n";

export function AccountMenu() {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // REQ-ACC-B01: profile info for the account menu
  const { data: user } = useQuery({
    queryKey: ["user-profile"],
    queryFn: async () => (await api.get("/users/me")).data,
  });

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // REQ-ACC-F03: terminate session and redirect to login
  const handleLogout = async () => {
    await api.post("/auth/logout");
    queryClient.clear();
    // Return to the CrestSuite portal launcher (consistent across all apps)
    window.location.href = "/";
  };

  const initials = user?.name
    ? user.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  return (
    <div className="border-t border-slate-200 dark:border-slate-700 p-2 relative" ref={menuRef}>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="w-full flex items-center gap-2 p-2 rounded hover:bg-slate-100 dark:hover:bg-slate-700"
      >
        <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-white text-sm font-semibold">
          {initials}
        </div>
        <div className="flex-1 text-left">
          <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
            {user?.name || "User"}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {user?.email || ""}
          </div>
        </div>
      </button>

      {menuOpen && (
        <div className="absolute bottom-full left-2 right-2 mb-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg">
          {/* REQ-ACC-F02: My profile, Preferences, Log out */}
          <button
            onClick={() => { setMenuOpen(false); navigate("/profile"); }}
            className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            👤 {t("account.profile")}
          </button>
          <button
            onClick={() => { setMenuOpen(false); navigate("/preferences"); }}
            className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            ⚙️ {t("account.preferences")}
          </button>
          <div className="border-t border-slate-200 dark:border-slate-700"></div>
          <button
            onClick={handleLogout}
            className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            🚪 {t("account.logout")}
          </button>
        </div>
      )}
    </div>
  );
}
