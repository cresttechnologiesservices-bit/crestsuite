import { prisma } from "../../lib/prisma";
import { sendInviteEmail } from "../../lib/mail";
import crypto from "node:crypto";

export class TeamService {
  /**
   * REQ-TEAM-B02: List members with filters
   */
  static async listMembers(filters: {
    status?: string;
    role?: string[];
    groupIds?: string[];
    search?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    page?: number;
    pageSize?: number;
  }) {
    const where: any = {};
    if (filters.status && filters.status !== "all") {
      where.status = filters.status;
    }

    if (filters.role && filters.role.length > 0) {
      where.role = { in: filters.role };
    }

    if (filters.groupIds && filters.groupIds.length > 0) {
      where.groupMembers = { some: { groupId: { in: filters.groupIds } } };
    }

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { email: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    const orderBy: any = {};
    if (filters.sortBy === "email") orderBy.email = filters.sortOrder || "asc";
    else orderBy.name = filters.sortOrder || "asc";

    const page = filters.page || 1;
    // Cap large enough that exportMembers (pageSize 10000) is not truncated
    const pageSize = Math.min(filters.pageSize || 50, 10000);

    const [members, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          groupMembers: { include: { group: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return {
      members: members.map((m: any) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
        status: m.status,
        billableRate: m.billableRate ? Number(m.billableRate) : null,
        groups: m.groupMembers.map((gm: any) => ({ id: gm.group.id, name: gm.group.name })),
        avatarUrl: m.avatarUrl,
        invitedAt: m.invitedAt?.toISOString(),
        deactivatedAt: m.deactivatedAt?.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * REQ-TEAM-B01: Invite a new member
   */
  static async inviteMember(email: string, inviterId: string) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.status === "active") throw new Error("User already exists and is active");
      if (existing.status === "invited") throw new Error("User already invited");
    }
    const inviteToken = crypto.randomBytes(32).toString("hex");

    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { status: "invited", invitedAt: new Date(), deactivatedAt: null },
      });
    } else {
      await prisma.user.create({
        data: {
          email,
          name: email.split("@")[0],
          status: "invited",
          invitedAt: new Date(),
        },
      });
    }

    // B5: dispatch the invitation email asynchronously so the invite request
    // never blocks (or fails) on the SMTP transport, and log delivery errors
    // instead of silently swallowing them.
    setImmediate(() => {
      sendInviteEmail(email, inviteToken).catch((e) =>
        console.error(`Failed to send invitation email to ${email}`, e)
      );
    });

    await prisma.auditLog.create({
      data: {
        userId: inviterId,
        action: "TEAM_MEMBER_INVITED",
        metadata: { email },
      },
    });

    return { email, status: "invited" };
  }

  /**
   * REQ-TEAM-B04: Update member's billable rate
   */
  static async updateBillableRate(memberId: string, rate: number, actorId: string) {
    if (rate < 0) throw new Error("Billable rate must be non-negative");
    const member = await prisma.user.update({
      where: { id: memberId },
      data: { billableRate: rate },
    });

    await prisma.auditLog.create({
      data: {
        userId: actorId,
        action: "MEMBER_BILLABLE_RATE_UPDATED",
        target: memberId,
        metadata: { rate },
      },
    });

    return member;
  }

  /**
   * REQ-TEAM-B05: Assign roles to member
   */
  static async assignRoles(memberId: string, roles: string[], actorId: string) {
    // For simplicity, we use the first role as primary (in production, support multi-role)
    const role = roles[0] || "MEMBER";
    if (!["OWNER", "ADMIN", "MANAGER", "MEMBER"].includes(role)) {
      throw new Error("Invalid role");
    }
    const member = await prisma.user.update({
      where: { id: memberId },
      data: { role: role as any },
    });

    await prisma.auditLog.create({
      data: {
        userId: actorId,
        action: "MEMBER_ROLE_ASSIGNED",
        target: memberId,
        metadata: { roles },
      },
    });

    return member;
  }

  /**
   * REQ-TEAM-B06: Assign member to groups
   */
  static async assignGroups(memberId: string, groupIds: string[], actorId: string) {
    // Remove existing group memberships
    await prisma.groupMember.deleteMany({ where: { userId: memberId } });
    // Add new memberships
    if (groupIds.length > 0) {
      await prisma.groupMember.createMany({
        data: groupIds.map((groupId) => ({ groupId, userId: memberId })),
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: actorId,
        action: "MEMBER_GROUPS_ASSIGNED",
        target: memberId,
        metadata: { groupIds },
      },
    });

    return { memberId, groupIds };
  }

  /**
   * REQ-TEAM-B14: Deactivate member
   */
  static async deactivateMember(memberId: string, actorId: string) {
    // REQ-TEAM-B17: Prevent self-deactivation
    if (memberId === actorId) {
      throw new Error("Cannot deactivate your own account");
    }
    const member = await prisma.user.findUnique({ where: { id: memberId } });
    if (!member) throw new Error("Member not found");

    // Prevent deactivating sole owner
    if (member.role === "OWNER") {
      const ownerCount = await prisma.user.count({ where: { role: "OWNER", status: "active" } });
      if (ownerCount <= 1) {
        throw new Error("Cannot deactivate the sole workspace owner");
      }
    }

    await prisma.user.update({
      where: { id: memberId },
      data: { status: "inactive", deactivatedAt: new Date() },
    });

    // Invalidate sessions
    await prisma.session.deleteMany({ where: { userId: memberId } });

    await prisma.auditLog.create({
      data: {
        userId: actorId,
        action: "MEMBER_DEACTIVATED",
        target: memberId,
      },
    });

    return { id: memberId, status: "inactive" };
  }

  /**
   * REQ-TEAM-B15: Reactivate member
   */
  static async reactivateMember(memberId: string, actorId: string) {
    await prisma.user.update({
      where: { id: memberId },
      data: { status: "active", deactivatedAt: null },
    });
    await prisma.auditLog.create({
      data: {
        userId: actorId,
        action: "MEMBER_REACTIVATED",
        target: memberId,
      },
    });

    return { id: memberId, status: "active" };
  }

  /**
   * REQ-TEAM-B09: Bulk deactivate members
   */
  static async bulkDeactivate(memberIds: string[], actorId: string) {
    const results: { id: string; success: boolean; error?: string }[] = [];
    for (const memberId of memberIds) {
      try {
        await this.deactivateMember(memberId, actorId);
        results.push({ id: memberId, success: true });
      } catch (error: any) {
        results.push({ id: memberId, success: false, error: error.message });
      }
    }

    return results;
  }

  /**
   * REQ-TEAM-B18: List groups with search
   */
  static async listGroups(search?: string) {
    const where: any = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { members: { some: { user: { name: { contains: search, mode: "insensitive" } } } } },
          ],
        }
      : {};
    const groups = await prisma.group.findMany({
      where,
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
      orderBy: { name: "asc" },
    });

    return groups.map((g: any) => ({
      id: g.id,
      name: g.name,
      memberCount: g.members.length,
      members: g.members.map((m: any) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
      })),
    }));
  }

  /**
   * REQ-TEAM-B19: Create a group
   */
  static async createGroup(name: string, actorId: string) {
    if (!name || name.trim().length === 0) {
      throw new Error("Group name cannot be empty");
    }
    if (name.length > 100) {
      throw new Error("Group name too long");
    }
    try {
      const group = await prisma.group.create({ data: { name: name.trim() } });

      await prisma.auditLog.create({
        data: {
          userId: actorId,
          action: "GROUP_CREATED",
          target: group.id,
          metadata: { name: group.name },
        },
      });

      return group;
    } catch (error: any) {
      if (error.code === "P2002") {
        throw new Error("Group name already exists");
      }
      throw error;
    }
  }

  /**
   * REQ-TEAM-B22: Rename group
   */
  static async renameGroup(groupId: string, name: string, actorId: string) {
    try {
      const group = await prisma.group.update({
        where: { id: groupId },
        data: { name: name.trim() },
      });
      await prisma.auditLog.create({
        data: {
          userId: actorId,
          action: "GROUP_RENAMED",
          target: groupId,
          metadata: { name: group.name },
        },
      });
      return group;
    } catch (error: any) {
      if (error.code === "P2002") {
        throw new Error("Group name already exists");
      }
      throw error;
    }
  }

  /**
   * REQ-TEAM-B23: Delete group
   */
  static async deleteGroup(groupId: string, actorId: string) {
    await prisma.group.delete({ where: { id: groupId } });
    await prisma.auditLog.create({
      data: {
        userId: actorId,
        action: "GROUP_DELETED",
        target: groupId,
      },
    });

    return { deleted: true };
  }

  /**
   * REQ-TEAM-B04: Add a single member to a group (group-centric edit)
   */
  static async addGroupMember(groupId: string, userId: string, actorId: string) {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new Error("Group not found");
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("User not found");

    await prisma.groupMember.upsert({
      where: { groupId_userId: { groupId, userId } },
      update: {},
      create: { groupId, userId },
    });

    await prisma.auditLog.create({
      data: {
        userId: actorId,
        action: "GROUP_MEMBER_ADDED",
        target: groupId,
        metadata: { userId },
      },
    });

    return { groupId, userId };
  }

  /**
   * REQ-TEAM-B04: Remove a single member from a group (group-centric edit)
   */
  static async removeGroupMember(groupId: string, userId: string, actorId: string) {
    await prisma.groupMember.deleteMany({ where: { groupId, userId } });

    await prisma.auditLog.create({
      data: {
        userId: actorId,
        action: "GROUP_MEMBER_REMOVED",
        target: groupId,
        metadata: { userId },
      },
    });

    return { groupId, userId };
  }

  /**
   * REQ-TEAM-B03: Export members as CSV data
   */
  static async exportMembers(filters: any) {
    const { members } = await this.listMembers({ ...filters, pageSize: 10000 });
    return members;
  }
}
