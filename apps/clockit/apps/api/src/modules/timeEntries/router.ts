import { Router } from "express";
import { z } from "zod";
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
} from "date-fns";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthedRequest } from "../../middleware/auth";
import { requireFeature } from "../../middleware/featureGate";
import { requirePermission } from "../../middleware/permissions";
import { saveValues, valuesForRecords } from "../customFields/service";
import { getWorkspaceSettings, weekStartsOn } from "../../lib/workspaceSettings";
import { zonedPeriod, Zone } from "../../lib/zonedTime";

const r = Router();
r.use(requireAuth);
// Turning Time Tracker off in Workspace Settings removes it for everyone,
// including direct API calls.
r.use(requireFeature("timeTracker"));

const MAX_PAGE_SIZE = 100; // REQ-TT-B16
const FAR_FUTURE = new Date("9999-12-31T00:00:00.000Z");

const CreateSchema = z.object({
  description: z.string().optional(),
  projectId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  start: z.string().datetime(),
  end: z.string().datetime().optional(),
  durationSeconds: z.number().int().positive().optional(),
  billable: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  customFields: z.record(z.any()).optional(),
});

const PatchSchema = z.object({
  description: z.string().optional(),
  projectId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  start: z.string().datetime().optional(),
  end: z.string().datetime().nullable().optional(),
  billable: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  // When moving an entry onto a date that already has entries, shift it after
  // them so it is added alongside instead of failing with an overlap error.
  resolveOverlap: z.boolean().optional(),
  customFields: z.record(z.any()).optional(),
});

const StartSchema = z.object({
  description: z.string().optional(),
  projectId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  billable: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  customFields: z.record(z.any()).optional(),
});

// REQ-TT-B13: audit logging for create/update/delete
async function audit(userId: string, action: string, target: string, metadata: Record<string, unknown> = {}) {
  await prisma.auditLog.create({ data: { userId, action, target, metadata: metadata as any } });
}

const ELEVATED = ["ADMIN", "OWNER"];

async function roleOf(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user?.role ?? "MEMBER";
}

/**
 * I6/I7: what may the requester do with this entry?
 * - own entry: full access
 * - admin/owner on a non-admin member's entry: full access
 * - admin/owner on ANOTHER admin's entry: may only toggle billable (I6)
 * - everyone else: no access
 */
async function entryAccess(
  requesterId: string,
  entry: { userId: string }
): Promise<"full" | "billable-only" | "none"> {
  if (entry.userId === requesterId) return "full";
  const [requester, owner] = await Promise.all([
    prisma.user.findUnique({ where: { id: requesterId } }),
    prisma.user.findUnique({ where: { id: entry.userId } }),
  ]);
  if (!requester || !ELEVATED.includes(requester.role)) return "none";
  if (owner && ELEVATED.includes(owner.role)) return "billable-only";
  return "full";
}

// REQ-TT-B10: overlap detection (a running entry is treated as open-ended)
async function findOverlap(userId: string, start: Date, end: Date | null, excludeId?: string) {
  return prisma.timeEntry.findFirst({
    where: {
      userId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      start: { lt: end ?? FAR_FUTURE },
      OR: [{ end: null }, { end: { gt: start } }],
    },
  });
}

/**
 * Find a free slot of `durationMs` at/after `preferred`, **without leaving the
 * window** [`windowStart`, `windowEnd`].
 *
 * A duplicate belongs on the day it was copied from. Letting the search run past
 * midnight would silently scatter copies onto later days — including days the
 * workspace does not even work — so a day that is genuinely full returns null
 * and the caller asks the user to pick a time instead.
 */
async function findFreeSlot(
  userId: string,
  preferred: Date,
  durationMs: number,
  windowStart: Date,
  windowEnd: Date,
  excludeId?: string
): Promise<{ start: Date; end: Date | null } | null> {
  const fits = (from: Date) =>
    from >= windowStart && new Date(from.getTime() + durationMs) <= windowEnd;

  let start = new Date(preferred);
  let backwards = false;
  for (let i = 0; i < 50; i++) {
    if (durationMs > 0 && !fits(start)) {
      // Ran out of room going forward — try the space before the original
      if (backwards) return null;
      backwards = true;
      start = new Date(preferred.getTime() - durationMs);
      if (!fits(start)) return null;
    }
    const end = durationMs > 0 ? new Date(start.getTime() + durationMs) : null;
    const conflict = await findOverlap(userId, start, end, excludeId);
    if (!conflict) return { start, end };
    if (durationMs <= 0) return null; // an open-ended entry needs empty space after it
    if (!conflict.end || backwards) {
      // Running entry (or already searching backwards): finish just before it starts
      backwards = true;
      start = new Date(conflict.start.getTime() - durationMs);
      if (!fits(start)) return null;
    } else {
      start = new Date(conflict.end.getTime());
    }
  }
  return null;
}

function durationSeconds(entry: { start: Date; end: Date | null }) {
  if (!entry.end) return null;
  return Math.max(0, Math.round((entry.end.getTime() - entry.start.getTime()) / 1000));
}

// REQ-TT-B09: billable amount from project hourly rate
function serialize(entry: any) {
  const secs = durationSeconds(entry);
  const rate = entry.project?.hourlyRate ? Number(entry.project.hourlyRate) : null;
  const billableAmount = entry.billable && rate && secs ? Math.round((secs / 3600) * rate * 100) / 100 : null;
  return { ...entry, durationSeconds: secs, billableAmount };
}

/**
 * REQ-TT-B08: the overtime window for a date — the period the total is measured
 * over and the hours allowed within it. Both come from Workspace Settings, so a
 * change to Daily work capacity or Overtime calculation period takes effect on
 * the next read with no back-fill.
 */
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function overtimeWindow(settings: any, date: Date, timeZone: Zone) {
  const capacityHours = settings.dailyWorkCapacity;
  const unit =
    settings.overtimePeriod === "weekly" ? "week" : settings.overtimePeriod === "monthly" ? "month" : "day";
  // Boundaries in the user's own timezone: the day they see in the tracker must
  // be the day the total is measured over, or an evening entry lands in the
  // wrong day and the total never reaches capacity.
  const period = zonedPeriod(timeZone, date, unit, weekStartsOn(settings));

  let thresholdHours = capacityHours;
  if (unit !== "day") {
    // Only configured working days carry capacity
    const workingDays = period.days.filter((d: { weekday: number }) =>
      settings.workingDays.includes(WEEKDAY_NAMES[d.weekday])
    ).length;
    thresholdHours = capacityHours * Math.max(1, workingDays);
  }
  return { from: period.from, to: period.to, thresholdHours };
}

/**
 * Overtime is derived at read time, never stored: a stored flag goes stale the
 * moment an entry is edited, shortened or deleted. Within each period the
 * entries are walked in chronological order and the ones that carry the running
 * total past the threshold are the overtime ones — so reducing the day's total
 * back under capacity clears the badge on its own.
 */
async function overtimeIds(
  entries: any[],
  settings: any,
  clientOffsetMinutes?: number
): Promise<Set<string>> {
  const flagged = new Set<string>();
  if (settings.overtimePeriod === "none" || entries.length === 0) return flagged;

  // Each person's periods are measured in their own timezone. A profile that
  // still holds the default UTC tells us nothing, so the offset the browser is
  // actually displaying in wins there — that is the day grouping on screen.
  const userIdsInPage = [...new Set(entries.map((e: any) => e.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIdsInPage } },
    select: { id: true, timezone: true },
  });
  const zoneOf = new Map<string, string | number>(
    users.map((u) => {
      const configured = u.timezone && u.timezone !== "UTC" ? u.timezone : null;
      if (configured) return [u.id, configured];
      return [u.id, typeof clientOffsetMinutes === "number" ? clientOffsetMinutes : "UTC"];
    })
  );

  // One period bucket per (user, window); every entry in the window is needed,
  // not just the ones on this page, or the totals would be short.
  const buckets = new Map<string, { userId: string; from: Date; to: Date; thresholdHours: number }>();
  for (const e of entries) {
    if (!e.end) continue;
    const w = overtimeWindow(settings, e.start, zoneOf.get(e.userId) ?? "UTC");
    buckets.set(`${e.userId}|${w.from.toISOString()}`, { userId: e.userId, ...w });
  }
  if (buckets.size === 0) return flagged;

  const userIds = [...new Set([...buckets.values()].map((b) => b.userId))];
  const from = new Date(Math.min(...[...buckets.values()].map((b) => b.from.getTime())));
  const to = new Date(Math.max(...[...buckets.values()].map((b) => b.to.getTime())));
  const periodEntries = await prisma.timeEntry.findMany({
    where: { userId: { in: userIds }, start: { gte: from, lte: to }, end: { not: null } },
    select: { id: true, userId: true, start: true, end: true },
    orderBy: { start: "asc" },
  });

  for (const bucket of buckets.values()) {
    const mine = periodEntries.filter(
      (e) => e.userId === bucket.userId && e.start >= bucket.from && e.start <= bucket.to
    );
    let running = 0;
    const limit = bucket.thresholdHours * 3600;
    for (const e of mine) {
      running += durationSeconds(e) ?? 0;
      if (running > limit) flagged.add(e.id);
    }
  }
  return flagged;
}

/** Attach the derived `overtime` flag to a batch of serialized entries. */
async function withOvertime(items: any[], clientOffsetMinutes?: number) {
  const settings = await getWorkspaceSettings();
  const flagged = await overtimeIds(items, settings, clientOffsetMinutes);
  return items.map((e: any) => ({ ...e, overtime: flagged.has(e.id) }));
}

// REQ-TT-B12: expose the running timer so the client can resume after refresh
r.get("/running", requirePermission("timeEntries", "view"), async (req: AuthedRequest, res) => {
  const running = await prisma.timeEntry.findFirst({
    where: { userId: req.userId!, end: null },
    include: { project: true, task: true },
  });
  res.json(running ? serialize(running) : null);
});

// REQ-TT-B01: start timer
r.post("/start", requirePermission("timeEntries", "create"), async (req: AuthedRequest, res) => {
  const body = StartSchema.parse(req.body);
  const running = await prisma.timeEntry.findFirst({ where: { userId: req.userId!, end: null } });
  if (running) {
    await prisma.timeEntry.update({ where: { id: running.id }, data: { end: new Date() } });
  }
  const entry = await prisma.timeEntry.create({
    data: {
      userId: req.userId!,
      description: body.description ?? "",
      projectId: body.projectId ?? null,
      taskId: body.taskId ?? null,
      start: new Date(),
      billable: body.billable ?? false,
      tags: body.tags ?? [],
    },
    include: { project: true, task: true },
  });
  if (body.customFields) {
    await saveValues("timeEntry", entry.id, body.customFields, await roleOf(req.userId!));
  }
  await audit(req.userId!, "time_entry.start", entry.id, { description: entry.description });
  res.status(201).json(serialize(entry));
});

// REQ-TT-B02: stop timer
r.post("/stop", requirePermission("timeEntries", "edit"), async (req: AuthedRequest, res) => {
  const running = await prisma.timeEntry.findFirst({ where: { userId: req.userId!, end: null } });
  if (!running) return res.status(404).json({ error: "no_running_timer" });
  await prisma.timeEntry.update({ where: { id: running.id }, data: { end: new Date() } });
  const updated = await prisma.timeEntry.findUnique({ where: { id: running.id }, include: { project: true, task: true } });
  await audit(req.userId!, "time_entry.stop", running.id, { durationSeconds: durationSeconds(updated!) });
  res.json(serialize(updated));
});

// REQ-TT-B03: manual entry (explicit start + end or duration)
r.post("/", requirePermission("timeEntries", "create"), async (req: AuthedRequest, res) => {
  const body = CreateSchema.parse(req.body);
  const start = new Date(body.start);
  let end: Date | null = body.end ? new Date(body.end) : null;
  if (!end && body.durationSeconds) end = new Date(start.getTime() + body.durationSeconds * 1000);
  if (!end) return res.status(400).json({ error: "end_or_duration_required" });
  if (end <= start) return res.status(400).json({ error: "end_before_start" });
  const overlap = await findOverlap(req.userId!, start, end);
  if (overlap) return res.status(409).json({ error: "overlap", conflictingEntryId: overlap.id });
  const entry = await prisma.timeEntry.create({
    data: {
      userId: req.userId!,
      description: body.description ?? "",
      projectId: body.projectId ?? null,
      taskId: body.taskId ?? null,
      start,
      end,
      billable: body.billable ?? false,
      tags: body.tags ?? [],
    },
    include: { project: true, task: true },
  });
  // Custom field values are validated before the entry is considered saved;
  // a rejection removes the entry so nothing half-valid is left behind.
  const cf = await saveValues("timeEntry", entry.id, body.customFields ?? {}, await roleOf(req.userId!), {
    enforceRequired: true,
  });
  if (!cf.ok) {
    await prisma.timeEntry.delete({ where: { id: entry.id } });
    return res.status(400).json({ error: "custom_field_validation", errors: cf.errors });
  }
  await audit(req.userId!, "time_entry.create", entry.id, { description: entry.description });
  const fresh = await prisma.timeEntry.findUnique({ where: { id: entry.id }, include: { project: true, task: true } });
  res.status(201).json(serialize(fresh));
});

// REQ-TT-B04/B14/B15/B16/B17: paginated list with totals, stable most-recent-first order.
// Admins/owners may pass user_id to view (and edit, per entryAccess) a member's entries.
r.get("/", requirePermission("timeEntries", "view"), async (req: AuthedRequest, res) => {
  const startDate = req.query.start_date as string | undefined;
  const endDate = req.query.end_date as string | undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(Math.max(1, Number(req.query.page_size) || 50), MAX_PAGE_SIZE);
  let viewUserId = req.userId!;
  let access: "full" | "billable-only" = "full";
  const requestedUserId = req.query.user_id as string | undefined;
  if (requestedUserId && requestedUserId !== req.userId) {
    const [requester, target] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId! } }),
      prisma.user.findUnique({ where: { id: requestedUserId } }),
    ]);
    if (!requester || !ELEVATED.includes(requester.role)) {
      return res.status(403).json({ error: "insufficient_permissions" });
    }
    if (!target) return res.status(404).json({ error: "user_not_found" });
    viewUserId = target.id;
    access = ELEVATED.includes(target.role) ? "billable-only" : "full";
  }
  const where = {
    userId: viewUserId,
    ...(startDate || endDate
      ? {
          start: {
            ...(startDate ? { gte: new Date(startDate) } : {}),
            ...(endDate ? { lte: endOfDay(new Date(endDate)) } : {}),
          },
        }
      : {}),
  };
  const now = new Date();
  const workspaceWeekStart = weekStartsOn(await getWorkspaceSettings());
  const [items, total, weekEntries] = await Promise.all([
    prisma.timeEntry.findMany({
      where,
      orderBy: [{ start: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { project: true, task: true },
    }),
    prisma.timeEntry.count({ where }),
    prisma.timeEntry.findMany({
      where: {
        userId: viewUserId,
        start: {
          gte: startOfWeek(now, { weekStartsOn: workspaceWeekStart }),
          lte: endOfWeek(now, { weekStartsOn: workspaceWeekStart }),
        },
      },
    }),
  ]);
  // REQ-TT-B04: per-week total (running entry counts up to "now")
  const weekTotalSeconds = weekEntries.reduce(
    (sum: number, e: any) => sum + Math.max(0, Math.round(((e.end ?? now).getTime() - e.start.getTime()) / 1000)),
    0
  );
  // Attach custom field values so the tracker can show and edit them
  const cfValues = await valuesForRecords("timeEntry", items.map((e: any) => e.id), await roleOf(req.userId!));
  // Overtime is recomputed on every read from the current totals and the
  // current workspace settings, so edits and deletions are reflected at once
  const tzOffset = Number(req.query.tzOffsetMinutes);
  const withFlags = await withOvertime(
    items.map((e: any) => ({ ...serialize(e), customFields: cfValues.get(e.id) ?? {} })),
    Number.isFinite(tzOffset) ? tzOffset : undefined
  );
  res.json({ items: withFlags, total, page, pageSize, weekTotalSeconds, access });
});

// REQ-TT-B05: edit entry (I6/I7: admins may edit non-admin members' entries;
// billable is editable by admins on any entry)
r.patch("/:id", requirePermission("timeEntries", "edit"), async (req: AuthedRequest, res) => {
  const body = PatchSchema.parse(req.body);
  const entry = await prisma.timeEntry.findUnique({ where: { id: req.params.id } });
  if (!entry) return res.status(404).json({ error: "not_found" });
  const access = await entryAccess(req.userId!, entry);
  if (access === "none") return res.status(404).json({ error: "not_found" });
  if (access === "billable-only") {
    const keys = Object.keys(body).filter((k) => k !== "resolveOverlap");
    if (keys.length !== 1 || keys[0] !== "billable") {
      return res.status(403).json({ error: "admin_entries_billable_only" });
    }
  }
  let newStart = body.start ? new Date(body.start) : entry.start;
  let newEnd = body.end === null ? null : body.end ? new Date(body.end) : entry.end;
  if (newEnd && newEnd <= newStart) return res.status(400).json({ error: "end_before_start" });
  if (body.start !== undefined || body.end !== undefined) {
    let overlap = await findOverlap(entry.userId, newStart, newEnd, entry.id);
    if (overlap && body.resolveOverlap && newEnd) {
      // Keep the moved entry as a separate entry: shift it to just after the
      // entries already occupying the target slot (duration preserved).
      const duration = newEnd.getTime() - newStart.getTime();
      for (let i = 0; overlap && i < 50; i++) {
        if (!overlap.end) return res.status(409).json({ error: "overlap", conflictingEntryId: overlap.id });
        newStart = new Date(overlap.end.getTime());
        newEnd = new Date(newStart.getTime() + duration);
        overlap = await findOverlap(entry.userId, newStart, newEnd, entry.id);
      }
    }
    if (overlap) return res.status(409).json({ error: "overlap", conflictingEntryId: overlap.id });
  }
  await prisma.timeEntry.update({
    where: { id: entry.id },
    data: {
      description: body.description,
      projectId: body.projectId === undefined ? undefined : body.projectId,
      taskId: body.taskId === undefined ? undefined : body.taskId,
      start: body.start ? newStart : undefined,
      end: body.end === undefined ? undefined : newEnd,
      billable: body.billable,
      tags: body.tags,
    },
  });
  if (body.customFields) {
    const cf = await saveValues("timeEntry", entry.id, body.customFields, await roleOf(req.userId!));
    if (!cf.ok) return res.status(400).json({ error: "custom_field_validation", errors: cf.errors });
  }
  await audit(req.userId!, "time_entry.update", entry.id, { fields: Object.keys(body), ownerId: entry.userId });
  const updated = await prisma.timeEntry.findUnique({ where: { id: entry.id }, include: { project: true, task: true } });
  res.json(serialize(updated));
});

// REQ-TT-B06: delete entry (I7: admins may delete non-admin members' entries)
r.delete("/:id", requirePermission("timeEntries", "delete"), async (req: AuthedRequest, res) => {
  const entry = await prisma.timeEntry.findUnique({ where: { id: req.params.id } });
  if (!entry) return res.status(404).json({ error: "not_found" });
  const access = await entryAccess(req.userId!, entry);
  if (access !== "full") return res.status(access === "none" ? 404 : 403).json({ error: access === "none" ? "not_found" : "admin_entries_billable_only" });
  await prisma.timeEntry.delete({ where: { id: entry.id } });
  await audit(req.userId!, "time_entry.delete", entry.id, { description: entry.description, ownerId: entry.userId });
  res.status(204).end();
});

// REQ-TT-B07: duplicate entry (same description/project/tags). The copy is
// placed at the first free slot at/around "now" so a busy clock does not make
// duplication fail; overlap validation still rejects genuinely impossible cases.
r.post("/:id/duplicate", requirePermission("timeEntries", "create"), async (req: AuthedRequest, res) => {
  const entry = await prisma.timeEntry.findUnique({ where: { id: req.params.id } });
  if (!entry) return res.status(404).json({ error: "not_found" });
  const access = await entryAccess(req.userId!, entry);
  if (access !== "full") {
    return res.status(access === "none" ? 404 : 403).json({
      error: access === "none" ? "not_found" : "admin_entries_billable_only",
    });
  }
  const secs = durationSeconds(entry) ?? 0;
  // The copy belongs on the same day as the original, starting where it ended.
  // Confining the search to that day stops duplicates landing on unrelated
  // (and possibly non-working) days.
  const dayStart = startOfDay(entry.start);
  const dayEnd = endOfDay(entry.start);
  const preferred = entry.end ?? entry.start;
  const slot = await findFreeSlot(entry.userId, preferred, secs * 1000, dayStart, dayEnd);
  if (!slot) {
    return res.status(409).json({
      error: "no_free_slot_that_day",
      message:
        "There is no free time left on that day for a copy of this entry. Adjust the time and try again.",
    });
  }
  const copy = await prisma.timeEntry.create({
    data: {
      userId: entry.userId,
      description: entry.description,
      projectId: entry.projectId,
      taskId: entry.taskId,
      start: slot.start,
      end: slot.end,
      billable: entry.billable,
      tags: entry.tags.filter((t: string) => t !== "Overtime"),
    },
    include: { project: true, task: true },
  });
  await audit(req.userId!, "time_entry.duplicate", copy.id, { sourceId: entry.id, ownerId: entry.userId });
  res.status(201).json(serialize(copy));
});

// REQ-TT-F12 backend support: split an entry into two halves at its midpoint
r.post("/:id/split", requirePermission("timeEntries", "edit"), async (req: AuthedRequest, res) => {
  const entry = await prisma.timeEntry.findUnique({ where: { id: req.params.id } });
  if (!entry) return res.status(404).json({ error: "not_found" });
  const splitAccess = await entryAccess(req.userId!, entry);
  if (splitAccess !== "full") {
    return res.status(splitAccess === "none" ? 404 : 403).json({
      error: splitAccess === "none" ? "not_found" : "admin_entries_billable_only",
    });
  }
  if (!entry.end) return res.status(400).json({ error: "cannot_split_running" });
  const mid = new Date((entry.start.getTime() + entry.end.getTime()) / 2);
  if (mid <= entry.start || mid >= entry.end) return res.status(400).json({ error: "entry_too_short" });
  const [first, second] = await prisma.$transaction([
    prisma.timeEntry.update({ where: { id: entry.id }, data: { end: mid }, include: { project: true, task: true } }),
    prisma.timeEntry.create({
      data: {
        userId: entry.userId,
        description: entry.description,
        projectId: entry.projectId,
        taskId: entry.taskId,
        start: mid,
        end: entry.end,
        billable: entry.billable,
        tags: entry.tags,
      },
      include: { project: true, task: true },
    }),
  ]);
  await audit(req.userId!, "time_entry.split", entry.id, { newEntryId: second.id });
  res.json({ first: serialize(first), second: serialize(second) });
});

export default r;
