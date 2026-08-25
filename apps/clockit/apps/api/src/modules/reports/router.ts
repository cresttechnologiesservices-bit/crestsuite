import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthedRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { exportLimiter } from "../../middleware/rateLimit";
import { ReportsService, ReportFilter } from "./service";
import { ExportService, ExportConfig } from "./export";
import { CustomerMonthlyExportService } from "./customerMonthlyExport";
import { valuesForRecords } from "../customFields/service";
import { parseISO, format } from "date-fns";

const r = Router();

// REQ-REP-B18, B21: Public shared-report access (registered before requireAuth).
// Private reports still require an authenticated session.
r.get("/shared/:slug", async (req: AuthedRequest, res) => {
  try {
    const report = await ReportsService.getSharedReport(req.params.slug);
    if (report.visibility === "private") {
      return requireAuth(req, res, () => res.json(report));
    }
    res.json(report);
  } catch (error: any) {
    res.status(404).json({ error: error.message });
  }
});

r.use(requireAuth);

// REQ-I13: only managers/admins may request other users' report data.
// For plain members a team-scoped request is downgraded to self-only.
async function authorizeScope(req: any, userId: string): Promise<void> {
  const scope = req.query.scope || req.body?.scope;
  const teamIds = req.query.team_ids || req.body?.team_ids;
  if (scope !== "team" && !teamIds) return;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const canViewTeam = !!user && ["OWNER", "ADMIN", "MANAGER"].includes(user.role);
  if (!canViewTeam) {
    if (req.query.scope) req.query.scope = "me";
    if (req.body?.scope) req.body.scope = "me";
    if (req.query.team_ids) delete req.query.team_ids;
    if (req.body?.team_ids) delete req.body.team_ids;
  }
}

// Helper to parse filters from query/body
function parseFilters(req: any, userId: string): ReportFilter {
  const start = req.query.start_date || req.body?.start_date;
  const end = req.query.end_date || req.body?.end_date;
  if (!start || !end) throw new Error("start_date and end_date required");

  const filters: ReportFilter = {
    startDate: parseISO(start),
    endDate: parseISO(end),
  };

  const scope = req.query.scope || req.body?.scope || "me";
  if (scope === "team") {
    const teamIds = req.query.team_ids || req.body?.team_ids;
    if (teamIds) {
      filters.teamIds = typeof teamIds === "string" ? teamIds.split(",") : teamIds;
    }
  } else {
    filters.userId = userId;
  }

  const parseList = (v: any): string[] => (typeof v === "string" ? v.split(",") : v);

  if (req.query.client_ids || req.body?.client_ids) {
    filters.clientIds = parseList(req.query.client_ids || req.body.client_ids);
  }
  if (req.query.project_ids || req.body?.project_ids) {
    filters.projectIds = parseList(req.query.project_ids || req.body.project_ids);
  }
  if (req.query.task_ids || req.body?.task_ids) {
    filters.taskIds = parseList(req.query.task_ids || req.body.task_ids);
  }
  if (req.query.tags || req.body?.tags) {
    filters.tags = parseList(req.query.tags || req.body.tags);
  }
  if (req.query.billable || req.body?.billable) {
    const v = req.query.billable || req.body.billable;
    const list = typeof v === "string" ? v.split(",") : v;
    filters.billable = list.map((x: any) => x === true || x === "true");
  }
  if (req.query.description || req.body?.description) {
    filters.description = req.query.description || req.body.description;
  }
  if (req.query.without_description === "true" || req.body?.without_description) {
    filters.withoutDescription = true;
  }
  if (req.query.without_tag === "true" || req.body?.without_tag) {
    filters.withoutTag = true;
  }
  if (req.query.without_client === "true" || req.body?.without_client) {
    filters.withoutClient = true;
  }
  if (req.query.without_project === "true" || req.body?.without_project) {
    filters.withoutProject = true;
  }
  if (req.query.without_task === "true" || req.body?.without_task) {
    filters.withoutTask = true;
  }
  if (req.query.rounding || req.body?.rounding) {
    filters.roundingMinutes = Number(req.query.rounding || req.body.rounding);
  }
  return filters;
}

// REQ-REP-B02: Summary report
r.get("/summary", requirePermission("reports", "view"), async (req: AuthedRequest, res) => {
  try {
    await authorizeScope(req, req.userId!);
    const filters = parseFilters(req, req.userId!);
    const groupBy = (req.query.group_by as "project" | "description") || "project";
    const result = await ReportsService.getSummary(filters, groupBy);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// REQ-REP-B06: Detailed report
r.get("/detailed", requirePermission("reports", "view"), async (req: AuthedRequest, res) => {
  try {
    await authorizeScope(req, req.userId!);
    const filters = parseFilters(req, req.userId!);
    const page = Number(req.query.page ?? 1);
    const pageSize = Math.min(Number(req.query.page_size ?? 50), 100);
    const sortBy = (req.query.sort_by as string) || "time";
    const sortOrder = (req.query.sort_order as "asc" | "desc") || "desc";
    const role = (await prisma.user.findUnique({ where: { id: req.userId! } }))?.role ?? "MEMBER";
    const result = await ReportsService.getDetailed(filters, page, pageSize, sortBy, sortOrder, role);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// REQ-REP-B15: Weekly report
r.get("/weekly", requirePermission("reports", "view"), async (req: AuthedRequest, res) => {
  try {
    await authorizeScope(req, req.userId!);
    const filters = parseFilters(req, req.userId!);
    const groupBy = (req.query.group_by as "project" | "user" | "description") || "project";
    const result = await ReportsService.getWeekly(filters, groupBy);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Customer Monthly report (VBA billing-workbook port): team-wide for
// managers/admins/owners, self-only for members.
r.get("/customer-monthly", requirePermission("reports", "view"), async (req: AuthedRequest, res) => {
  try {
    const month = req.query.month as string;
    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ error: "month (YYYY-MM) required" });
    }
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    const teamWide = !!user && ["OWNER", "ADMIN", "MANAGER"].includes(user.role);
    const result = await ReportsService.getCustomerMonthly(
      month,
      teamWide ? undefined : req.userId!
    );
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Customer Monthly export (CSV / Excel / PDF) of the currently selected month
r.get("/customer-monthly/export/:format", requirePermission("reports", "manage"), exportLimiter, async (req: AuthedRequest, res) => {
  try {
    const month = req.query.month as string;
    const fmt = req.params.format;
    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ error: "month (YYYY-MM) required" });
    }
    if (!["csv", "excel", "pdf"].includes(fmt)) {
      return res.status(400).json({ error: "format must be csv, excel or pdf" });
    }
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    const teamWide = !!user && ["OWNER", "ADMIN", "MANAGER"].includes(user.role);
    const report = await ReportsService.getCustomerMonthly(
      month,
      teamWide ? undefined : req.userId!
    );

    const filename = `customer-monthly-${month}`;
    if (fmt === "csv") {
      const buffer = await CustomerMonthlyExportService.generateCSV(report);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
      res.send(buffer);
    } else if (fmt === "excel") {
      const buffer = await CustomerMonthlyExportService.generateExcel(report);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
      res.send(buffer);
    } else {
      const buffer = await CustomerMonthlyExportService.generatePDF(report);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
      res.send(buffer);
    }

    await prisma.auditLog.create({
      data: {
        userId: req.userId!,
        action: `REPORT_EXPORT_CUSTOMER_MONTHLY_${fmt.toUpperCase()}`,
        metadata: { month, projects: report.projects.length },
      },
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// REQ-REP-B39..B44: Audit filter
r.get("/detailed/audit", async (req: AuthedRequest, res) => {
  try {
    await authorizeScope(req, req.userId!);
    const filters = parseFilters(req, req.userId!);
    const flagParam = req.query.flag as string;
    const flags = flagParam ? flagParam.split(",") : [];
    const result = await ReportsService.getAuditEntries(filters, flags);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// REQ-REP-B09, B11: Edit another user's entry description (admin)
r.patch("/detailed/entries/:id", async (req: AuthedRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user || (user.role !== "ADMIN" && user.role !== "OWNER" && user.role !== "MANAGER")) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const entry = await prisma.timeEntry.findUnique({ where: { id: req.params.id } });
    if (!entry) return res.status(404).json({ error: "Entry not found" });

    const updated = await prisma.timeEntry.update({
      where: { id: entry.id },
      data: { description: req.body.description },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.userId!,
        action: "REPORT_ENTRY_EDIT",
        target: entry.id,
        metadata: { field: "description" },
      },
    });

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-REP-B10, B11: Add/update tags on another user's entry (admin)
r.patch("/detailed/entries/:id/tags", async (req: AuthedRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user || (user.role !== "ADMIN" && user.role !== "OWNER" && user.role !== "MANAGER")) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const { tags } = z.object({ tags: z.array(z.string()) }).parse(req.body);
    const updated = await prisma.timeEntry.update({
      where: { id: req.params.id },
      data: { tags },
    });

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-REP-B16..B18: Create shared report
r.post("/share", requirePermission("reports", "manage"), async (req: AuthedRequest, res) => {
  try {
    const schema = z.object({
      name: z.string().min(2).max(250),
      visibility: z.enum(["public", "private"]).default("public"),
      alwaysThisWeek: z.boolean().default(false),
      lockDates: z.boolean().default(false),
      filters: z.any(),
    });
    const body = schema.parse(req.body);
    const report = await ReportsService.createSharedReport(req.userId!, {
      ...body,
      filters: body.filters ?? {},
    });

    // REQ-REP-B26: audit log
    await prisma.auditLog.create({
      data: {
        userId: req.userId!,
        action: "REPORT_SHARED",
        target: report.id,
        metadata: { name: body.name, visibility: body.visibility },
      },
    });

    res.status(201).json(report);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// REQ-REP-B19: List shared reports
r.get("/shared", async (req: AuthedRequest, res) => {
  try {
    const search = req.query.search as string | undefined;
    const reports = await ReportsService.listSharedReports(req.userId!, search);
    res.json(reports);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a shared report (owner only)
r.delete("/shared/:id", async (req: AuthedRequest, res) => {
  try {
    await ReportsService.deleteSharedReport(req.userId!, req.params.id);
    res.status(204).end();
  } catch (error: any) {
    const code = error.message === "Report not found" ? 404 : error.message === "Access denied" ? 403 : 500;
    res.status(code).json({ error: error.message });
  }
});

// REQ-REP-B27, B28: Column visibility configuration — persisted per user in
// User.uiPrefs so it survives server restarts.
const DEFAULT_COLUMNS: Record<string, boolean> = {
  client: true, description: true, project: true, status: true, tag: true, task: true, team: true,
};

r.get("/columns", async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  const ui = (user?.uiPrefs as any) || {};
  res.json({ ...DEFAULT_COLUMNS, ...(ui.reportColumns || {}) });
});

r.patch("/columns", async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  const ui = (user?.uiPrefs as any) || {};
  const next = { ...DEFAULT_COLUMNS, ...(ui.reportColumns || {}), ...(req.body || {}) };
  await prisma.user.update({
    where: { id: req.userId! },
    data: { uiPrefs: { ...ui, reportColumns: next } },
  });
  res.json(next);
});

// REQ-REP-B22..B24: Export endpoints
const ExportColumnsSchema = z.object({
  reportName: z.string().optional(),
  notes: z.string().optional(),
  rightToLeft: z.boolean().optional(),
  columns: z.object({
    project: z.boolean().optional(),
    client: z.boolean().optional(),
    description: z.boolean().optional(),
    task: z.boolean().optional(),
    user: z.boolean().optional(),
    tags: z.boolean().optional(),
    startDate: z.boolean().optional(),
    startTime: z.boolean().optional(),
    endTime: z.boolean().optional(),
    durationH: z.boolean().optional(),
    email: z.boolean().optional(),
    billable: z.boolean().optional(),
    endDate: z.boolean().optional(),
    durationDecimal: z.boolean().optional(),
    group: z.boolean().optional(),
    notesIncluded: z.boolean().optional(),
    dateOfCreation: z.boolean().optional(),
  }),
});

// REQ-REP-B59: configurable max row limit
const EXPORT_MAX_ROWS = Number(process.env.EXPORT_MAX_ROWS || 10000);

async function getEntriesForExport(req: AuthedRequest) {
  await authorizeScope(req, req.userId!);
  const filters = parseFilters(req, req.userId!);
  const where = ReportsService.buildWhere(filters, req.userId!);

  const count = await prisma.timeEntry.count({ where });
  if (count > EXPORT_MAX_ROWS) {
    throw new Error(`Export limit exceeded: ${count} entries (max ${EXPORT_MAX_ROWS})`);
  }

  const entries = await prisma.timeEntry.findMany({
    where,
    include: { project: { include: { client: true } }, user: true, task: true },
    orderBy: { start: "desc" },
  });

  // REQ-REP-B52: resolve group per user
  const userIds = Array.from(new Set(entries.map((e) => e.userId)));
  const memberships = await prisma.groupMember.findMany({
    where: { userId: { in: userIds } },
    include: { group: true },
  });
  const groupByUser: Record<string, string> = {};
  memberships.forEach((m) => {
    if (!groupByUser[m.userId]) groupByUser[m.userId] = m.group.name;
  });

  const role = (await prisma.user.findUnique({ where: { id: req.userId! } }))?.role ?? "MEMBER";
  const customValues = await valuesForRecords("timeEntry", entries.map((e) => e.id), role);

  return entries.map((entry) => {
    const durationMinutes = entry.end ? Math.round((entry.end.getTime() - entry.start.getTime()) / 60000) : 0;
    return {
      customFields: customValues.get(entry.id) ?? {},
      id: entry.id,
      description: entry.description,
      projectName: entry.project?.name || "",
      clientName: entry.project?.client?.name || "",
      taskName: entry.task?.name || "",
      userName: entry.user.name,
      userEmail: entry.user.email,
      groupName: groupByUser[entry.userId] || "",
      tags: entry.tags,
      billable: entry.billable,
      date: format(entry.start, "yyyy-MM-dd"),
      startTime: format(entry.start, "HH:mm"),
      endDate: entry.end ? format(entry.end, "yyyy-MM-dd") : "",
      endTime: entry.end ? format(entry.end, "HH:mm") : "",
      duration: ReportsService.formatDuration(durationMinutes),
      durationMinutes,
      start: entry.start.toISOString(),
      end: entry.end?.toISOString() || null,
      createdAt: entry.createdAt.toISOString(),
    };
  });
}

const CSV_EXCEL_DEFAULT_COLUMNS = {
  project: true, client: true, description: true, task: true, user: true,
  tags: true, email: true, billable: true, startDate: true, startTime: true,
  endDate: true, endTime: true, durationH: true, durationDecimal: true,
  group: true, dateOfCreation: true,
};

const PDF_DEFAULT_COLUMNS = {
  project: true, client: true, description: true, task: true, user: true,
  tags: true, startDate: true, startTime: true, endTime: true,
  durationH: true, dateOfCreation: true, notesIncluded: true,
};

function parseExportConfig(req: AuthedRequest, defaults: Record<string, boolean>): ExportConfig {
  const configRaw = req.query.config ? JSON.parse(req.query.config as string) : { columns: {} };
  return ExportColumnsSchema.parse({
    ...configRaw,
    columns: { ...defaults, ...(configRaw.columns || {}) },
  });
}

// REQ-REP-B23: CSV
r.get("/export/csv", requirePermission("reports", "manage"), exportLimiter, async (req: AuthedRequest, res) => {
  try {
    const entries = await getEntriesForExport(req);
    const config = parseExportConfig(req, CSV_EXCEL_DEFAULT_COLUMNS);
    const buffer = await ExportService.generateCSV(entries, config);

    await prisma.auditLog.create({
      data: { userId: req.userId!, action: "REPORT_EXPORT_CSV", metadata: { count: entries.length } },
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="report-${Date.now()}.csv"`);
    res.send(buffer);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// REQ-REP-B24: Excel
r.get("/export/excel", requirePermission("reports", "manage"), exportLimiter, async (req: AuthedRequest, res) => {
  try {
    const entries = await getEntriesForExport(req);
    const config = parseExportConfig(req, CSV_EXCEL_DEFAULT_COLUMNS);
    const buffer = await ExportService.generateExcel(entries, config);

    await prisma.auditLog.create({
      data: { userId: req.userId!, action: "REPORT_EXPORT_EXCEL", metadata: { count: entries.length } },
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="report-${Date.now()}.xlsx"`);
    res.send(buffer);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// REQ-REP-B22: PDF
r.get("/export/pdf", requirePermission("reports", "manage"), exportLimiter, async (req: AuthedRequest, res) => {
  try {
    const entries = await getEntriesForExport(req);
    const config = parseExportConfig(req, PDF_DEFAULT_COLUMNS);
    const buffer = await ExportService.generatePDF(entries, config);

    await prisma.auditLog.create({
      data: { userId: req.userId!, action: "REPORT_EXPORT_PDF", metadata: { count: entries.length } },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="report-${Date.now()}.pdf"`);
    res.send(buffer);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// REQ-REP-B29..B33: Filter data endpoints
r.get("/filters/team", async (req: AuthedRequest, res) => {
  try {
    const search = (req.query.search as string) || "";
    const status = (req.query.status as string) || "active";
    const where: any = {};
    if (status !== "all") where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }
    const users = await prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, status: true },
      orderBy: { name: "asc" },
      take: 100,
    });
    const groups = await prisma.group.findMany({
      where: search ? { name: { contains: search, mode: "insensitive" } } : {},
      include: { members: true },
    });
    res.json({ users, groups });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

r.get("/filters/clients", async (req: AuthedRequest, res) => {
  try {
    const search = (req.query.search as string) || "";
    const status = (req.query.status as string) || "active";
    const where: any = {};
    if (status !== "all") where.status = status;
    if (search) where.name = { contains: search, mode: "insensitive" };
    const clients = await prisma.client.findMany({
      where,
      orderBy: { name: "asc" },
    });
    res.json(clients);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

r.get("/filters/projects", async (req: AuthedRequest, res) => {
  try {
    const search = (req.query.search as string) || "";
    const status = (req.query.status as string) || "active";
    const where: any = {};
    if (status !== "all") where.status = status.toUpperCase();
    if (search) where.name = { contains: search, mode: "insensitive" };
    const projects = await prisma.project.findMany({
      where,
      include: { client: true },
      orderBy: { name: "asc" },
    });
    res.json(projects);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

r.get("/filters/tasks", async (req: AuthedRequest, res) => {
  try {
    const search = (req.query.search as string) || "";
    const status = (req.query.status as string) || "active";
    const where: any = {};
    if (status !== "all") where.status = status;
    if (search) where.name = { contains: search, mode: "insensitive" };
    const tasks = await prisma.task.findMany({
      where,
      include: { project: { include: { client: true } } },
      orderBy: { name: "asc" },
      take: 500,
    });
    res.json(tasks);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

r.get("/filters/tags", async (req: AuthedRequest, res) => {
  try {
    const search = (req.query.search as string) || "";
    // Get distinct tags from time entries
    const entries = await prisma.timeEntry.findMany({
      select: { tags: true },
      take: 1000,
    });
    const tagSet = new Set<string>();
    entries.forEach((e) => e.tags.forEach((t) => tagSet.add(t)));
    let tags = Array.from(tagSet).sort();
    if (search) {
      tags = tags.filter((t) => t.toLowerCase().includes(search.toLowerCase()));
    }
    res.json(tags);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default r;
