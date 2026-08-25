import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthedRequest } from "../../middleware/auth";
import { TimesheetService, PHASES } from "./service";
import { requireFeature } from "../../middleware/featureGate";
import { requirePermission } from "../../middleware/permissions";

const r = Router();
r.use(requireAuth);
// Turning Timesheet off in Workspace Settings removes it for everyone,
// including direct API calls.
r.use(requireFeature("timesheet"));

// REQ-TS-B10: a user may only act on another user's timesheet with an elevated role
async function canActFor(req: AuthedRequest, targetUserId: string): Promise<boolean> {
  if (!targetUserId || targetUserId === req.userId) return true;
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  return !!user && (user.role === "ADMIN" || user.role === "MANAGER" || user.role === "OWNER");
}

// I5: admins may edit entries of a submitted timesheet
async function canBypassLock(req: AuthedRequest): Promise<boolean> {
  return TimesheetService.canBypassLock(req.userId!);
}

// REQ-TS-B01: Get projects for week — only the projects assigned to the
// (viewed) user; ?user_id lets admins act for another user.
r.get("/projects", async (req: AuthedRequest, res) => {
  try {
    const weekStartStr = req.query.week_start as string;
    const userId = (req.query.user_id as string) || req.userId!;
    if (!weekStartStr) {
      return res.status(400).json({ error: "week_start is required" });
    }
    if (!(await canActFor(req, userId))) {
      return res.status(403).json({ error: "Permission denied" });
    }
    const weekStart = TimesheetService.getWeekStart(weekStartStr);
    const projects = await TimesheetService.getProjectsForWeek(userId, weekStart);

    res.json(projects);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-TS-B02: Get entries for week (grouped by project+task/date, with totals per REQ-TS-B05)
r.get("/entries", requirePermission("timeEntries", "view"), async (req: AuthedRequest, res) => {
  try {
    const weekStartStr = req.query.week_start as string;
    const userId = (req.query.user_id as string) || req.userId!;
    if (!weekStartStr) {
      return res.status(400).json({ error: "week_start is required" });
    }
    if (!(await canActFor(req, userId))) {
      return res.status(403).json({ error: "Permission denied" });
    }

    const weekStart = TimesheetService.getWeekStart(weekStartStr);
    const entries = await TimesheetService.getEntriesForWeek(userId, weekStart);
    const totals = TimesheetService.calculateTotals(entries);

    res.json({ entries, totals });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-TS-B03: Create/update entry
const EntrySchema = z.object({
  projectId: z.string().min(1),
  taskId: z.string().nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  duration: z.string().regex(/^\d{1,2}:\d{2}$/),
  description: z.string().optional(),
  phase: z.enum(PHASES).nullable().optional(),
  userId: z.string().optional(),
  // Offset the browser is displaying in, so the entry starts at the user's
  // configured Day Start Time in their own timezone rather than the server's
  tzOffsetMinutes: z.number().int().min(-900).max(900).optional(),
});

r.post("/entries", requirePermission("timeEntries", "edit"), async (req: AuthedRequest, res) => {
  try {
    const body = EntrySchema.parse(req.body);
    const targetUserId = body.userId || req.userId!;

    // REQ-TS-B10: check permission when editing someone else's timesheet
    if (!(await canActFor(req, targetUserId))) {
      return res.status(403).json({ error: "Permission denied" });
    }

    const result = await TimesheetService.upsertEntry(
      targetUserId,
      body.projectId,
      body.taskId ?? null,
      body.date,
      body.duration,
      { description: body.description, phase: body.phase },
      await canBypassLock(req),
      body.tzOffsetMinutes
    );

    // REQ-TS-B11: Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.userId!,
        action: result.deleted ? "TIMESHEET_ENTRY_DELETE" : "TIMESHEET_ENTRY_UPSERT",
        target: result.entry?.id ?? null,
        metadata: {
          targetUserId,
          projectId: body.projectId,
          taskId: body.taskId ?? null,
          date: body.date,
          duration: body.duration,
        },
      },
    });

    res.json(result.entry);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "validation", details: error.flatten() });
    }
    res.status(500).json({ error: error.message });
  }
});

// I-A: update row-level phase/description for a project+task row of a week
const RowMetaSchema = z.object({
  week_start: z.string(),
  projectId: z.string().min(1),
  taskId: z.string().nullable().optional(),
  description: z.string().optional(),
  phase: z.enum(PHASES).nullable().optional(),
  userId: z.string().optional(),
  // The description the row currently carries, so the right row is updated
  currentDescription: z.string().optional(),
});

r.post("/row-meta", requirePermission("timeEntries", "edit"), async (req: AuthedRequest, res) => {
  try {
    const body = RowMetaSchema.parse(req.body);
    const targetUserId = body.userId || req.userId!;
    if (!(await canActFor(req, targetUserId))) {
      return res.status(403).json({ error: "Permission denied" });
    }
    const weekStart = TimesheetService.getWeekStart(body.week_start);
    const updated = await TimesheetService.updateRowMeta(
      targetUserId,
      weekStart,
      body.projectId,
      body.taskId ?? null,
      { description: body.description, phase: body.phase },
      await canBypassLock(req),
      body.currentDescription
    );
    res.json({ updated });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "validation", details: error.flatten() });
    }
    res.status(500).json({ error: error.message });
  }
});

// Re-assign a row's subtask (the chosen task can be edited later)
const RowTaskSchema = z.object({
  week_start: z.string(),
  projectId: z.string().min(1),
  fromTaskId: z.string().nullable().optional(),
  toTaskId: z.string().nullable().optional(),
  userId: z.string().optional(),
  description: z.string().optional(),
});

r.post("/row-task", requirePermission("timeEntries", "edit"), async (req: AuthedRequest, res) => {
  try {
    const body = RowTaskSchema.parse(req.body);
    const targetUserId = body.userId || req.userId!;
    if (!(await canActFor(req, targetUserId))) {
      return res.status(403).json({ error: "Permission denied" });
    }
    const weekStart = TimesheetService.getWeekStart(body.week_start);
    const updated = await TimesheetService.updateRowTask(
      targetUserId,
      weekStart,
      body.projectId,
      body.fromTaskId ?? null,
      body.toTaskId ?? null,
      await canBypassLock(req),
      body.description
    );
    await prisma.auditLog.create({
      data: {
        userId: req.userId!,
        action: "TIMESHEET_ROW_TASK",
        metadata: {
          targetUserId,
          projectId: body.projectId,
          fromTaskId: body.fromTaskId ?? null,
          toTaskId: body.toTaskId ?? null,
          weekStart: body.week_start,
          updated,
        },
      },
    });
    res.json({ updated });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "validation", details: error.flatten() });
    }
    res.status(400).json({ error: error.message });
  }
});

// B12: remove an entire row (all entries for a project+task in the week)
const RowDeleteSchema = z.object({
  week_start: z.string(),
  projectId: z.string().min(1),
  taskId: z.string().nullable().optional(),
  userId: z.string().optional(),
  description: z.string().optional(),
});

r.delete("/rows", requirePermission("timeEntries", "delete"), async (req: AuthedRequest, res) => {
  try {
    const body = RowDeleteSchema.parse({
      week_start: req.query.week_start,
      projectId: req.query.projectId,
      taskId: (req.query.taskId as string) || null,
      userId: (req.query.user_id as string) || undefined,
    });
    const targetUserId = body.userId || req.userId!;
    if (!(await canActFor(req, targetUserId))) {
      return res.status(403).json({ error: "Permission denied" });
    }
    const weekStart = TimesheetService.getWeekStart(body.week_start);
    const deleted = await TimesheetService.deleteRow(
      targetUserId,
      weekStart,
      body.projectId,
      body.taskId ?? null,
      await canBypassLock(req),
      body.description
    );

    await prisma.auditLog.create({
      data: {
        userId: req.userId!,
        action: "TIMESHEET_ROW_DELETE",
        metadata: {
          targetUserId,
          projectId: body.projectId,
          taskId: body.taskId ?? null,
          weekStart: body.week_start,
          deleted,
        },
      },
    });

    res.json({ deleted });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "validation", details: error.flatten() });
    }
    res.status(500).json({ error: error.message });
  }
});

// REQ-TS-B06: Get time-off for week
r.get("/time-off", async (req: AuthedRequest, res) => {
  try {
    const weekStartStr = req.query.week_start as string;
    if (!weekStartStr) {
      return res.status(400).json({ error: "week_start is required" });
    }
    const weekStart = TimesheetService.getWeekStart(weekStartStr);
    const timeOff = await TimesheetService.getTimeOffForWeek(
      req.userId!,
      weekStart
    );

    res.json(timeOff);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-TS-B07: Copy last week
r.post("/copy-last-week", requirePermission("timeEntries", "create"), async (req: AuthedRequest, res) => {
  try {
    const weekStartStr = req.body.week_start as string;
    if (!weekStartStr) {
      return res.status(400).json({ error: "week_start is required" });
    }
    const weekStart = TimesheetService.getWeekStart(weekStartStr);
    const entries = await TimesheetService.copyLastWeek(
      req.userId!,
      weekStart,
      await canBypassLock(req)
    );

    // REQ-TS-B11: Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.userId!,
        action: "TIMESHEET_COPY_LAST_WEEK",
        metadata: { weekStart: weekStartStr, copied: entries.length },
      },
    });

    res.json({ copied: entries.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-TS-B08 / B13: Save as template (optionally including times)
const TemplateSchema = z.object({
  week_start: z.string(),
  name: z.string().min(1),
  includeTimes: z.boolean().optional(),
});

r.post("/templates", async (req: AuthedRequest, res) => {
  try {
    const body = TemplateSchema.parse(req.body);
    const weekStart = TimesheetService.getWeekStart(body.week_start);
    const template = await TimesheetService.saveAsTemplate(
      req.userId!,
      weekStart,
      body.name,
      body.includeTimes ?? false
    );

    res.status(201).json(template);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "validation", details: error.flatten() });
    }
    res.status(500).json({ error: error.message });
  }
});

r.get("/templates", async (req: AuthedRequest, res) => {
  try {
    const templates = await TimesheetService.getTemplates(req.userId!);
    res.json(templates);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// B13: apply a template to a week
r.post("/templates/:id/apply", async (req: AuthedRequest, res) => {
  try {
    const weekStartStr = req.body.week_start as string;
    if (!weekStartStr) {
      return res.status(400).json({ error: "week_start is required" });
    }
    const weekStart = TimesheetService.getWeekStart(weekStartStr);
    const result = await TimesheetService.applyTemplate(
      req.userId!,
      req.params.id,
      weekStart,
      await canBypassLock(req),
      typeof req.body.tzOffsetMinutes === "number" ? req.body.tzOffsetMinutes : undefined
    );

    await prisma.auditLog.create({
      data: {
        userId: req.userId!,
        action: "TIMESHEET_TEMPLATE_APPLY",
        target: req.params.id,
        metadata: { weekStart: weekStartStr, applied: result.applied },
      },
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// B13: remove a template
r.delete("/templates/:id", async (req: AuthedRequest, res) => {
  try {
    await TimesheetService.deleteTemplate(req.userId!, req.params.id);
    res.status(204).end();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-TS-B09: Submit timesheet
r.post("/submit", async (req: AuthedRequest, res) => {
  try {
    const weekStartStr = req.body.week_start as string;
    if (!weekStartStr) {
      return res.status(400).json({ error: "week_start is required" });
    }
    const weekStart = TimesheetService.getWeekStart(weekStartStr);
    const timesheet = await TimesheetService.submitTimesheet(
      req.userId!,
      weekStart
    );

    res.json(timesheet);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// I5: admin-only — reopen a submitted timesheet (own or another user's)
r.post("/reopen", async (req: AuthedRequest, res) => {
  try {
    const weekStartStr = req.body.week_start as string;
    const targetUserId = (req.body.user_id as string) || req.userId!;
    if (!weekStartStr) {
      return res.status(400).json({ error: "week_start is required" });
    }
    if (!(await canBypassLock(req))) {
      return res.status(403).json({ error: "Permission denied" });
    }
    const weekStart = TimesheetService.getWeekStart(weekStartStr);
    const timesheet = await TimesheetService.reopenTimesheet(targetUserId, weekStart);

    await prisma.auditLog.create({
      data: {
        userId: req.userId!,
        action: "TIMESHEET_REOPEN",
        target: timesheet.id,
        metadata: { targetUserId, weekStart: weekStartStr },
      },
    });

    res.json(timesheet);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get timesheet status (?user_id: admins may check another user's week)
r.get("/status", async (req: AuthedRequest, res) => {
  try {
    const weekStartStr = req.query.week_start as string;
    const userId = (req.query.user_id as string) || req.userId!;
    if (!weekStartStr) {
      return res.status(400).json({ error: "week_start is required" });
    }
    if (!(await canActFor(req, userId))) {
      return res.status(403).json({ error: "Permission denied" });
    }
    const weekStart = TimesheetService.getWeekStart(weekStartStr);
    const status = await TimesheetService.getTimesheetStatus(userId, weekStart);

    res.json({ status });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default r;
