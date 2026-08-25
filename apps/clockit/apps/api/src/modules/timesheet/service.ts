import { prisma } from "../../lib/prisma";
import { addDays, startOfWeek, endOfWeek, parseISO, format } from "date-fns";

const MAX_MINUTES_PER_DAY = 24 * 60; // REQ-TS-B04: configurable daily maximum

// Sentinel used by the web client for the "no project" timesheet row (B1):
// tracker entries started without a project still belong to the week.
export const NO_PROJECT = "__none__";

export const PHASES = [
  "Management",
  "Requirement",
  "Design",
  "Code",
  "Test",
  "Release",
  "Others",
] as const;

export interface TimesheetRowMeta {
  phase?: string | null;
  description?: string;
}

export interface TimesheetRow {
  projectId: string; // real id or NO_PROJECT sentinel
  taskId: string | null;
  projectName: string;
  projectColor: string;
  clientName: string | null;
  taskName: string | null;
  phase: string | null;
  description: string;
  entries: Record<string, string>; // date -> duration (H:MM)
  total: number; // total minutes
}

export class TimesheetService {
  /**
   * Parse duration string (HH:MM) to minutes
   */
  static parseDuration(duration: string): number {
    const match = duration.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) throw new Error("Invalid duration format. Use HH:MM");
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (hours < 0 || minutes < 0 || minutes >= 60) {
      throw new Error("Invalid duration values");
    }
    return hours * 60 + minutes;
  }

  /**
   * Format minutes to HH:MM string
   */
  static formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${String(mins).padStart(2, "0")}`;
  }

  /**
   * Validate duration is non-negative and within the daily max (REQ-TS-B04)
   */
  static validateDuration(duration: string): void {
    const minutes = this.parseDuration(duration);
    if (minutes < 0) throw new Error("Duration cannot be negative");
    if (minutes > MAX_MINUTES_PER_DAY) {
      throw new Error("Duration cannot exceed 24 hours");
    }
  }

  /**
   * Get week start date (Monday)
   */
  static getWeekStart(date: Date | string): Date {
    const d = typeof date === "string" ? parseISO(date) : date;
    return startOfWeek(d, { weekStartsOn: 1 }); // Monday
  }

  /**
   * Get week end date (Sunday)
   */
  static getWeekEnd(date: Date | string): Date {
    const d = typeof date === "string" ? parseISO(date) : date;
    return endOfWeek(d, { weekStartsOn: 1 });
  }

  /**
   * Normalize a local week-start Date to a date-only value for the
   * Timesheet.weekStart @db.Date column. Uses the local calendar date so
   * timezones ahead of UTC don't shift the week back a day.
   */
  static toDateOnly(date: Date): Date {
    return new Date(format(date, "yyyy-MM-dd"));
  }

  /** True when the user may bypass the submitted-timesheet lock (I5). */
  static async canBypassLock(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    return !!user && (user.role === "ADMIN" || user.role === "OWNER");
  }

  /**
   * The user's configured Day Start Time (Preferences → General, "HH:mm").
   * Entries created from the timesheet start here rather than at "now", so the
   * tracker shows them beginning at the individual's start of the working day.
   */
  static async getDayStart(userId: string): Promise<{ hours: number; minutes: number }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const match = /^(\d{1,2}):(\d{2})$/.exec(user?.dayStart ?? "");
    if (!match) return { hours: 9, minutes: 0 };
    const hours = Math.min(23, Math.max(0, Number(match[1])));
    const minutes = Math.min(59, Math.max(0, Number(match[2])));
    return { hours, minutes };
  }

  /** Minutes to add to a wall-clock time in `timeZone` to get UTC. */
  private static zoneOffsetMinutes(timeZone: string, instant: Date): number {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
        .formatToParts(instant)
        .reduce((acc: Record<string, string>, part) => {
          acc[part.type] = part.value;
          return acc;
        }, {});
      const wall = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour) % 24,
        Number(parts.minute),
        Number(parts.second)
      );
      return (instant.getTime() - wall) / 60000;
    } catch {
      return 0;
    }
  }

  /**
   * The instant at which `hours:minutes` occurs on `date` for this user.
   *
   * The API container runs in UTC while the browser shows local time, so
   * building the timestamp from the server clock made entries appear shifted
   * by the timezone offset. The client sends the offset it is displaying in;
   * otherwise the user's configured timezone is used.
   */
  private static async wallClockInstant(
    userId: string,
    date: string,
    hours: number,
    minutes: number,
    tzOffsetMinutes?: number
  ): Promise<Date> {
    const [year, month, day] = date.split("-").map(Number);
    const asUtc = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);
    if (typeof tzOffsetMinutes === "number" && Number.isFinite(tzOffsetMinutes)) {
      return new Date(asUtc + tzOffsetMinutes * 60000);
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const timeZone = user?.timezone || "UTC";
    // Two passes settle DST boundaries
    let instant = new Date(asUtc);
    for (let i = 0; i < 2; i++) {
      instant = new Date(asUtc + this.zoneOffsetMinutes(timeZone, instant) * 60000);
    }
    return instant;
  }

  /**
   * Get projects assigned to user for a given week (REQ-TS-B01)
   */
  static async getProjectsForWeek(userId: string, weekStart: Date) {
    const weekEnd = this.getWeekEnd(weekStart);

    // Get all projects user is a member of
    const projectMembers = await prisma.projectMember.findMany({
      where: { userId },
      select: { projectId: true },
    });

    // Get projects from time entries in this week
    const timeEntries = await prisma.timeEntry.findMany({
      where: {
        userId,
        start: { gte: weekStart, lte: weekEnd },
        projectId: { not: null },
      },
      select: { projectId: true },
      distinct: ["projectId"],
    });

    const projectIds = new Set<string>();
    projectMembers.forEach((pm: { projectId: string }) => projectIds.add(pm.projectId));
    timeEntries.forEach(
      (te: { projectId: string | null }) => te.projectId && projectIds.add(te.projectId)
    );

    const projects = await prisma.project.findMany({
      where: { id: { in: Array.from(projectIds) }, status: "ACTIVE" },
      include: { client: true, tasks: { where: { status: "active" }, orderBy: { name: "asc" } } },
      orderBy: { name: "asc" },
    });

    return projects;
  }

  /**
   * Row key: projectId (or NO_PROJECT sentinel) + taskId + description.
   *
   * Description is part of the identity because it is what distinguishes two
   * lines of work on the same project and task. Without it, changing one day's
   * description in the Time Tracker left that entry in the original row and the
   * row simply showed whichever description was written last.
   */
  private static rowKey(projectId: string | null, taskId: string | null, description?: string | null) {
    return `${projectId ?? NO_PROJECT}::${taskId ?? ""}::${description ?? ""}`;
  }

  /**
   * Get time entries for a week grouped by project+task and date (REQ-TS-B02).
   * B1: entries without a project (e.g. started from the tracker) are grouped
   * under a "No project" row instead of being dropped.
   */
  static async getEntriesForWeek(userId: string, weekStart: Date) {
    const weekEnd = this.getWeekEnd(weekStart);
    const entries = await prisma.timeEntry.findMany({
      where: {
        userId,
        start: { gte: weekStart, lte: weekEnd },
        end: { not: null }, // running entries are not part of the timesheet yet
      },
      include: { project: { include: { client: true } }, task: true },
      orderBy: { start: "asc" },
    });

    const rows = new Map<string, TimesheetRow>();
    const minutesByRowDate = new Map<string, Record<string, number>>();

    for (const entry of entries) {
      if (!entry.end) continue;
      const key = this.rowKey(entry.projectId, entry.taskId, entry.description);
      const date = format(entry.start, "yyyy-MM-dd");
      // Short tracker entries (< 30s) must still show up — round to the
      // nearest minute but never down to 0 for a non-empty entry.
      const durationMs = entry.end.getTime() - entry.start.getTime();
      const durationMinutes = durationMs > 0 ? Math.max(1, Math.round(durationMs / 60000)) : 0;

      if (!rows.has(key)) {
        rows.set(key, {
          projectId: entry.projectId ?? NO_PROJECT,
          taskId: entry.taskId,
          projectName: entry.project?.name ?? "No project",
          projectColor: entry.project?.color ?? "#94a3b8",
          clientName: entry.project?.client?.name ?? null,
          taskName: entry.task?.name ?? null,
          phase: null,
          // Fixed for the row — it is part of the row's identity
          description: entry.description ?? "",
          entries: {},
          total: 0,
        });
        minutesByRowDate.set(key, {});
      }
      const row = rows.get(key)!;
      // Phase is still row-level metadata: the latest non-empty value wins (I-A)
      if (entry.phase) row.phase = entry.phase;

      const byDate = minutesByRowDate.get(key)!;
      byDate[date] = (byDate[date] ?? 0) + durationMinutes;
    }

    const result = Array.from(rows.entries()).map(([key, row]) => {
      const byDate = minutesByRowDate.get(key)!;
      let total = 0;
      Object.entries(byDate).forEach(([date, minutes]) => {
        row.entries[date] = this.formatDuration(minutes);
        total += minutes;
      });
      row.total = total;
      return row;
    });

    // Stable order: project name, then task name, "No project" last
    result.sort((a, b) => {
      if (a.projectId === NO_PROJECT && b.projectId !== NO_PROJECT) return 1;
      if (b.projectId === NO_PROJECT && a.projectId !== NO_PROJECT) return -1;
      return (
        a.projectName.localeCompare(b.projectName) ||
        (a.taskName ?? "").localeCompare(b.taskName ?? "")
      );
    });

    return result;
  }

  private static entryGroupWhere(
    userId: string,
    projectId: string,
    taskId: string | null | undefined,
    from: Date,
    to: Date,
    // Rows are identified by their description too, so operations on one row
    // never touch a sibling row that shares the same project and task.
    description?: string
  ) {
    return {
      userId,
      projectId: projectId === NO_PROJECT ? null : projectId,
      taskId: taskId ?? null,
      start: { gte: from, lte: to },
      ...(description === undefined ? {} : { description: description ?? "" }),
    };
  }

  /**
   * Create or update a time entry (REQ-TS-B03).
   * A duration of 0:00 deletes the existing entry for that project/task/date.
   * Rejects edits when the week's timesheet is locked (REQ-TS-B09) unless the
   * acting user is an admin (I5).
   */
  static async upsertEntry(
    userId: string,
    projectId: string,
    taskId: string | null,
    date: string,
    duration: string,
    meta: TimesheetRowMeta = {},
    bypassLock = false,
    /** Offset the client is displaying in, from Date#getTimezoneOffset() */
    tzOffsetMinutes?: number
  ) {
    this.validateDuration(duration);

    if (!bypassLock) {
      const status = await this.getTimesheetStatus(userId, this.getWeekStart(date));
      if (status === "SUBMITTED" || status === "APPROVED") {
        throw new Error("Timesheet is locked and cannot be edited");
      }
    }

    const entryDate = parseISO(date);
    const dayStart = new Date(entryDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(entryDate);
    dayEnd.setHours(23, 59, 59, 999);

    const durationMinutes = this.parseDuration(duration);

    // Check if entry exists for this project/task on this date
    // Scoped to this row's description, so typing into one row never picks up
    // (or overwrites) a different row on the same project and task
    const existing = await prisma.timeEntry.findFirst({
      where: this.entryGroupWhere(userId, projectId, taskId, dayStart, dayEnd, meta.description ?? ""),
    });

    if (durationMinutes === 0) {
      if (existing) {
        await prisma.timeEntry.delete({ where: { id: existing.id } });
        return { deleted: true, entry: existing };
      }
      return { deleted: false, entry: null };
    }

    if (existing) {
      // Leave the entry where it sits: a start time the user adjusted in the
      // Time Tracker must survive a duration change made from the timesheet.
      // Only the end moves, and anything after it slides by the same amount so
      // the day stays sequential.
      const newEnd = new Date(existing.start.getTime() + durationMinutes * 60000);
      const oldEnd = existing.end ?? newEnd;
      const entry = await prisma.timeEntry.update({
        where: { id: existing.id },
        data: {
          end: newEnd,
          description: meta.description ?? existing.description,
          phase: meta.phase === undefined ? existing.phase : meta.phase,
        },
      });
      await this.shiftLaterEntries(userId, existing.id, dayStart, dayEnd, oldEnd, newEnd);
      return { deleted: false, entry };
    }

    // A new entry begins at the individual's configured Day Start Time
    // (Preferences → General), resolved in the timezone the user is looking at.
    // If the day already holds entries it starts where the last one ended, so
    // several entries for one day read sequentially instead of stacking on top
    // of each other at the same hour.
    const { hours, minutes } = await this.getDayStart(userId);
    const dayStartTime = await this.wallClockInstant(userId, date, hours, minutes, tzOffsetMinutes);
    const lastOfDay = await prisma.timeEntry.findFirst({
      where: { userId, start: { gte: dayStart, lte: dayEnd }, end: { not: null } },
      orderBy: { end: "desc" },
    });
    const start =
      lastOfDay?.end && lastOfDay.end > dayStartTime ? lastOfDay.end : dayStartTime;
    const end = new Date(start.getTime() + durationMinutes * 60000);

    const entry = await prisma.timeEntry.create({
      data: {
        userId,
        projectId: projectId === NO_PROJECT ? null : projectId,
        taskId: taskId ?? null,
        description: meta.description || "",
        phase: meta.phase ?? null,
        start,
        end,
        billable: false,
      },
    });
    return { deleted: false, entry };
  }

  /**
   * Slide the entries that follow `oldEnd` on the same day by however much an
   * entry's end moved, keeping the day free of overlaps after a duration edit.
   * Skipped entirely if the shift would push anything outside the day, so a
   * large edit degrades to "leave the rest alone" rather than corrupting times.
   */
  private static async shiftLaterEntries(
    userId: string,
    excludeId: string,
    dayStart: Date,
    dayEnd: Date,
    oldEnd: Date,
    newEnd: Date
  ) {
    const delta = newEnd.getTime() - oldEnd.getTime();
    if (delta === 0) return;
    const later = await prisma.timeEntry.findMany({
      where: {
        userId,
        id: { not: excludeId },
        start: { gte: oldEnd, lte: dayEnd },
        end: { not: null },
      },
      orderBy: { start: "asc" },
    });
    if (later.length === 0) return;
    const firstStart = new Date(later[0].start.getTime() + delta);
    const lastEnd = new Date(later[later.length - 1].end!.getTime() + delta);
    if (firstStart < dayStart || lastEnd > dayEnd) return;
    await prisma.$transaction(
      later.map((e: any) =>
        prisma.timeEntry.update({
          where: { id: e.id },
          data: {
            start: new Date(e.start.getTime() + delta),
            end: new Date(e.end.getTime() + delta),
          },
        })
      )
    );
  }

  /**
   * Update row-level metadata (phase/description, I-A) on every completed
   * entry of a project+task row within a week.
   */
  static async updateRowMeta(
    userId: string,
    weekStart: Date,
    projectId: string,
    taskId: string | null,
    meta: TimesheetRowMeta,
    bypassLock = false,
    // The row being edited, identified by the description it currently holds.
    // Renaming a row must not rewrite a sibling row on the same project+task.
    currentDescription?: string
  ) {
    if (!bypassLock) {
      const status = await this.getTimesheetStatus(userId, weekStart);
      if (status === "SUBMITTED" || status === "APPROVED") {
        throw new Error("Timesheet is locked and cannot be edited");
      }
    }
    const weekEnd = this.getWeekEnd(weekStart);
    const data: Record<string, unknown> = {};
    if (meta.description !== undefined) data.description = meta.description;
    if (meta.phase !== undefined) data.phase = meta.phase;
    const updated = await prisma.timeEntry.updateMany({
      where: {
        ...this.entryGroupWhere(userId, projectId, taskId, weekStart, weekEnd, currentDescription),
        end: { not: null },
      },
      data,
    });
    return updated.count;
  }

  /**
   * Re-assign a row's subtask: move every entry of a project+task row in the
   * week to a different task of the same project (or to no task). Lets a
   * subtask chosen when the row was created be edited later.
   */
  static async updateRowTask(
    userId: string,
    weekStart: Date,
    projectId: string,
    fromTaskId: string | null,
    toTaskId: string | null,
    bypassLock = false,
    description?: string
  ) {
    if (!bypassLock) {
      const status = await this.getTimesheetStatus(userId, weekStart);
      if (status === "SUBMITTED" || status === "APPROVED") {
        throw new Error("Timesheet is locked and cannot be edited");
      }
    }
    if (toTaskId) {
      const task = await prisma.task.findUnique({ where: { id: toTaskId } });
      if (!task || (projectId !== NO_PROJECT && task.projectId !== projectId)) {
        throw new Error("Task does not belong to this project");
      }
    }
    const weekEnd = this.getWeekEnd(weekStart);
    const updated = await prisma.timeEntry.updateMany({
      where: this.entryGroupWhere(userId, projectId, fromTaskId, weekStart, weekEnd, description),
      data: { taskId: toTaskId },
    });
    return updated.count;
  }

  /**
   * Delete an entire timesheet row: all entries for a project+task in the
   * week (B12).
   */
  static async deleteRow(
    userId: string,
    weekStart: Date,
    projectId: string,
    taskId: string | null,
    bypassLock = false,
    description?: string
  ) {
    if (!bypassLock) {
      const status = await this.getTimesheetStatus(userId, weekStart);
      if (status === "SUBMITTED" || status === "APPROVED") {
        throw new Error("Timesheet is locked and cannot be edited");
      }
    }
    const weekEnd = this.getWeekEnd(weekStart);
    const deleted = await prisma.timeEntry.deleteMany({
      where: this.entryGroupWhere(userId, projectId, taskId, weekStart, weekEnd, description),
    });
    return deleted.count;
  }

  /**
   * Get approved time-off overlapping a week (REQ-TS-B06)
   */
  static async getTimeOffForWeek(userId: string, weekStart: Date) {
    const weekEnd = this.getWeekEnd(weekStart);
    const timeOff = await prisma.timeOff.findMany({
      where: {
        userId,
        approved: true,
        startDate: { lte: weekEnd },
        endDate: { gte: this.toDateOnly(weekStart) },
      },
    });

    return timeOff;
  }

  /**
   * Copy last week's entries to current week (REQ-TS-B07)
   */
  static async copyLastWeek(userId: string, currentWeekStart: Date, bypassLock = false) {
    if (!bypassLock) {
      const status = await this.getTimesheetStatus(userId, currentWeekStart);
      if (status === "SUBMITTED" || status === "APPROVED") {
        throw new Error("Timesheet is locked and cannot be edited");
      }
    }

    const lastWeekStart = addDays(currentWeekStart, -7);
    const lastWeekEnd = this.getWeekEnd(lastWeekStart);
    const lastWeekEntries = await prisma.timeEntry.findMany({
      where: {
        userId,
        start: { gte: lastWeekStart, lte: lastWeekEnd },
        end: { not: null },
      },
    });

    const newEntries = [];

    for (const entry of lastWeekEntries) {
      if (!entry.end) continue;

      // Monday = offset 0 ... Sunday = offset 6
      const dayOfWeek = entry.start.getDay();
      const dayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const newDate = addDays(currentWeekStart, dayOffset);

      const duration = entry.end.getTime() - entry.start.getTime();
      const newStart = new Date(newDate);
      newStart.setHours(entry.start.getHours(), entry.start.getMinutes(), 0, 0);
      const newEnd = new Date(newStart.getTime() + duration);

      const newEntry = await prisma.timeEntry.create({
        data: {
          userId,
          projectId: entry.projectId,
          taskId: entry.taskId,
          description: entry.description,
          phase: entry.phase,
          start: newStart,
          end: newEnd,
          billable: entry.billable,
          tags: entry.tags,
        },
      });

      newEntries.push(newEntry);
    }

    return newEntries;
  }

  /**
   * Save current week as template (REQ-TS-B08 / B13).
   * Times are stored as weekday offsets (0=Mon..6=Sun) so a template can be
   * applied to any week. When includeTimes is false only the rows (project,
   * task, phase, description) are kept.
   */
  static async saveAsTemplate(
    userId: string,
    weekStart: Date,
    templateName: string,
    includeTimes: boolean
  ) {
    const rows = await this.getEntriesForWeek(userId, weekStart);
    const templateRows = rows.map((r) => {
      const dayDurations: Record<string, string> = {};
      if (includeTimes) {
        Object.entries(r.entries).forEach(([date, duration]) => {
          const d = parseISO(date);
          const dayOfWeek = d.getDay();
          const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
          dayDurations[String(offset)] = duration;
        });
      }
      return {
        projectId: r.projectId,
        taskId: r.taskId,
        projectName: r.projectName,
        taskName: r.taskName,
        phase: r.phase,
        description: r.description,
        dayDurations,
      };
    });

    return await prisma.timesheetTemplate.create({
      data: {
        userId,
        name: templateName,
        projects: { includeTimes, rows: templateRows } as any,
      },
    });
  }

  /**
   * List saved templates for a user
   */
  static async getTemplates(userId: string) {
    return await prisma.timesheetTemplate.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Delete a template (B13) */
  static async deleteTemplate(userId: string, templateId: string) {
    const template = await prisma.timesheetTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template || template.userId !== userId) {
      throw new Error("Template not found");
    }
    await prisma.timesheetTemplate.delete({ where: { id: templateId } });
  }

  /**
   * Apply a template to a week (B13): creates/updates entries for rows with
   * saved times and returns every row so the client can render blank rows for
   * rows without times.
   */
  static async applyTemplate(
    userId: string,
    templateId: string,
    weekStart: Date,
    bypassLock = false,
    tzOffsetMinutes?: number
  ) {
    const template = await prisma.timesheetTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template || template.userId !== userId) {
      throw new Error("Template not found");
    }

    const raw: any = template.projects;
    // Legacy shape: plain array of { projectId, projectName, entries: {date: "H:MM"} }
    const rows: any[] = Array.isArray(raw)
      ? raw.map((r: any) => {
          const dayDurations: Record<string, string> = {};
          Object.entries(r.entries ?? {}).forEach(([date, duration]) => {
            const d = parseISO(date);
            const dayOfWeek = d.getDay();
            const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
            dayDurations[String(offset)] = duration as string;
          });
          return { ...r, taskId: null, dayDurations };
        })
      : raw?.rows ?? [];

    let applied = 0;
    for (const row of rows) {
      const meta: TimesheetRowMeta = {
        phase: row.phase ?? undefined,
        description: row.description || undefined,
      };
      for (const [offsetStr, duration] of Object.entries(
        (row.dayDurations ?? {}) as Record<string, string>
      )) {
        const date = format(addDays(weekStart, Number(offsetStr)), "yyyy-MM-dd");
        await this.upsertEntry(
          userId,
          row.projectId,
          row.taskId ?? null,
          date,
          duration,
          meta,
          bypassLock,
          tzOffsetMinutes
        );
        applied++;
      }
    }

    return { applied, rows };
  }

  /**
   * Submit timesheet for approval (REQ-TS-B09)
   */
  static async submitTimesheet(userId: string, weekStart: Date) {
    const weekStartDate = this.toDateOnly(weekStart);
    const existing = await prisma.timesheet.findUnique({
      where: { userId_weekStart: { userId, weekStart: weekStartDate } },
    });
    if (existing && (existing.status === "SUBMITTED" || existing.status === "APPROVED")) {
      throw new Error("Timesheet has already been submitted");
    }

    const timesheet = await prisma.timesheet.upsert({
      where: {
        userId_weekStart: { userId, weekStart: weekStartDate },
      },
      update: {
        status: "SUBMITTED",
        submittedAt: new Date(),
      },
      create: {
        userId,
        weekStart: weekStartDate,
        status: "SUBMITTED",
        submittedAt: new Date(),
      },
    });
    return timesheet;
  }

  /**
   * Reopen a submitted timesheet (I5, admin only — enforced by the router):
   * sets the week back to DRAFT so the owner can edit again.
   */
  static async reopenTimesheet(userId: string, weekStart: Date) {
    const weekStartDate = this.toDateOnly(weekStart);
    const existing = await prisma.timesheet.findUnique({
      where: { userId_weekStart: { userId, weekStart: weekStartDate } },
    });
    if (!existing) throw new Error("Timesheet not found");
    return await prisma.timesheet.update({
      where: { id: existing.id },
      data: { status: "DRAFT", submittedAt: null },
    });
  }

  /**
   * Get timesheet status for a week
   */
  static async getTimesheetStatus(userId: string, weekStart: Date) {
    const timesheet = await prisma.timesheet.findUnique({
      where: {
        userId_weekStart: {
          userId,
          weekStart: this.toDateOnly(weekStart),
        },
      },
    });
    return timesheet?.status || "DRAFT";
  }

  /**
   * Calculate per-day totals and grand total (REQ-TS-B05)
   */
  static calculateTotals(entries: Array<{ entries: Record<string, string> }>) {
    const dailyTotals: Record<string, number> = {};
    let grandTotal = 0;

    entries.forEach((project) => {
      Object.entries(project.entries).forEach(([date, duration]) => {
        const minutes = this.parseDuration(duration);
        if (!dailyTotals[date]) dailyTotals[date] = 0;
        dailyTotals[date] += minutes;
        grandTotal += minutes;
      });
    });

    const formattedDailyTotals: Record<string, string> = {};
    Object.entries(dailyTotals).forEach(([date, minutes]) => {
      formattedDailyTotals[date] = this.formatDuration(minutes);
    });

    return {
      dailyTotals: formattedDailyTotals,
      grandTotal: this.formatDuration(grandTotal),
    };
  }
}
