import { Router, RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthedRequest } from "../../middleware/auth";
import { NotificationService, NOTIFICATION_TYPES } from "../notifications/service";

const r = Router();
r.use(requireAuth);

const wrap = (fn: RequestHandler): RequestHandler => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Extra general preferences (no dedicated columns) are stored under emailPrefs.general
const GENERAL_EXTRAS_KEY = "general";

const DEFAULT_GENERAL_EXTRAS = {
  groupSimilarEntries: true,
  compactProjectListMode: "collapse",
  compactProjectListThreshold: 50,
  taskFilter: false,
};

// REQ-ACC-B01: Retrieve the logged-in user's profile
r.get("/me", wrap(async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: "not_found" });
  const { passwordHash, emailPrefs, ...safe } = user;
  res.json(safe);
}));

// REQ-ACC-B03: Retrieve General preferences
r.get("/preferences/general", wrap(async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: "not_found" });
  const extras = ((user.emailPrefs as Record<string, any>)?.[GENERAL_EXTRAS_KEY]) || {};
  res.json({
    theme: user.theme,
    language: user.language,
    timezone: user.timezone,
    dateFormat: user.dateFormat,
    timeFormat: user.timeFormat,
    dayStart: user.dayStart,
    ...DEFAULT_GENERAL_EXTRAS,
    ...extras,
  });
}));

const GeneralPrefsSchema = z.object({
  theme: z.enum(["light", "dark"]).optional(),
  language: z.string().min(2).max(10).optional(),
  timezone: z.string().min(1).optional(),
  dateFormat: z.string().min(1).optional(),
  timeFormat: z.enum(["12", "24"]).optional(),
  dayStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  groupSimilarEntries: z.boolean().optional(),
  compactProjectListMode: z.string().optional(),
  // REQ-ACC-B04: threshold must be a positive integer
  compactProjectListThreshold: z.number().int().positive().optional(),
  taskFilter: z.boolean().optional(),
});

// REQ-ACC-B03: Persist General preferences (REQ-ACC-B09: scoped to the individual user)
r.patch("/preferences/general", wrap(async (req: AuthedRequest, res) => {
  const updates = GeneralPrefsSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: "not_found" });

  const {
    groupSimilarEntries,
    compactProjectListMode,
    compactProjectListThreshold,
    taskFilter,
    ...columnUpdates
  } = updates;

  const extraUpdates: Record<string, any> = {};
  if (groupSimilarEntries !== undefined) extraUpdates.groupSimilarEntries = groupSimilarEntries;
  if (compactProjectListMode !== undefined) extraUpdates.compactProjectListMode = compactProjectListMode;
  if (compactProjectListThreshold !== undefined) extraUpdates.compactProjectListThreshold = compactProjectListThreshold;
  if (taskFilter !== undefined) extraUpdates.taskFilter = taskFilter;

  const emailPrefs = (user.emailPrefs as Record<string, any>) || {};
  const data: Record<string, any> = { ...columnUpdates };
  if (Object.keys(extraUpdates).length > 0) {
    data.emailPrefs = {
      ...emailPrefs,
      [GENERAL_EXTRAS_KEY]: {
        ...DEFAULT_GENERAL_EXTRAS,
        ...(emailPrefs[GENERAL_EXTRAS_KEY] || {}),
        ...extraUpdates,
      },
    };
  }

  const updated = await prisma.user.update({ where: { id: req.userId! }, data });

  // REQ-ACC-B10: Log preference changes
  await prisma.auditLog.create({
    data: {
      userId: req.userId!,
      action: "GENERAL_PREFS_UPDATED",
      metadata: { changes: updates },
    },
  });

  const extras = ((updated.emailPrefs as Record<string, any>)?.[GENERAL_EXTRAS_KEY]) || {};
  res.json({
    theme: updated.theme,
    language: updated.language,
    timezone: updated.timezone,
    dateFormat: updated.dateFormat,
    timeFormat: updated.timeFormat,
    dayStart: updated.dayStart,
    ...DEFAULT_GENERAL_EXTRAS,
    ...extras,
  });
}));

// REQ-ACC-B06: Retrieve Email Notification preferences
r.get("/preferences/email-notifications", wrap(async (req: AuthedRequest, res) => {
  const prefs = await NotificationService.getPreferences(req.userId!);
  res.json(prefs);
}));

// REQ-ACC-B06: Persist Email Notification preferences
r.patch("/preferences/email-notifications", wrap(async (req: AuthedRequest, res) => {
  const schema = z.object(
    Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, z.boolean().optional()]))
  );
  const body = schema.parse(req.body);
  const prefs = await NotificationService.updatePreferences(req.userId!, body);
  res.json(prefs);
}));

export default r;
