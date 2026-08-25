import { Router, RequestHandler } from "express";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthedRequest } from "../../middleware/auth";
import { getWorkspaceSettings } from "../../lib/workspaceSettings";
import { permissionsForUser } from "../../lib/permissions";

const r = Router();
r.use(requireAuth);

const wrap = (fn: RequestHandler): RequestHandler => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

interface NavItem {
  id: string;
  label: string;
  icon: string;
  to: string;
  section: string | null;
  hasSubmenu?: boolean;
}

// REQ-NAV-B01: Return navigation items visible to the user based on role
r.get("/menu", wrap(async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: "not_found" });

  const isAdmin = user.role === "ADMIN" || user.role === "OWNER";
  // Management sections follow Workspace Settings → Permissions
  const { permissions } = await permissionsForUser(req.userId!);
  const allowed = (resource: keyof typeof permissions, action: string) =>
    (permissions[resource] ?? []).includes(action as any);

  // Feature toggles from Workspace Settings decide what exists at all
  const ws = await getWorkspaceSettings();
  const items: NavItem[] = [];
  if (ws.timesheetEnabled) {
    items.push({ id: "timesheet", label: "Timesheet", icon: "📅", to: "/timesheet", section: null });
  }
  if (ws.timeTrackerEnabled) {
    items.push({ id: "tracker", label: "Time Tracker", icon: "⏱️", to: "/tracker", section: null });
  }
  if (ws.kioskEnabled) {
    items.push({ id: "kiosk", label: "Kiosk", icon: "🖥️", to: "/kiosk", section: null });
  }
  items.push(
    { id: "calendar", label: "Calendar", icon: "🗓️", to: "/calendar", section: null },
  );
  if (allowed("reports", "view")) {
    items.push(
      { id: "dashboard", label: "Dashboard", icon: "📊", to: "/dashboard", section: "ANALYZE" },
      { id: "reports", label: "Reports", icon: "📈", to: "/reports", section: "ANALYZE", hasSubmenu: true }
    );
  }
  // Management surfaces appear only where the role has "view"
  if (allowed("projects", "view")) {
    items.push({ id: "projects", label: "Projects", icon: "📁", to: "/projects", section: "MANAGE" });
  }
  if (allowed("team", "view")) {
    items.push({ id: "team", label: "Team", icon: "👥", to: "/team", section: "MANAGE" });
  }
  if (allowed("clients", "view")) {
    items.push({ id: "clients", label: "Clients", icon: "🏢", to: "/clients", section: "MANAGE" });
  }
  if (isAdmin) {
    // Workspace-wide configuration — admins only
    items.push({
      id: "workspace",
      label: "Workspace Settings",
      icon: "⚙️",
      to: "/workspace",
      section: "MANAGE",
    });
  }

  res.json({ role: user.role, items, permissions, features: {
    timesheet: ws.timesheetEnabled,
    timeTracker: ws.timeTrackerEnabled,
    kiosk: ws.kioskEnabled,
  } });
}));

export default r;
