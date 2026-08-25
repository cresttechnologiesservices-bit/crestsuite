import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthedRequest } from "../../middleware/auth";
import {
  ENTITIES,
  FIELD_TYPES,
  ACCESS_LEVELS,
  Entity,
  roleMeets,
  AccessLevel,
  valuesForRecord,
  saveValues,
} from "./service";

const r = Router();
r.use(requireAuth);

const ADMIN_ROLES = ["ADMIN", "OWNER"];

async function currentRole(req: AuthedRequest): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  return user?.role ?? "MEMBER";
}

/** Only admins define custom fields; everyone may read the ones they can see. */
async function requireAdmin(req: AuthedRequest, res: any, next: any) {
  if (ADMIN_ROLES.includes(await currentRole(req))) return next();
  return res.status(403).json({ error: "forbidden", message: "Only administrators can manage custom fields" });
}

const FieldSchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(FIELD_TYPES),
  entity: z.enum(ENTITIES),
  required: z.boolean().optional(),
  active: z.boolean().optional(),
  visibility: z.enum(ACCESS_LEVELS).optional(),
  editPermission: z.enum(ACCESS_LEVELS).optional(),
  allowedValues: z.array(z.string().trim().min(1)).max(100).optional(),
  defaultValue: z.any().optional(),
  placeholder: z.string().max(120).nullable().optional(),
  position: z.number().int().min(0).optional(),
});

/**
 * Select/multi-select need a value list; other types must not carry one.
 * A default must be one of the allowed values.
 */
function validateShape(body: any): string | null {
  const needsValues = body.type === "select" || body.type === "multiselect";
  const allowed: string[] = body.allowedValues ?? [];
  if (needsValues && allowed.length === 0) {
    return "Select and Multi-select fields need at least one allowed value";
  }
  if (needsValues && new Set(allowed).size !== allowed.length) {
    return "Allowed values must be unique";
  }
  const def = body.defaultValue;
  if (needsValues && def != null && def !== "") {
    const list = Array.isArray(def) ? def : [def];
    const bad = list.filter((v: any) => !allowed.includes(String(v)));
    if (bad.length) return `Default value must be one of the allowed values`;
  }
  if (body.type === "number" && def != null && def !== "" && !Number.isFinite(Number(def))) {
    return "Default value must be a number";
  }
  return null;
}

// ---- definitions ----

// Everyone sees the fields their role is allowed to see; admins see all,
// including inactive ones, so they can manage them.
r.get("/", async (req: AuthedRequest, res) => {
  const role = await currentRole(req);
  const isAdmin = ADMIN_ROLES.includes(role);
  const entity = req.query.entity as Entity | undefined;
  const fields = await prisma.customField.findMany({
    where: {
      ...(entity ? { entity } : {}),
      ...(isAdmin ? {} : { active: true }),
    },
    orderBy: [{ entity: "asc" }, { position: "asc" }, { createdAt: "asc" }],
  });
  const visible = isAdmin
    ? fields
    : fields.filter((f) => roleMeets(f.visibility as AccessLevel, role));
  res.json(
    visible.map((f) => ({
      ...f,
      editable: isAdmin || roleMeets(f.editPermission as AccessLevel, role),
    }))
  );
});

r.post("/", requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = FieldSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
  }
  const shapeError = validateShape(parsed.data);
  if (shapeError) return res.status(400).json({ error: shapeError });

  const exists = await prisma.customField.findFirst({
    where: { entity: parsed.data.entity, name: parsed.data.name },
  });
  if (exists) {
    return res.status(409).json({ error: "A field with that name already exists for this entity" });
  }
  const count = await prisma.customField.count({ where: { entity: parsed.data.entity } });
  const field = await prisma.customField.create({
    data: {
      ...parsed.data,
      allowedValues: parsed.data.allowedValues ?? [],
      defaultValue: parsed.data.defaultValue ?? undefined,
      position: parsed.data.position ?? count,
    },
  });
  await prisma.auditLog.create({
    data: { userId: req.userId!, action: "CUSTOM_FIELD_CREATE", target: field.id, metadata: { name: field.name, entity: field.entity } },
  });
  res.status(201).json(field);
});

r.patch("/:id", requireAdmin, async (req: AuthedRequest, res) => {
  const existing = await prisma.customField.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "not_found" });

  const parsed = FieldSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
  }
  const merged = { ...existing, ...parsed.data } as any;
  const shapeError = validateShape(merged);
  if (shapeError) return res.status(400).json({ error: shapeError });

  if (parsed.data.name && parsed.data.name !== existing.name) {
    const clash = await prisma.customField.findFirst({
      where: { entity: merged.entity, name: parsed.data.name, NOT: { id: existing.id } },
    });
    if (clash) return res.status(409).json({ error: "A field with that name already exists for this entity" });
  }

  const field = await prisma.customField.update({
    where: { id: existing.id },
    data: parsed.data as any,
  });
  await prisma.auditLog.create({
    data: { userId: req.userId!, action: "CUSTOM_FIELD_UPDATE", target: field.id, metadata: { fields: Object.keys(parsed.data) } },
  });
  res.json(field);
});

// Deleting a definition removes its stored values (cascade)
r.delete("/:id", requireAdmin, async (req: AuthedRequest, res) => {
  const existing = await prisma.customField.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "not_found" });
  await prisma.customField.delete({ where: { id: existing.id } });
  await prisma.auditLog.create({
    data: { userId: req.userId!, action: "CUSTOM_FIELD_DELETE", target: existing.id, metadata: { name: existing.name } },
  });
  res.status(204).end();
});

// ---- values for one record ----

r.get("/values/:entity/:entityId", async (req: AuthedRequest, res) => {
  const entity = req.params.entity as Entity;
  if (!ENTITIES.includes(entity)) return res.status(400).json({ error: "unknown entity" });
  res.json(await valuesForRecord(entity, req.params.entityId, await currentRole(req)));
});

r.put("/values/:entity/:entityId", async (req: AuthedRequest, res) => {
  const entity = req.params.entity as Entity;
  if (!ENTITIES.includes(entity)) return res.status(400).json({ error: "unknown entity" });
  const result = await saveValues(
    entity,
    req.params.entityId,
    (req.body ?? {}) as Record<string, unknown>,
    await currentRole(req)
  );
  if (!result.ok) return res.status(400).json({ error: "custom_field_validation", errors: result.errors });
  res.json(await valuesForRecord(entity, req.params.entityId, await currentRole(req)));
});

export default r;
