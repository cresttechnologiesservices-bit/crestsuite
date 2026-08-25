import { Router } from "express";
import { requireAuth, AuthedRequest } from "../../middleware/auth";
import { NotificationService, NOTIFICATION_TYPES } from "./service";
import { prisma } from "../../lib/prisma";
import { z } from "zod";

const r = Router();
r.use(requireAuth);

// I9: notification feed for the bell dropdown. Returns the user's recent
// notifications plus, for admins/owners, the workspace's pending invitations
// (users invited but not yet active).
r.get("/", async (req: AuthedRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user) return res.status(404).json({ error: "not_found" });

    const notifications = await prisma.notification.findMany({
      where: { userId: req.userId! },
      orderBy: { sentAt: "desc" },
      take: 20,
      select: { id: true, type: true, subject: true, body: true, sentAt: true, delivered: true },
    });

    let pendingInvites: { id: string; email: string; name: string; invitedAt: Date | null }[] = [];
    if (user.role === "ADMIN" || user.role === "OWNER") {
      pendingInvites = await prisma.user.findMany({
        where: { status: "invited" },
        select: { id: true, email: true, name: true, invitedAt: true },
        orderBy: { invitedAt: "desc" },
      });
    }

    res.json({ notifications, pendingInvites });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-ACC-B06: Get notification preferences
r.get("/preferences", async (req: AuthedRequest, res) => {
  try {
    const prefs = await NotificationService.getPreferences(req.userId!);
    res.json(prefs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-ACC-B06: Update notification preferences
r.patch("/preferences", async (req: AuthedRequest, res) => {
  try {
    const schema = z.object(
      Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, z.boolean().optional()]))
    );
    const body = schema.parse(req.body);
    const prefs = await NotificationService.updatePreferences(req.userId!, body);
    res.json(prefs);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "validation", details: error.flatten() });
    }
    res.status(400).json({ error: error.message });
  }
});

// Get available notification types
r.get("/types", async (_req, res) => {
  res.json(NOTIFICATION_TYPES);
});

export default r;
