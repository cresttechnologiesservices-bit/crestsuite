import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requirePermission } from "../../middleware/permissions";
import { saveValues, valuesForRecord } from "../customFields/service";
import { getWorkspaceSettings } from "../../lib/workspaceSettings";
import { requireAuth, AuthedRequest } from "../../middleware/auth";

const r = Router();
r.use(requireAuth);

type ProjectTotals = {
  trackedHours: number;
  billableHours: number;
  nonBillableHours: number;
  amount: number;
};

// Sum completed time-entry durations (hours) per project, split by billable flag.
async function computeTotals(projectIds: string[]): Promise<Map<string, ProjectTotals>> {
  const totals = new Map<string, ProjectTotals>();
  if (projectIds.length === 0) return totals;
  const entries = await prisma.timeEntry.findMany({
    where: { projectId: { in: projectIds }, end: { not: null } },
    select: { projectId: true, start: true, end: true, billable: true },
  });
  for (const e of entries) {
    if (!e.projectId || !e.end) continue;
    const hours = (e.end.getTime() - e.start.getTime()) / 3600000;
    const t = totals.get(e.projectId) ?? { trackedHours: 0, billableHours: 0, nonBillableHours: 0, amount: 0 };
    t.trackedHours += hours;
    if (e.billable) t.billableHours += hours;
    else t.nonBillableHours += hours;
    totals.set(e.projectId, t);
  }
  return totals;
}

function progressOf(project: { estimateType: string; estimateValue: Prisma.Decimal | null }, totals: ProjectTotals): number | null {
  const estimate = project.estimateValue ? Number(project.estimateValue) : 0;
  if (project.estimateType === "time" && estimate > 0) return Math.min(100, (totals.trackedHours / estimate) * 100);
  if (project.estimateType === "fixed_fee" && estimate > 0) return Math.min(100, (totals.amount / estimate) * 100);
  return null;
}

function buildListWhere(query: Record<string, unknown>): Prisma.ProjectWhereInput {
  const status = ((query.status as string) ?? "active").toLowerCase();
  // B14: trim the search term — an accidental leading/trailing space (or a
  // copy-pasted name with whitespace) made `contains` match nothing.
  const search = ((query.search as string) ?? "").trim();
  const clients = query.clients ? (query.clients as string).split(",").filter(Boolean) : [];
  const withoutClient = query.without_client === "true";
  const access = query.access ? (query.access as string).split(",").filter(Boolean) : [];
  const billing = query.billing ? (query.billing as string).split(",").filter(Boolean) : [];
  // I21/I22: filter to projects that have any of these users as members
  const memberIds = query.members ? (query.members as string).split(",").filter(Boolean) : [];

  const where: Prisma.ProjectWhereInput = {};
  if (status !== "all") where.status = status.toUpperCase() as "ACTIVE" | "ARCHIVED";
  if (search) where.name = { contains: search, mode: "insensitive" };
  if (clients.length > 0 || withoutClient) {
    const clientOr: Prisma.ProjectWhereInput[] = [];
    if (clients.length > 0) clientOr.push({ clientId: { in: clients } });
    if (withoutClient) clientOr.push({ clientId: null });
    where.OR = clientOr;
  }
  if (access.length === 1) where.visibility = access[0];
  if (billing.length === 1) where.billableDefault = billing[0] === "billable";
  if (memberIds.length > 0) where.members = { some: { userId: { in: memberIds } } };
  return where;
}

async function listProjects(query: Record<string, unknown>) {
  const projects = await prisma.project.findMany({
    where: buildListWhere(query),
    include: { client: true, members: { include: { user: { select: { id: true, name: true } } } } },
    orderBy: { name: "asc" },
  });
  const totals = await computeTotals(projects.map((p) => p.id));
  const empty: ProjectTotals = { trackedHours: 0, billableHours: 0, nonBillableHours: 0, amount: 0 };
  const enriched = projects.map((p) => {
    const t = { ...(totals.get(p.id) ?? empty) };
    t.amount = p.hourlyRate ? t.billableHours * Number(p.hourlyRate) : 0;
    return {
      ...p,
      hourlyRate: p.hourlyRate ? Number(p.hourlyRate) : null,
      estimateValue: p.estimateValue ? Number(p.estimateValue) : null,
      trackedHours: t.trackedHours,
      billableHours: t.billableHours,
      nonBillableHours: t.nonBillableHours,
      amount: t.amount,
      progress: progressOf(p, t),
    };
  });

  const sortBy = (query.sort_by as string) ?? "name";
  const sortOrder = (query.sort_order as string) === "desc" ? -1 : 1;
  enriched.sort((a, b) => {
    const val = (p: (typeof enriched)[number]) => {
      switch (sortBy) {
        case "client": return p.client?.name?.toLowerCase() ?? "";
        case "tracked": return p.trackedHours;
        case "amount": return p.amount;
        case "progress": return p.progress ?? -1;
        default: return p.name.toLowerCase();
      }
    };
    const av = val(a);
    const bv = val(b);
    if (av < bv) return -sortOrder;
    if (av > bv) return sortOrder;
    return 0;
  });
  return enriched;
}

// REQ-PROJ-B14/B16/B17: filtered, sorted, paginated project list with computed totals
r.get("/", async (req: AuthedRequest, res) => {
  const enriched = await listProjects(req.query as Record<string, unknown>);
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.max(1, Math.min(200, Number(req.query.page_size ?? 50)));
  const start = (page - 1) * pageSize;
  res.json({ items: enriched.slice(start, start + pageSize), total: enriched.length, page, pageSize });
});

// REQ-PROJ-B15: CSV export of the current filtered list
r.get("/export", async (req: AuthedRequest, res) => {
  const enriched = await listProjects(req.query as Record<string, unknown>);
  const headers = ["Name", "Client", "Tracked", "Amount", "Progress", "Access"];
  const rows = enriched.map((p) => [
    p.name,
    p.client?.name ?? "",
    p.trackedHours.toFixed(2),
    p.amount.toFixed(2),
    p.progress === null ? "-" : `${p.progress.toFixed(0)}%`,
    p.visibility,
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="projects-${Date.now()}.csv"`);
  res.send(csv);
});

// Active workspace users for member/assignee pickers
r.get("/meta/users", async (_req: AuthedRequest, res) => {
  const users = await prisma.user.findMany({
    where: { status: "active" },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  res.json(users);
});

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(255),
  clientId: z.string().optional().nullable(),
  color: z.string().optional(),
  visibility: z.enum(["private", "public"]).optional(),
  billableDefault: z.boolean().optional(),
  estimateType: z.enum(["none", "time", "fixed_fee"]).optional(),
  estimateValue: z.number().min(0).optional().nullable(),
  customFields: z.record(z.any()).optional(),
});

// REQ-PROJ-B01/B04/B05/B06: create project with validation and 409 on duplicate name
r.post("/", requirePermission("projects", "create"), async (req: AuthedRequest, res) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const body = parsed.data;
  try {
    // Workspace defaults apply only to NEW projects and only when the caller
    // did not choose explicitly; existing projects are never touched.
    const settings = await getWorkspaceSettings();
    const project = await prisma.project.create({
      data: {
        ...body,
        customFields: undefined,
        clientId: body.clientId || null,
        visibility: body.visibility ?? (settings.defaultProjectPublic ? "public" : "private"),
        billableDefault: body.billableDefault ?? settings.defaultBillable,
        // Workspace billable rate seeds the project rate; per-project rates
        // set later in project settings take precedence from then on.
        hourlyRate: settings.billableRate != null ? settings.billableRate : undefined,
      } as any,
    });
    const role = (await prisma.user.findUnique({ where: { id: req.userId! } }))?.role ?? "MEMBER";
    const cf = await saveValues("project", project.id, (body as any).customFields ?? {}, role, {
      enforceRequired: true,
    });
    if (!cf.ok) {
      await prisma.project.delete({ where: { id: project.id } });
      return res.status(400).json({ error: "custom_field_validation", errors: cf.errors });
    }
    res.status(201).json(project);
  } catch (e: any) {
    if (e.code === "P2002") return res.status(409).json({ error: "duplicate_name" });
    throw e;
  }
});

// REQ-PROJ-B07: full project detail
r.get("/:id", requirePermission("projects", "view"), async (req: AuthedRequest, res) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: {
      client: true,
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
      tasks: true,
    },
  });
  if (!project) return res.status(404).json({ error: "not_found" });
  // Custom field values configured for projects
  const role = (await prisma.user.findUnique({ where: { id: req.userId! } }))?.role ?? "MEMBER";
  const customFields = await valuesForRecord("project", project.id, role);
  res.json({ ...project, customFields });
});

const UpdateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  clientId: z.string().nullable().optional(),
  color: z.string().optional(),
  visibility: z.enum(["private", "public"]).optional(),
  billableDefault: z.boolean().optional(),
  hourlyRate: z.number().min(0).nullable().optional(),
  estimateType: z.enum(["none", "time", "fixed_fee"]).optional(),
  estimateValue: z.number().min(0).nullable().optional(),
});

// REQ-PROJ-B08/B20/B21: update settings (name, client, color, visibility, billable, rate, estimate)
r.patch("/:id", requirePermission("projects", "edit"), async (req: AuthedRequest, res) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  try {
    const updated = await prisma.project.update({ where: { id: req.params.id }, data: parsed.data });
    res.json(updated);
  } catch (e: any) {
    if (e.code === "P2002") return res.status(409).json({ error: "duplicate_name" });
    if (e.code === "P2025") return res.status(404).json({ error: "not_found" });
    throw e;
  }
});

// REQ-PROJ-B19: archive (data retained)
r.post("/:id/archive", requirePermission("projects", "edit"), async (req: AuthedRequest, res) => {
  await prisma.project.update({ where: { id: req.params.id }, data: { status: "ARCHIVED" } });
  res.json({ ok: true });
});

r.post("/:id/restore", requirePermission("projects", "edit"), async (req: AuthedRequest, res) => {
  await prisma.project.update({ where: { id: req.params.id }, data: { status: "ACTIVE" } });
  res.json({ ok: true });
});

r.delete("/:id", requirePermission("projects", "delete"), async (req: AuthedRequest, res) => {
  const entries = await prisma.timeEntry.count({ where: { projectId: req.params.id } });
  if (entries > 0) return res.status(409).json({ error: "project_has_time_entries" });
  await prisma.project.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// REQ-PROJ-B24/B25/B12: status metrics + per-task tracked hours
r.get("/:id/status", async (req: AuthedRequest, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id }, include: { tasks: true } });
  if (!project) return res.status(404).json({ error: "not_found" });
  const entries = await prisma.timeEntry.findMany({
    where: { projectId: project.id, end: { not: null } },
    select: { taskId: true, start: true, end: true, billable: true },
  });
  let billableHours = 0;
  let nonBillableHours = 0;
  const perTask = new Map<string, number>();
  for (const e of entries) {
    const hours = (e.end!.getTime() - e.start.getTime()) / 3600000;
    if (e.billable) billableHours += hours;
    else nonBillableHours += hours;
    if (e.taskId) perTask.set(e.taskId, (perTask.get(e.taskId) ?? 0) + hours);
  }
  const trackedHours = billableHours + nonBillableHours;
  const amount = project.hourlyRate ? billableHours * Number(project.hourlyRate) : 0;
  res.json({
    trackedHours,
    billableHours,
    nonBillableHours,
    amount,
    tasks: project.tasks.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      assignees: t.assignees,
      trackedHours: perTask.get(t.id) ?? 0,
    })),
  });
});

// REQ-PROJ-B27/B31: task list with status filter, search, sort
r.get("/:id/tasks", async (req: AuthedRequest, res) => {
  const status = ((req.query.status as string) ?? "active").toLowerCase();
  const search = (req.query.search as string) ?? "";
  const sortOrder = (req.query.sort_order as string) === "desc" ? "desc" : "asc";
  const tasks = await prisma.task.findMany({
    where: {
      projectId: req.params.id,
      ...(status !== "all" ? { status } : {}),
      ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
    },
    orderBy: { name: sortOrder },
  });
  res.json(tasks);
});

// REQ-PROJ-B28: create task, unique per project
r.post("/:id/tasks", requirePermission("tasks", "create"), async (req: AuthedRequest, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(255) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
  try {
    const task = await prisma.task.create({ data: { projectId: req.params.id, name: parsed.data.name } });
    res.status(201).json(task);
  } catch (e: any) {
    if (e.code === "P2002") return res.status(409).json({ error: "duplicate_name" });
    throw e;
  }
});

// REQ-PROJ-B29/B30: edit task (name, status, assignees)
r.patch("/:id/tasks/:taskId", requirePermission("tasks", "edit"), async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(255).optional(),
      status: z.enum(["active", "done"]).optional(),
      assignees: z.array(z.string()).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
  try {
    const task = await prisma.task.update({
      where: { id: req.params.taskId },
      data: parsed.data,
    });
    res.json(task);
  } catch (e: any) {
    if (e.code === "P2002") return res.status(409).json({ error: "duplicate_name" });
    if (e.code === "P2025") return res.status(404).json({ error: "not_found" });
    throw e;
  }
});

r.delete("/:id/tasks/:taskId", requirePermission("tasks", "delete"), async (req: AuthedRequest, res) => {
  await prisma.task.delete({ where: { id: req.params.taskId } });
  res.status(204).end();
});

// REQ-PROJ-B09: add members to project
r.post("/:id/members", requirePermission("projects", "manage"), async (req: AuthedRequest, res) => {
  const parsed = z.object({ userIds: z.array(z.string()).min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
  await prisma.projectMember.createMany({
    data: parsed.data.userIds.map((userId) => ({ projectId: req.params.id, userId })),
    skipDuplicates: true,
  });
  const members = await prisma.projectMember.findMany({
    where: { projectId: req.params.id },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  res.status(201).json(members);
});

// REQ-PROJ-B10/B11: update member billable rate and/or role
r.patch("/:id/members/:userId", requirePermission("projects", "manage"), async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      billableRate: z.number().min(0).nullable().optional(),
      role: z.string().nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
  try {
    const member = await prisma.projectMember.update({
      where: { projectId_userId: { projectId: req.params.id, userId: req.params.userId } },
      data: parsed.data,
    });
    res.json(member);
  } catch (e: any) {
    if (e.code === "P2025") return res.status(404).json({ error: "not_found" });
    throw e;
  }
});

// REQ-PROJ-B12: remove member (time entries retained)
r.delete("/:id/members/:userId", requirePermission("projects", "manage"), async (req: AuthedRequest, res) => {
  try {
    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId: req.params.id, userId: req.params.userId } },
    });
  } catch (e: any) {
    if (e.code !== "P2025") throw e;
  }
  res.status(204).end();
});

export default r;
