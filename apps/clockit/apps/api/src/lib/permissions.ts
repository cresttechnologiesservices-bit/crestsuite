import { prisma } from "./prisma";
import { getWorkspaceSettings } from "./workspaceSettings";

/**
 * Role permissions configured in Workspace Settings → Permissions.
 *
 * Administrators and owners always have full access — the matrix only governs
 * Managers and Members, so a workspace can never lock its own admins out.
 */
export type Resource =
  | "projects"
  | "clients"
  | "tasks"
  | "timeEntries"
  | "reports"
  | "team";

export type Action = "view" | "create" | "edit" | "delete" | "manage";

export const RESOURCES: Resource[] = [
  "projects",
  "clients",
  "tasks",
  "timeEntries",
  "reports",
  "team",
];
export const ACTIONS: Action[] = ["view", "create", "edit", "delete", "manage"];

/**
 * Defaults chosen to match the behaviour the app already had before the matrix
 * was enforced, so switching this on changes nothing until an admin edits it.
 */
export const DEFAULT_PERMISSIONS: Record<string, Record<Resource, Action[]>> = {
  MANAGER: {
    projects: ["view", "create", "edit", "delete", "manage"],
    clients: ["view", "create", "edit", "delete"],
    tasks: ["view", "create", "edit", "delete"],
    timeEntries: ["view", "create", "edit", "delete"],
    reports: ["view", "manage"],
    team: ["view"],
  },
  MEMBER: {
    projects: [],
    clients: [],
    tasks: ["view"],
    timeEntries: ["view", "create", "edit", "delete"],
    reports: ["view"],
    team: [],
  },
};

const FULL: Record<Resource, Action[]> = RESOURCES.reduce(
  (acc, resource) => ({ ...acc, [resource]: [...ACTIONS] }),
  {} as Record<Resource, Action[]>
);

export const ADMIN_ROLES = ["ADMIN", "OWNER"];

/** The permission map actually in force for a role, defaults merged under. */
export async function permissionsForRole(role: string): Promise<Record<Resource, Action[]>> {
  if (ADMIN_ROLES.includes(role)) return FULL;
  const settings = await getWorkspaceSettings();
  const stored = ((settings as any).permissions ?? {}) as Record<string, any>;
  const defaults = DEFAULT_PERMISSIONS[role] ?? DEFAULT_PERMISSIONS.MEMBER;
  const configured = stored[role] ?? {};
  return RESOURCES.reduce((acc, resource) => {
    const value = configured[resource];
    acc[resource] = Array.isArray(value) ? value : defaults[resource] ?? [];
    return acc;
  }, {} as Record<Resource, Action[]>);
}

export async function permissionsForUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const role = user?.role ?? "MEMBER";
  return { role, permissions: await permissionsForRole(role) };
}

export async function can(userId: string, resource: Resource, action: Action): Promise<boolean> {
  const { permissions } = await permissionsForUser(userId);
  return (permissions[resource] ?? []).includes(action);
}
