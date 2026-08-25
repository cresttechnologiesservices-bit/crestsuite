import { prisma } from "../../lib/prisma";
import { getWorkspaceSettings, weekStartsOn } from "../../lib/workspaceSettings";
import { valuesForRecords } from "../customFields/service";
import {
  eachDayOfInterval,
  format,
  differenceInMinutes,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays,
  getISOWeek,
  parseISO,
} from "date-fns";

export interface ReportFilter {
  startDate: Date;
  endDate: Date;
  userId?: string; // For "me" scope
  teamIds?: string[]; // For "team" scope
  clientIds?: string[];
  projectIds?: string[];
  taskIds?: string[];
  tags?: string[];
  billable?: boolean[]; // [true] or [false] or [true, false]
  description?: string;
  withoutDescription?: boolean;
  withoutTag?: boolean;
  withoutClient?: boolean;
  withoutProject?: boolean;
  withoutTask?: boolean;
  suspiciousDuration?: boolean;
  roundingMinutes?: number; // e.g., 15
}

export interface CustomerMonthlyRow {
  task: string;
  employee: string;
  description: string;
  daily: Record<string, number>;
  total: number;
  billable: number;
  nonBillable: number;
}
export interface CustomerMonthlyProject {
  id: string;
  name: string;
  color: string;
  clientName: string | null;
  internal: boolean;
  rows: Map<string, CustomerMonthlyRow>;
}

export class ReportsService {
  /**
   * Build Prisma where clause from filters
   */
  static buildWhere(filters: ReportFilter, requesterId: string) {
    const where: any = {
      start: { gte: filters.startDate, lte: filters.endDate },
      end: { not: null },
    };

    // Scope
    if (filters.teamIds && filters.teamIds.length > 0) {
      where.userId = { in: filters.teamIds };
    } else if (filters.userId) {
      where.userId = filters.userId;
    }

    // Project filter
    if (filters.withoutProject) {
      where.projectId = null;
    } else if (filters.projectIds && filters.projectIds.length > 0) {
      where.projectId = { in: filters.projectIds };
    }

    // Task filter
    if (filters.withoutTask) {
      where.taskId = null;
    } else if (filters.taskIds && filters.taskIds.length > 0) {
      where.taskId = { in: filters.taskIds };
    }

    // Client filter (via project)
    if (filters.withoutClient) {
      where.OR = [{ projectId: null }, { project: { clientId: null } }];
    } else if (filters.clientIds && filters.clientIds.length > 0) {
      where.project = { clientId: { in: filters.clientIds } };
    }

    // Tags filter (OR within category)
    if (filters.withoutTag) {
      where.tags = { isEmpty: true };
    } else if (filters.tags && filters.tags.length > 0) {
      where.tags = { hasSome: filters.tags };
    }

    // Billable filter
    if (filters.billable && filters.billable.length === 1) {
      where.billable = filters.billable[0];
    }

    // Description filter
    if (filters.withoutDescription) {
      where.description = "";
    } else if (filters.description) {
      where.description = { contains: filters.description, mode: "insensitive" };
    }

    return where;
  }

  /**
   * Apply rounding to duration (REQ-REP-B04)
   */
  static roundDuration(minutes: number, roundingMinutes?: number): number {
    if (!roundingMinutes || roundingMinutes <= 0) return minutes;
    return Math.round(minutes / roundingMinutes) * roundingMinutes;
  }

  /**
   * REQ-REP-B02, B03: Summary report
   */
  static async getSummary(filters: ReportFilter, groupBy: "project" | "description" = "project") {
    const where = this.buildWhere(filters, filters.userId || "");
    const settings = await getWorkspaceSettings();
    const fallbackRate = settings.billableRate ?? 0;
    const entries = await prisma.timeEntry.findMany({
      where,
      include: { project: { include: { client: true } }, user: true },
    });

    let totalMinutes = 0;
    let billableMinutes = 0;
    let amount = 0;
    const groups: Record<string, { name: string; minutes: number; color?: string; clientName?: string; count: number }> = {};
    // Pre-fill every date of the selected range so the chart always shows the
    // full X-axis (Mon–Fri and beyond) even when no entries exist.
    const dailyTotals: Record<string, number> = {};
    eachDayOfInterval({ start: filters.startDate, end: filters.endDate }).forEach((d) => {
      dailyTotals[format(d, "yyyy-MM-dd")] = 0;
    });

    entries.forEach((entry) => {
      if (!entry.end) return;
      let duration = differenceInMinutes(entry.end, entry.start);
      duration = this.roundDuration(duration, filters.roundingMinutes);
      totalMinutes += duration;
      if (entry.billable) {
        billableMinutes += duration;
        // Falls back to the workspace billable rate when the project has none
        const rate = entry.project?.hourlyRate ? Number(entry.project.hourlyRate) : fallbackRate;
        amount += (duration / 60) * rate;
      }

      const dateStr = format(entry.start, "yyyy-MM-dd");
      dailyTotals[dateStr] = (dailyTotals[dateStr] || 0) + duration;

      let key: string;
      let name: string;
      let color: string | undefined;
      let clientName: string | undefined;

      if (groupBy === "project") {
        key = entry.projectId || "no-project";
        name = entry.project?.name || "No Project";
        color = entry.project?.color || "#94a3b8";
        clientName = entry.project?.client?.name;
      } else {
        key = entry.description || "(no description)";
        name = entry.description || "(no description)";
      }

      if (!groups[key]) groups[key] = { name, minutes: 0, color, clientName, count: 0 };
      groups[key].minutes += duration;
      groups[key].count += 1;
    });

    const breakdown = Object.entries(groups)
      .map(([key, data]) => ({
        key,
        name: data.name,
        duration: this.formatDuration(data.minutes),
        minutes: data.minutes,
        percentage: totalMinutes > 0 ? Math.round((data.minutes / totalMinutes) * 100) : 0,
        color: data.color,
        clientName: data.clientName,
        entryCount: data.count,
      }))
      .sort((a, b) => b.minutes - a.minutes);

    return {
      total: this.formatDuration(totalMinutes),
      totalMinutes,
      billableTotal: this.formatDuration(billableMinutes),
      amount: amount.toFixed(2),
      breakdown,
      dailyTotals: Object.entries(dailyTotals).map(([date, minutes]) => ({
        date,
        duration: this.formatDuration(minutes),
        minutes,
      })),
    };
  }

  /**
   * REQ-REP-B06..B08: Detailed report
   */
  static async getDetailed(
    filters: ReportFilter,
    page: number = 1,
    pageSize: number = 50,
    sortBy: string = "time",
    sortOrder: "asc" | "desc" = "desc",
    /** Role of the requester, so custom-field visibility is respected */
    role: string = "MEMBER"
  ) {
    const where = this.buildWhere(filters, filters.userId || "");
    const orderBy: any = {};
    if (sortBy === "time") orderBy.start = sortOrder;
    else if (sortBy === "duration") orderBy.start = sortOrder; // Will sort by duration in post-processing
    else if (sortBy === "description") orderBy.description = sortOrder;
    else if (sortBy === "user") orderBy.user = { name: sortOrder };
    else orderBy.start = sortOrder;

    const fallbackRate = (await getWorkspaceSettings()).billableRate ?? 0;
    const [entries, total] = await Promise.all([
      prisma.timeEntry.findMany({
        where,
        include: { project: { include: { client: true } }, user: true, task: true },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.timeEntry.count({ where }),
    ]);

    const items = entries.map((entry) => {
      const duration = entry.end ? differenceInMinutes(entry.end, entry.start) : 0;
      const roundedDuration = this.roundDuration(duration, filters.roundingMinutes);
      const billableRate = entry.project?.hourlyRate ? Number(entry.project.hourlyRate) : fallbackRate;
      const amount = entry.billable ? (roundedDuration / 60) * billableRate : 0;

      return {
        id: entry.id,
        description: entry.description,
        projectName: entry.project?.name || null,
        projectColor: entry.project?.color || null,
        clientName: entry.project?.client?.name || null,
        taskName: entry.task?.name || null,
        userId: entry.userId,
        userName: entry.user.name,
        userEmail: entry.user.email,
        tags: entry.tags,
        billable: entry.billable,
        start: entry.start.toISOString(),
        end: entry.end?.toISOString() || null,
        date: format(entry.start, "yyyy-MM-dd"),
        startTime: format(entry.start, "HH:mm"),
        endTime: entry.end ? format(entry.end, "HH:mm") : null,
        duration: this.formatDuration(roundedDuration),
        durationMinutes: roundedDuration,
        amount: amount.toFixed(2),
        locked: entry.project?.status === "ARCHIVED", // REQ-REP-B07: locked when project archived
        createdAt: entry.createdAt.toISOString(),
      };
    });

    // Sort by duration if requested (page-local; duration is computed, not stored)
    if (sortBy === "duration") {
      items.sort((a, b) =>
        sortOrder === "desc" ? b.durationMinutes - a.durationMinutes : a.durationMinutes - b.durationMinutes
      );
    }

    // Custom field values travel with the rows, for the table and exports
    const cf = await valuesForRecords("timeEntry", items.map((i) => i.id), role);
    return {
      items: items.map((i) => ({ ...i, customFields: cf.get(i.id) ?? {} })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * REQ-REP-B09, B15: Weekly report
   */
  static async getWeekly(filters: ReportFilter, groupBy: "project" | "user" | "description" = "project") {
    const where = this.buildWhere(filters, filters.userId || "");
    const entries = await prisma.timeEntry.findMany({
      where,
      include: { project: { include: { client: true } }, user: true },
    });

    // Get all days in the week
    const days = eachDayOfInterval({ start: filters.startDate, end: filters.endDate });
    const dayKeys = days.map((d) => format(d, "yyyy-MM-dd"));

    const groups: Record<string, { name: string; color?: string; daily: Record<string, number> }> = {};

    entries.forEach((entry) => {
      if (!entry.end) return;
      let duration = differenceInMinutes(entry.end, entry.start);
      duration = this.roundDuration(duration, filters.roundingMinutes);

      const dateStr = format(entry.start, "yyyy-MM-dd");
      let key: string;
      let name: string;
      let color: string | undefined;

      if (groupBy === "project") {
        key = entry.projectId || "no-project";
        name = entry.project?.name || "No Project";
        color = entry.project?.color || "#94a3b8";
      } else if (groupBy === "user") {
        key = entry.userId;
        name = entry.user.name;
      } else {
        key = entry.description || "(no description)";
        name = entry.description || "(no description)";
      }

      if (!groups[key]) groups[key] = { name, color, daily: {} };
      groups[key].daily[dateStr] = (groups[key].daily[dateStr] || 0) + duration;
    });

    // REQ-REP-F32: dash placeholders for empty cells; per-row totals
    const columnTotals: Record<string, number> = {};
    dayKeys.forEach((day) => (columnTotals[day] = 0));
    let grandTotal = 0;

    const rows = Object.entries(groups).map(([key, data]) => {
      const daily: Record<string, string> = {};
      let total = 0;
      dayKeys.forEach((day) => {
        const mins = data.daily[day] || 0;
        daily[day] = mins > 0 ? this.formatDuration(mins) : "—";
        total += mins;
        columnTotals[day] += mins;
      });
      grandTotal += total;
      return {
        key,
        name: data.name,
        color: data.color,
        daily,
        total: this.formatDuration(total),
        totalMinutes: total,
      };
    });

    const formattedColumnTotals: Record<string, string> = {};
    dayKeys.forEach((day) => {
      formattedColumnTotals[day] = this.formatDuration(columnTotals[day]);
    });

    return {
      days: dayKeys,
      rows,
      columnTotals: formattedColumnTotals,
      grandTotal: this.formatDuration(grandTotal),
    };
  }

  /**
   * REQ-REP-B39..B44: Audit flags
   */
  static async getAuditEntries(filters: ReportFilter, flags: string[]) {
    const where = this.buildWhere(filters, filters.userId || "");
    const entries = await prisma.timeEntry.findMany({
      where,
      include: { project: { include: { client: true } }, user: true, task: true },
    });

    // REQ-REP-B42: OR logic across flags
    const flagged = entries.filter((entry) => {
      const duration = entry.end ? differenceInMinutes(entry.end, entry.start) : 0;
      const matches: boolean[] = [];

      if (flags.includes("suspicious_duration")) {
        // REQ-REP-B43: Configurable threshold (default: >12 hours or <1 minute)
        matches.push(duration > 12 * 60 || (duration >= 0 && duration < 1));
      }
      if (flags.includes("without_project")) {
        matches.push(!entry.projectId);
      }
      if (flags.includes("without_task")) {
        matches.push(!entry.taskId);
      }

      return matches.some(Boolean);
    });

    return {
      items: flagged.map((entry) => {
        const duration = entry.end ? differenceInMinutes(entry.end, entry.start) : 0;
        return {
          id: entry.id,
          description: entry.description,
          projectName: entry.project?.name || null,
          projectColor: entry.project?.color || null,
          clientName: entry.project?.client?.name || null,
          taskName: entry.task?.name || null,
          userName: entry.user.name,
          tags: entry.tags,
          billable: entry.billable,
          date: format(entry.start, "yyyy-MM-dd"),
          startTime: format(entry.start, "HH:mm"),
          endTime: entry.end ? format(entry.end, "HH:mm") : null,
          start: entry.start.toISOString(),
          end: entry.end?.toISOString() || null,
          duration: this.formatDuration(duration),
          durationMinutes: duration,
          locked: entry.project?.status === "ARCHIVED",
          flags: this.getEntryFlags(entry),
        };
      }),
      // REQ-REP-B44: counts per condition
      counts: {
        suspicious_duration: entries.filter((e) => {
          const d = e.end ? differenceInMinutes(e.end, e.start) : 0;
          return d > 12 * 60 || (d >= 0 && d < 1);
        }).length,
        without_project: entries.filter((e) => !e.projectId).length,
        without_task: entries.filter((e) => !e.taskId).length,
      },
    };
  }

  private static getEntryFlags(entry: any): string[] {
    const flags: string[] = [];
    const duration = entry.end ? differenceInMinutes(entry.end, entry.start) : 0;
    if (duration > 12 * 60 || (duration >= 0 && duration < 1)) flags.push("suspicious_duration");
    if (!entry.projectId) flags.push("without_project");
    if (!entry.taskId) flags.push("without_task");
    return flags;
  }

  /**
   * Customer Monthly report — web port of the VBA billing workbook generator.
   * For the calendar weeks covering a month it produces:
   *  - one section per project: rows of task+employee (+description for the
   *    internal projects), day columns grouped under CW week headers, hours
   *    per day, row totals and a project grand total;
   *  - per-project Billable / Non-Billable / Total summary with grand totals;
   *  - consolidated hours per employee per project.
   */
  static async getCustomerMonthly(month: string, restrictUserId?: string) {
    const monthStart = startOfMonth(parseISO(`${month}-01`));
    const monthEnd = endOfMonth(monthStart);
    // Like the VBA tool, the grid spans whole Monday-based calendar weeks
    const wsStart = weekStartsOn(await getWorkspaceSettings());
    const rangeStart = startOfWeek(monthStart, { weekStartsOn: wsStart });
    const rangeEnd = endOfWeek(monthEnd, { weekStartsOn: wsStart });

    const weeks: { cw: number; days: string[] }[] = [];
    for (let ws = rangeStart; ws < rangeEnd; ws = addDays(ws, 7)) {
      weeks.push({
        cw: getISOWeek(ws),
        days: Array.from({ length: 7 }, (_, i) => format(addDays(ws, i), "yyyy-MM-dd")),
      });
    }
    const days = weeks.flatMap((w) => w.days);

    const entries = await prisma.timeEntry.findMany({
      where: {
        start: { gte: rangeStart, lte: rangeEnd },
        end: { not: null },
        ...(restrictUserId ? { userId: restrictUserId } : {}),
      },
      include: { project: { include: { client: true } }, user: true, task: true },
      orderBy: { start: "asc" },
    });

    // Sheets named like these get a Description column and description-level
    // grouping in the VBA tool; kept for parity.
    const INTERNAL_PROJECTS = ["Internal Meetings", "Internal Projects"];
    // Whole projects that never bill (VBA: Leave/Holiday/Internal*)
    const NON_BILLABLE_PROJECTS = ["Leave", "Holiday", ...INTERNAL_PROJECTS];
    // Task names that never bill even inside billable projects
    const UNBILLABLE_TASKS = [
      "unapproved efforts", "unapproved tasks", "unapproved task", "unapproved",
      "internal meetings", "learning", "unplanned activity", "unplanned",
    ];

    const projects = new Map<string, CustomerMonthlyProject>();
    const round2 = (n: number) => Math.round(n * 100) / 100;

    for (const e of entries) {
      if (!e.end) continue;
      const projectName = e.project?.name || "No Project";
      const projectKey = e.projectId || "no-project";
      const internal = INTERNAL_PROJECTS.includes(projectName);
      if (!projects.has(projectKey)) {
        projects.set(projectKey, {
          id: projectKey,
          name: projectName,
          color: e.project?.color || "#94a3b8",
          clientName: e.project?.client?.name || null,
          internal,
          rows: new Map(),
        });
      }
      const section = projects.get(projectKey)!;
      // VBA: task cell shows "Project-Task"; internal sheets also split rows
      // by the entry description.
      const taskLabel = `${projectName}-${e.task?.name || e.description || "(no task)"}`;
      const rowKey = internal
        ? `${taskLabel}|${e.user.name}|${e.description}`
        : `${taskLabel}|${e.user.name}`;
      if (!section.rows.has(rowKey)) {
        section.rows.set(rowKey, {
          task: taskLabel,
          employee: e.user.name,
          description: e.description || "",
          daily: {},
          total: 0,
          billable: 0,
          nonBillable: 0,
        });
      }
      const row = section.rows.get(rowKey)!;
      const hours = (e.end.getTime() - e.start.getTime()) / 3600000;
      const day = format(e.start, "yyyy-MM-dd");
      row.daily[day] = round2((row.daily[day] || 0) + hours);
      row.total = round2(row.total + hours);
      const taskName = (e.task?.name || "").toLowerCase();
      const nonBillable =
        NON_BILLABLE_PROJECTS.includes(projectName) ||
        UNBILLABLE_TASKS.includes(taskName) ||
        !e.billable;
      if (nonBillable) row.nonBillable = round2(row.nonBillable + hours);
      else row.billable = round2(row.billable + hours);
    }

    const projectSections = Array.from(projects.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => {
        const rows = Array.from(p.rows.values()).sort(
          (a, b) => a.task.localeCompare(b.task) || a.employee.localeCompare(b.employee)
        );
        const dailyTotals: Record<string, number> = {};
        let total = 0;
        rows.forEach((r) => {
          Object.entries(r.daily).forEach(([d, h]) => {
            dailyTotals[d] = round2((dailyTotals[d] || 0) + h);
          });
          total = round2(total + r.total);
        });
        return { ...p, rows, dailyTotals, total };
      });

    // Total_Sheet equivalent: billable / non-billable / total per project
    const projectTotals = projectSections.map((p) => ({
      name: p.name,
      clientName: p.clientName,
      color: p.color,
      billable: round2(p.rows.reduce((s, r) => s + r.billable, 0)),
      nonBillable: round2(p.rows.reduce((s, r) => s + r.nonBillable, 0)),
      total: p.total,
    }));
    const grand = {
      billable: round2(projectTotals.reduce((s, p) => s + p.billable, 0)),
      nonBillable: round2(projectTotals.reduce((s, p) => s + p.nonBillable, 0)),
      total: round2(projectTotals.reduce((s, p) => s + p.total, 0)),
    };

    // Consolidated Hours equivalent: employee -> project -> hours
    const byEmployee = new Map<string, Map<string, number>>();
    for (const p of projectSections) {
      for (const r of p.rows) {
        if (!byEmployee.has(r.employee)) byEmployee.set(r.employee, new Map());
        const emp = byEmployee.get(r.employee)!;
        emp.set(p.name, round2((emp.get(p.name) || 0) + r.total));
      }
    }
    const consolidated = Array.from(byEmployee.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([employee, perProject]) => ({
        employee,
        rows: Array.from(perProject.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([project, hours]) => ({ project, hours })),
        total: round2(Array.from(perProject.values()).reduce((s, h) => s + h, 0)),
      }));

    return {
      month,
      rangeStart: format(rangeStart, "yyyy-MM-dd"),
      rangeEnd: format(rangeEnd, "yyyy-MM-dd"),
      weeks,
      days,
      projects: projectSections,
      projectTotals,
      grand,
      consolidated,
    };
  }

  /**
   * REQ-REP-B16..B21: Shared reports
   */
  static async createSharedReport(
    ownerId: string,
    data: {
      name: string;
      visibility: "public" | "private";
      alwaysThisWeek: boolean;
      lockDates: boolean;
      filters: any;
    }
  ) {
    // REQ-REP-B17: Validate name length
    if (data.name.length < 2 || data.name.length > 250) {
      throw new Error("Report name must be between 2 and 250 characters");
    }

    const slug = this.generateSlug();
    const report = await prisma.sharedReport.create({
      data: {
        name: data.name,
        slug,
        ownerId,
        visibility: data.visibility,
        alwaysThisWeek: data.alwaysThisWeek,
        lockDates: data.lockDates,
        filtersJson: data.filters,
      },
    });

    return { ...report, url: `/shared/reports/${slug}` };
  }

  static async listSharedReports(ownerId: string, search?: string) {
    return prisma.sharedReport.findMany({
      where: {
        ownerId,
        ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  static async deleteSharedReport(ownerId: string, id: string) {
    const report = await prisma.sharedReport.findUnique({ where: { id } });
    if (!report) throw new Error("Report not found");
    if (report.ownerId !== ownerId) throw new Error("Access denied");
    await prisma.sharedReport.delete({ where: { id } });
  }

  static async getSharedReport(slug: string) {
    const report = await prisma.sharedReport.findUnique({ where: { slug } });
    if (!report) throw new Error("Report not found");

    // REQ-REP-B20: lockDates => fixed stored range; otherwise recalculate relative to now
    let filters = report.filtersJson as any;
    if (!report.lockDates || report.alwaysThisWeek) {
      const now = new Date();
      const sharedWeekStart = weekStartsOn(await getWorkspaceSettings());
      filters = {
        ...filters,
        startDate: format(startOfWeek(now, { weekStartsOn: sharedWeekStart }), "yyyy-MM-dd"),
        endDate: format(endOfWeek(now, { weekStartsOn: sharedWeekStart }), "yyyy-MM-dd"),
      };
    }

    return { ...report, filters };
  }

  private static generateSlug(): string {
    return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
  }

  static formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${String(mins).padStart(2, "0")}`;
  }
}
