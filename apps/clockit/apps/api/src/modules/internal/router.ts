import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import env from "../../config";

/**
 * Server-to-server endpoints for the CrestSuite portal. Not for browsers:
 * the portal proxy refuses to forward /api/internal, and every request must
 * carry the shared PORTAL_SECRET.
 */
const r = Router();

r.use((req, res, next) => {
  const secret = req.header("x-internal-secret");
  if (!secret || secret !== env.PORTAL_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

const DirectorySchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  // Directory roles, which own the mapping into ClockIT's own role names
  role: z.enum(["admin", "manager", "employee", "owner"]).optional(),
  active: z.boolean().optional(),
});

const ROLE_MAP: Record<string, "OWNER" | "ADMIN" | "MANAGER" | "MEMBER"> = {
  owner: "OWNER",
  admin: "ADMIN",
  manager: "MANAGER",
  employee: "MEMBER",
};

/**
 * Apply a User Management edit to the matching ClockIT account so Team →
 * Members shows the same name, role and status as the directory. Users ClockIT
 * has never seen are ignored — they are created on first sign-in.
 */
r.post("/directory-sync", async (req, res) => {
  const body = DirectorySchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
  if (!user) return res.json({ updated: false, reason: "no_clockit_account" });

  const data: Record<string, unknown> = {};
  if (body.name && body.name !== user.name) data.name = body.name;
  if (body.role) {
    const mapped = ROLE_MAP[body.role];
    if (mapped && mapped !== user.role) data.role = mapped;
  }
  if (body.active !== undefined) {
    const status = body.active ? "active" : "inactive";
    if (status !== user.status) data.status = status;
  }
  if (Object.keys(data).length === 0) return res.json({ updated: false, reason: "no_change" });

  await prisma.user.update({ where: { id: user.id }, data });
  res.json({ updated: true, fields: Object.keys(data) });
});

export default r;
