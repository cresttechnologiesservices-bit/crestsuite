import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../../middleware/auth";
import { TeamService } from "./service";
import { prisma } from "../../lib/prisma";
import { requirePermission } from "../../middleware/permissions";

const r = Router();
r.use(requireAuth);

// REQ-TEAM-B08: Authorization middleware - only admins/owners can manage team
const requireAdmin = async (req: AuthedRequest, res: any, next: any) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user || (user.role !== "ADMIN" && user.role !== "OWNER")) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }
  next();
};

// REQ-TEAM-B02: List members
r.get("/members", requirePermission("team", "view"), async (req: AuthedRequest, res) => {
  try {
    const filters = {
      status: req.query.status as string,
      role: req.query.role ? (req.query.role as string).split(",") : undefined,
      groupIds: req.query.group_ids ? (req.query.group_ids as string).split(",") : undefined,
      search: req.query.search as string,
      sortBy: req.query.sort_by as string,
      sortOrder: (req.query.sort_order as "asc" | "desc") || "asc",
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.page_size ?? 50),
    };
    const result = await TeamService.listMembers(filters);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-TEAM-B01: Invite member
r.post("/members/invite", requirePermission("team", "manage"), async (req: AuthedRequest, res) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const result = await TeamService.inviteMember(email, req.userId!);
    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// REQ-TEAM-B09: Bulk deactivate
r.post("/members/bulk-deactivate", requirePermission("team", "manage"), async (req: AuthedRequest, res) => {
  try {
    const { memberIds } = z.object({ memberIds: z.array(z.string()) }).parse(req.body);
    const results = await TeamService.bulkDeactivate(memberIds, req.userId!);
    res.json({ results });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// REQ-TEAM-B03: Export members
// NOTE: must be registered before "/members/:id" or ":id" swallows "export"
r.get("/members/export", requirePermission("team", "view"), async (req: AuthedRequest, res) => {
  try {
    const filters = {
      status: req.query.status as string,
      role: req.query.role ? (req.query.role as string).split(",") : undefined,
      groupIds: req.query.group_ids ? (req.query.group_ids as string).split(",") : undefined,
      search: req.query.search as string,
    };
    const members = await TeamService.exportMembers(filters);
    // Simple CSV export
    const headers = ["Name", "Email", "Role", "Status", "Billable Rate", "Groups"];
    const rows = members.map((m: any) => [
      m.name,
      m.email,
      m.role,
      m.status,
      m.billableRate ?? "",
      m.groups.map((g: any) => g.name).join("; "),
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="team-members-${Date.now()}.csv"`);
    res.send(csv);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-TEAM-B12: Get member profile
r.get("/members/:id", requirePermission("team", "view"), async (req: AuthedRequest, res) => {
  try {
    const member = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { groupMembers: { include: { group: true } } },
    });
    if (!member) return res.status(404).json({ error: "Member not found" });
    res.json({
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      status: member.status,
      billableRate: member.billableRate ? Number(member.billableRate) : null,
      groups: member.groupMembers.map((gm: any) => ({ id: gm.group.id, name: gm.group.name })),
      avatarUrl: member.avatarUrl,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-TEAM-B13: Update member profile
r.put("/members/:id", requirePermission("team", "manage"), async (req: AuthedRequest, res) => {
  try {
    const schema = z.object({
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
      billableRate: z.number().min(0).optional(),
    });
    const body = schema.parse(req.body);
    const member = await prisma.user.update({
      where: { id: req.params.id },
      data: body,
    });

    // REQ-TEAM-B16: Audit trail
    await prisma.auditLog.create({
      data: {
        userId: req.userId!,
        action: "MEMBER_PROFILE_UPDATED",
        target: req.params.id,
        metadata: body,
      },
    });

    res.json(member);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// REQ-TEAM-B04: Update billable rate
r.patch("/members/:id/billable-rate", requirePermission("team", "manage"), async (req: AuthedRequest, res) => {
  try {
    const { rate } = z.object({ rate: z.number().min(0) }).parse(req.body);
    const member = await TeamService.updateBillableRate(req.params.id, rate, req.userId!);
    res.json(member);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// REQ-TEAM-B05: Assign roles
r.post("/members/:id/roles", requirePermission("team", "manage"), async (req: AuthedRequest, res) => {
  try {
    const { roles } = z.object({ roles: z.array(z.string()) }).parse(req.body);
    const member = await TeamService.assignRoles(req.params.id, roles, req.userId!);
    res.json(member);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// REQ-TEAM-B06: Assign groups
r.post("/members/:id/groups", requirePermission("team", "manage"), async (req: AuthedRequest, res) => {
  try {
    const { groupIds } = z.object({ groupIds: z.array(z.string()) }).parse(req.body);
    const result = await TeamService.assignGroups(req.params.id, groupIds, req.userId!);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// REQ-TEAM-B14: Deactivate member
r.post("/members/:id/deactivate", requirePermission("team", "manage"), async (req: AuthedRequest, res) => {
  try {
    const result = await TeamService.deactivateMember(req.params.id, req.userId!);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// REQ-TEAM-B15: Reactivate member
r.post("/members/:id/reactivate", requirePermission("team", "manage"), async (req: AuthedRequest, res) => {
  try {
    const result = await TeamService.reactivateMember(req.params.id, req.userId!);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// REQ-TEAM-B07: Get member's roles and groups
r.get("/members/:id/roles", requirePermission("team", "view"), async (req: AuthedRequest, res) => {
  try {
    const member = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { role: true },
    });
    if (!member) return res.status(404).json({ error: "Member not found" });
    res.json({ roles: [member.role] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

r.get("/members/:id/groups", requirePermission("team", "view"), async (req: AuthedRequest, res) => {
  try {
    const memberships = await prisma.groupMember.findMany({
      where: { userId: req.params.id },
      include: { group: true },
    });
    res.json(memberships.map((m: any) => ({ id: m.group.id, name: m.group.name })));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-TEAM-B18: List groups
r.get("/groups", async (req: AuthedRequest, res) => {
  try {
    const search = req.query.search as string;
    const groups = await TeamService.listGroups(search);
    res.json(groups);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-TEAM-B19: Create group
r.post("/groups", requirePermission("team", "manage"), async (req: AuthedRequest, res) => {
  try {
    const { name } = z.object({ name: z.string().min(1).max(100) }).parse(req.body);
    const group = await TeamService.createGroup(name, req.userId!);
    res.status(201).json(group);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// REQ-TEAM-B22: Rename group
r.patch("/groups/:id", requirePermission("team", "manage"), async (req: AuthedRequest, res) => {
  try {
    const { name } = z.object({ name: z.string().min(1).max(100) }).parse(req.body);
    const group = await TeamService.renameGroup(req.params.id, name, req.userId!);
    res.json(group);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// REQ-TEAM-B23: Delete group
r.delete("/groups/:id", requirePermission("team", "manage"), async (req: AuthedRequest, res) => {
  try {
    const result = await TeamService.deleteGroup(req.params.id, req.userId!);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// REQ-TEAM-B04: Add member to a group (group-centric edit)
r.post("/groups/:id/members", requirePermission("team", "manage"), async (req: AuthedRequest, res) => {
  try {
    const { userId } = z.object({ userId: z.string().min(1) }).parse(req.body);
    const result = await TeamService.addGroupMember(req.params.id, userId, req.userId!);
    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// REQ-TEAM-B04: Remove member from a group (group-centric edit)
r.delete("/groups/:id/members/:userId", requirePermission("team", "manage"), async (req: AuthedRequest, res) => {
  try {
    const result = await TeamService.removeGroupMember(req.params.id, req.params.userId, req.userId!);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default r;
