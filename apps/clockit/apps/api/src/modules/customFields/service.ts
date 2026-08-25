import { prisma } from "../../lib/prisma";

/**
 * Custom fields defined in Workspace Settings → Custom Fields.
 *
 * Definitions describe what may be captured; values are stored per record.
 * Visibility and edit permission are enforced here so the same rules apply
 * however a value arrives (tracker, timesheet, project screen or a raw API
 * call).
 */
export const ENTITIES = ["timeEntry", "project", "user"] as const;
export const FIELD_TYPES = ["text", "number", "link", "switch", "select", "multiselect"] as const;
export const ACCESS_LEVELS = ["everyone", "managers", "admins"] as const;

export type Entity = (typeof ENTITIES)[number];
export type FieldType = (typeof FIELD_TYPES)[number];
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

const ADMIN_ROLES = ["ADMIN", "OWNER"];
const MANAGER_ROLES = ["ADMIN", "OWNER", "MANAGER"];

/** Does this role satisfy the configured visibility / edit level? */
export function roleMeets(level: AccessLevel, role: string): boolean {
  if (level === "admins") return ADMIN_ROLES.includes(role);
  if (level === "managers") return MANAGER_ROLES.includes(role);
  return true;
}

export interface FieldError {
  field: string;
  message: string;
}

/**
 * Coerce and validate one incoming value against its definition.
 * Returns the value to store, or an error explaining why it was rejected.
 */
export function coerceValue(
  field: { name: string; type: string; required: boolean; allowedValues: any },
  raw: unknown
): { value: any } | { error: FieldError } {
  const allowed: string[] = Array.isArray(field.allowedValues) ? field.allowedValues : [];
  const empty =
    raw === undefined ||
    raw === null ||
    raw === "" ||
    (Array.isArray(raw) && raw.length === 0);

  if (empty) {
    if (field.required) {
      return { error: { field: field.name, message: `${field.name} is required` } };
    }
    return { value: null };
  }

  switch (field.type) {
    case "number": {
      const num = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(num)) {
        return { error: { field: field.name, message: `${field.name} must be a number` } };
      }
      return { value: num };
    }
    case "switch":
      return { value: raw === true || raw === "true" };
    case "link": {
      const text = String(raw).trim();
      if (!/^https?:\/\/\S+$/i.test(text)) {
        return {
          error: { field: field.name, message: `${field.name} must be a URL starting with http:// or https://` },
        };
      }
      return { value: text };
    }
    case "select": {
      const text = String(raw);
      if (allowed.length && !allowed.includes(text)) {
        return {
          error: { field: field.name, message: `${field.name} must be one of: ${allowed.join(", ")}` },
        };
      }
      return { value: text };
    }
    case "multiselect": {
      const list = (Array.isArray(raw) ? raw : [raw]).map((v) => String(v));
      const invalid = allowed.length ? list.filter((v) => !allowed.includes(v)) : [];
      if (invalid.length) {
        return {
          error: { field: field.name, message: `${field.name}: ${invalid.join(", ")} not allowed` },
        };
      }
      return { value: list };
    }
    default: {
      const text = String(raw);
      if (text.length > 2000) {
        return { error: { field: field.name, message: `${field.name} is too long (max 2000)` } };
      }
      return { value: text };
    }
  }
}

/** Active field definitions for an entity, ordered for display. */
export async function activeFields(entity: Entity) {
  return prisma.customField.findMany({
    where: { entity, active: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

/** Fields this role may see, with their stored values for one record. */
export async function valuesForRecord(entity: Entity, entityId: string, role: string) {
  const fields = await activeFields(entity);
  const visible = fields.filter((f) => roleMeets(f.visibility as AccessLevel, role));
  if (!visible.length) return [];
  const stored = await prisma.customFieldValue.findMany({
    where: { entityId, fieldId: { in: visible.map((f) => f.id) } },
  });
  const byField = new Map(stored.map((v) => [v.fieldId, v.value]));
  return visible.map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type,
    required: f.required,
    allowedValues: f.allowedValues,
    editable: roleMeets(f.editPermission as AccessLevel, role),
    value: byField.has(f.id) ? byField.get(f.id) : (f.defaultValue ?? null),
  }));
}

/** Same, for many records at once — used by lists, reports and exports. */
export async function valuesForRecords(entity: Entity, entityIds: string[], role: string) {
  const result = new Map<string, Record<string, any>>();
  if (!entityIds.length) return result;
  const fields = (await activeFields(entity)).filter((f) =>
    roleMeets(f.visibility as AccessLevel, role)
  );
  if (!fields.length) return result;
  const stored = await prisma.customFieldValue.findMany({
    where: { entityId: { in: entityIds }, fieldId: { in: fields.map((f) => f.id) } },
  });
  const nameById = new Map(fields.map((f) => [f.id, f.name]));
  for (const id of entityIds) result.set(id, {});
  for (const v of stored) {
    const bucket = result.get(v.entityId);
    const name = nameById.get(v.fieldId);
    if (bucket && name) bucket[name] = v.value;
  }
  return result;
}

/**
 * Validate and persist a `{ fieldId|name: value }` map for one record.
 *
 * Rejects unknown/inactive fields, values the role may not edit, and anything
 * failing type/required/allowed-value rules. Required fields missing from the
 * payload are only enforced on create, so a partial update cannot be blocked
 * by a field it does not touch.
 */
export async function saveValues(
  entity: Entity,
  entityId: string,
  incoming: Record<string, unknown>,
  role: string,
  { enforceRequired = false }: { enforceRequired?: boolean } = {}
): Promise<{ ok: true } | { ok: false; errors: FieldError[] }> {
  const fields = await activeFields(entity);
  const byId = new Map(fields.map((f) => [f.id, f]));
  const byName = new Map(fields.map((f) => [f.name.toLowerCase(), f]));
  const errors: FieldError[] = [];
  const writes: { fieldId: string; value: any }[] = [];

  for (const [key, raw] of Object.entries(incoming ?? {})) {
    const field = byId.get(key) ?? byName.get(key.toLowerCase());
    if (!field) {
      // Unknown or deactivated field — never silently stored
      errors.push({ field: key, message: `Unknown or inactive custom field "${key}"` });
      continue;
    }
    if (!roleMeets(field.editPermission as AccessLevel, role)) {
      errors.push({ field: field.name, message: `You are not allowed to edit ${field.name}` });
      continue;
    }
    const result = coerceValue(field, raw);
    if ("error" in result) errors.push(result.error);
    else writes.push({ fieldId: field.id, value: result.value });
  }

  if (enforceRequired) {
    const provided = new Set(writes.filter((w) => w.value !== null).map((w) => w.fieldId));
    for (const field of fields) {
      if (!field.required || provided.has(field.id)) continue;
      // A default satisfies a required field
      if (field.defaultValue !== null && field.defaultValue !== undefined) {
        writes.push({ fieldId: field.id, value: field.defaultValue });
        continue;
      }
      if (!roleMeets(field.editPermission as AccessLevel, role)) continue;
      errors.push({ field: field.name, message: `${field.name} is required` });
    }
  }

  if (errors.length) return { ok: false, errors };

  for (const write of writes) {
    if (write.value === null) {
      await prisma.customFieldValue.deleteMany({
        where: { fieldId: write.fieldId, entityId },
      });
      continue;
    }
    await prisma.customFieldValue.upsert({
      where: { fieldId_entityId: { fieldId: write.fieldId, entityId } },
      create: { fieldId: write.fieldId, entityType: entity, entityId, value: write.value },
      update: { value: write.value },
    });
  }
  return { ok: true };
}
