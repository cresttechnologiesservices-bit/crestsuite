import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthedRequest } from "../../middleware/auth";
import { invalidateWorkspaceSettings } from "../../lib/workspaceSettings";
import { DEFAULT_PERMISSIONS, permissionsForUser } from "../../lib/permissions";

const r = Router();
r.use(requireAuth);

const SETTINGS_ID = "workspace";
const ADMIN_ROLES = ["ADMIN", "OWNER"];
/** Logos are stored inline as data URLs; keep them small enough to embed. */
const MAX_LOGO_BYTES = 1_000_000;

// Defaults for the JSON-backed tabs, merged over whatever is stored so newly
// added options appear without a migration.
const DEFAULT_ALERTS = {
  timerStillRunning: true,
  missingTimeEntries: true,
  overtimeReached: true,
  dailyCapacityReached: false,
  timesheetSubmitted: true,
  timesheetApproved: true,
  timesheetReminder: true,
  missingClockOut: false,
  weeklyDigest: false,
};

const DEFAULT_ACCOUNTS = {
  defaultRole: "MEMBER",
  requireProfileCompletion: false,
  allowSelfSignup: false,
  deactivateAfterInactiveDays: 0,
};

const DEFAULT_AUTHENTICATION = {
  passwordLoginEnabled: true,
  otpLoginEnabled: true,
  googleSso: false,
  microsoftSso: false,
  appleSso: false,
  enforceStrongPasswords: true,
  sessionTimeoutHours: 168,
};

const DEFAULT_INTEGRATIONS = {
  googleCalendar: false,
  outlookCalendar: false,
  slack: false,
  jira: false,
  webhookUrl: "",
};

const DEFAULT_ADDONS = {
  kiosk: false,
  screenshots: false,
  gpsTracking: false,
  invoicing: false,
  scheduling: false,
};

async function isAdmin(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return !!user && ADMIN_ROLES.includes(user.role);
}

/** Load the singleton row, creating it with defaults on first use. */
async function loadSettings() {
  const existing = await prisma.workspaceSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (existing) return existing;
  return prisma.workspaceSettings.create({ data: { id: SETTINGS_ID } });
}

function serialize(settings: any) {
  return {
    ...settings,
    dailyWorkCapacity: settings.dailyWorkCapacity != null ? Number(settings.dailyWorkCapacity) : null,
    billableRate: settings.billableRate != null ? Number(settings.billableRate) : null,
    permissions: { ...DEFAULT_PERMISSIONS, ...((settings.permissions as any) || {}) },
    alerts: { ...DEFAULT_ALERTS, ...((settings.alerts as any) || {}) },
    accounts: { ...DEFAULT_ACCOUNTS, ...((settings.accounts as any) || {}) },
    authentication: { ...DEFAULT_AUTHENTICATION, ...((settings.authentication as any) || {}) },
    customFields: Array.isArray(settings.customFields) ? settings.customFields : [],
    integrations: { ...DEFAULT_INTEGRATIONS, ...((settings.integrations as any) || {}) },
    addons: { ...DEFAULT_ADDONS, ...((settings.addons as any) || {}) },
  };
}

/**
 * Every signed-in user may read the workspace identity and feature toggles —
 * the app needs them to render. The admin-only tabs are stripped for everyone
 * else so non-admins cannot see workspace configuration.
 */
r.get("/settings", async (req: AuthedRequest, res, next) => {
  try {
    const settings = serialize(await loadSettings());
    if (await isAdmin(req.userId!)) return res.json({ ...settings, canManage: true });
    const {
      permissions,
      alerts,
      accounts,
      authentication,
      integrations,
      addons,
      customFields,
      ...pub
    } = settings;
    res.json({ ...pub, canManage: false });
  } catch (error) {
    next(error);
  }
});

r.get("/permissions/me", async (req: AuthedRequest, res, next) => {
  try {
    res.json(await permissionsForUser(req.userId!));
  } catch (error) {
    next(error);
  }
});

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const PatchSchema = z.object({
  // General
  name: z.string().trim().min(1).max(120).optional(),
  timesheetEnabled: z.boolean().optional(),
  timeTrackerEnabled: z.boolean().optional(),
  kioskEnabled: z.boolean().optional(),
  defaultBillable: z.boolean().optional(),
  defaultProjectPublic: z.boolean().optional(),
  // Time & attendance
  organizeTimeBy: z.enum(["client-project-task", "project-task", "project-only"]).optional(),
  durationFormat: z.enum(["compact", "full", "decimal"]).optional(),
  weekStart: z.enum(DAYS).optional(),
  workingDays: z.array(z.enum(DAYS)).max(7).optional(),
  dailyWorkCapacity: z.number().min(0).max(24).optional(),
  overtimePeriod: z.enum(["daily", "weekly", "monthly", "none"]).optional(),
  // Billing & currency
  billableRate: z.number().min(0).max(1_000_000).nullable().optional(),
  currency: z.string().trim().min(1).max(10).optional(),
  numberFormat: z.enum(["1,000.00", "1.000,00", "1 000.00"]).optional(),
  currencyFormat: z.enum(["symbol-before", "symbol-after", "code-before", "code-after"]).optional(),
  // JSON tabs
  permissions: z.record(z.any()).optional(),
  alerts: z.record(z.boolean()).optional(),
  accounts: z.record(z.any()).optional(),
  authentication: z.record(z.any()).optional(),
  customFields: z.array(z.any()).optional(),
  integrations: z.record(z.any()).optional(),
  addons: z.record(z.any()).optional(),
});

r.patch("/settings", async (req: AuthedRequest, res, next) => {
  try {
    if (!(await isAdmin(req.userId!))) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const body = PatchSchema.parse(req.body);
    await loadSettings();
    const updated = await prisma.workspaceSettings.update({
      where: { id: SETTINGS_ID },
      data: { ...(body as any), updatedById: req.userId! },
    });
    invalidateWorkspaceSettings(); // applies immediately across the API
    await prisma.auditLog.create({
      data: {
        userId: req.userId!,
        action: "WORKSPACE_SETTINGS_UPDATE",
        target: SETTINGS_ID,
        metadata: { fields: Object.keys(body) },
      },
    });
    res.json(serialize(updated));
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "validation", details: error.flatten() });
    }
    next(error);
  }
});

// Company logo: uploaded/replaced as an image data URL, or removed
r.put("/settings/logo", async (req: AuthedRequest, res, next) => {
  try {
    if (!(await isAdmin(req.userId!))) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const { logoDataUrl } = z
      .object({ logoDataUrl: z.string().min(1) })
      .parse(req.body);
    if (!/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,/.test(logoDataUrl)) {
      return res.status(400).json({ error: "Logo must be a PNG, JPEG, GIF, WebP or SVG image" });
    }
    if (logoDataUrl.length > MAX_LOGO_BYTES) {
      return res.status(400).json({ error: "Logo is too large (max ~700 KB)" });
    }
    await loadSettings();
    const updated = await prisma.workspaceSettings.update({
      where: { id: SETTINGS_ID },
      data: { logoDataUrl, updatedById: req.userId! },
    });
    invalidateWorkspaceSettings();
    res.json(serialize(updated));
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "validation", details: error.flatten() });
    }
    next(error);
  }
});

r.delete("/settings/logo", async (req: AuthedRequest, res, next) => {
  try {
    if (!(await isAdmin(req.userId!))) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    await loadSettings();
    const updated = await prisma.workspaceSettings.update({
      where: { id: SETTINGS_ID },
      data: { logoDataUrl: null, updatedById: req.userId! },
    });
    invalidateWorkspaceSettings();
    res.json(serialize(updated));
  } catch (error) {
    next(error);
  }
});

export default r;
