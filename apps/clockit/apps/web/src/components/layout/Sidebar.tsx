import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { AccountMenu } from "./AccountMenu";
import { useI18n } from "../../i18n";

interface MenuItem {
  id: string;
  label: string;
  icon: string;
  to: string;
  section: string | null;
  hasSubmenu?: boolean;
}

const FALLBACK_ITEMS: MenuItem[] = [
  { id: "timesheet", label: "Timesheet", icon: "📅", to: "/timesheet", section: null },
  { id: "tracker", label: "Time Tracker", icon: "⏱️", to: "/tracker", section: null },
  { id: "calendar", label: "Calendar", icon: "🗓️", to: "/calendar", section: null },
  { id: "dashboard", label: "Dashboard", icon: "📊", to: "/dashboard", section: "ANALYZE" },
  { id: "reports", label: "Reports", icon: "📈", to: "/reports", section: "ANALYZE", hasSubmenu: true },
  { id: "projects", label: "Projects", icon: "📁", to: "/projects", section: "MANAGE" },
  { id: "team", label: "Team", icon: "👥", to: "/team", section: "MANAGE" },
];

export function Sidebar() {
  const { t } = useI18n();
  // REQ-NAV-B01: role-based navigation items from the backend
  const { data } = useQuery({
    queryKey: ["navigation-menu"],
    queryFn: async () => (await api.get("/navigation/menu")).data,
  });
  const items: MenuItem[] = data?.items ?? FALLBACK_ITEMS;
  const ungrouped = items.filter((i) => !i.section);
  const sections = ["ANALYZE", "MANAGE"];

  return (
    <aside className="w-56 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col">
      {/* Navigation (logo/title now lives in the Layout top bar) */}
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {ungrouped.map((item) => (
          <NavItem key={item.id} {...item} />
        ))}

        {sections.map((section) => {
          const sectionItems = items.filter((i) => i.section === section);
          if (sectionItems.length === 0) return null;
          return (
            <div key={section}>
              <div className="pt-4 pb-1 px-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">
                {t(`section.${section.toLowerCase()}`)}
              </div>
              {sectionItems.map((item) => (
                <NavItem key={item.id} {...item} />
              ))}
            </div>
          );
        })}
      </nav>

      {/* User section */}
      <AccountMenu />
    </aside>
  );
}

function NavItem({ id, to, icon, label, hasSubmenu }: MenuItem) {
  const { t, lang } = useI18n();
  // B8: translate known nav items by id; fall back to the server-provided label
  const translated = lang === "en" ? label : t(`nav.${id}`);
  const text = translated === `nav.${id}` ? label : translated;
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded text-sm ${
          isActive
            ? "bg-indigo-50 text-indigo-700 font-medium dark:bg-indigo-950 dark:text-indigo-300"
            : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
        }`
      }
    >
      <span>{icon}</span>
      <span className="flex-1">{text}</span>
      {/* REQ-NAV-F05: chevron for items with a nested sub-menu */}
      {hasSubmenu && <span className="text-slate-400">›</span>}
    </NavLink>
  );
}
