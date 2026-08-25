import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requirePermission } from "../../middleware/permissions";
import { requireAuth } from "../../middleware/auth";

const r = Router();
r.use(requireAuth);

// REQ-CLI-B02/B03/B07/B16: list clients with status filter and case-insensitive search
r.get("/", requirePermission("clients", "view"), async (req, res) => {
  const status = ((req.query.status as string) ?? "active").toLowerCase();
  const search = (req.query.search as string) ?? "";
  const clients = await prisma.client.findMany({
    where: {
      ...(status !== "all" ? { status } : {}),
      ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
    },
    orderBy: { name: "asc" },
  });
  res.json(clients);
});

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(255),
  address: z.string().max(1000).optional(),
  currency: z.string().length(3).toUpperCase().default("USD"),
});

// REQ-CLI-B04/B05/B06: create client, 400 on invalid, 409 on duplicate name
r.post("/", requirePermission("clients", "create"), async (req, res) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  try {
    const client = await prisma.client.create({ data: parsed.data });
    res.status(201).json(client);
  } catch (e: any) {
    if (e.code === "P2002") return res.status(409).json({ error: "duplicate_name" });
    throw e;
  }
});

const UpdateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  address: z.string().max(1000).nullable().optional(),
  currency: z.string().length(3).toUpperCase().optional(),
});

// REQ-CLI-B11/B12: update name/address/currency, 409 on name conflict
r.patch("/:id", requirePermission("clients", "edit"), async (req, res) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  try {
    const client = await prisma.client.update({ where: { id: req.params.id }, data: parsed.data });
    res.json(client);
  } catch (e: any) {
    if (e.code === "P2002") return res.status(409).json({ error: "duplicate_name" });
    if (e.code === "P2025") return res.status(404).json({ error: "not_found" });
    throw e;
  }
});

// REQ-CLI-B13/B15: archive / restore (historical associations retained)
r.post("/:id/archive", requirePermission("clients", "edit"), async (req, res) => {
  try {
    const client = await prisma.client.update({ where: { id: req.params.id }, data: { status: "archived" } });
    res.json(client);
  } catch (e: any) {
    if (e.code === "P2025") return res.status(404).json({ error: "not_found" });
    throw e;
  }
});

r.post("/:id/restore", requirePermission("clients", "edit"), async (req, res) => {
  try {
    const client = await prisma.client.update({ where: { id: req.params.id }, data: { status: "active" } });
    res.json(client);
  } catch (e: any) {
    if (e.code === "P2025") return res.status(404).json({ error: "not_found" });
    throw e;
  }
});

// REQ-CLI-B08: bulk archive
r.post("/bulk-archive", requirePermission("clients", "edit"), async (req, res) => {
  const parsed = z.object({ ids: z.array(z.string()).min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
  await prisma.client.updateMany({ where: { id: { in: parsed.data.ids } }, data: { status: "archived" } });
  res.json({ ok: true });
});

// REQ-CLI-B13/B14: delete, blocked when client has associated projects
r.delete("/:id", requirePermission("clients", "delete"), async (req, res) => {
  const used = await prisma.project.count({ where: { clientId: req.params.id } });
  if (used > 0) return res.status(409).json({ error: "client_in_use", projects: used });
  try {
    await prisma.client.delete({ where: { id: req.params.id } });
  } catch (e: any) {
    if (e.code === "P2025") return res.status(404).json({ error: "not_found" });
    throw e;
  }
  res.status(204).end();
});

export default r;
