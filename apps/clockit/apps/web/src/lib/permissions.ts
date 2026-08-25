import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

/**
 * The signed-in user's effective permissions from Workspace Settings →
 * Permissions, used to hide actions the role is not allowed to take.
 *
 * This is presentation only — the API enforces the same matrix, so hiding a
 * button is a convenience, not the security boundary.
 */
export type Resource = "projects" | "clients" | "tasks" | "timeEntries" | "reports" | "team";
export type Action = "view" | "create" | "edit" | "delete" | "manage";

export type PermissionMap = Record<Resource, Action[]>;

const EMPTY: PermissionMap = {
  projects: [],
  clients: [],
  tasks: [],
  timeEntries: [],
  reports: [],
  team: [],
};

export function usePermissions() {
  const { data, isLoading } = useQuery({
    queryKey: ["workspace-permissions"],
    queryFn: async () => (await api.get("/workspace/permissions/me")).data,
    staleTime: 30_000,
  });

  const permissions: PermissionMap = { ...EMPTY, ...(data?.permissions ?? {}) };
  const role: string = data?.role ?? "MEMBER";

  return {
    role,
    isLoading,
    permissions,
    /** True when the role may take this action on this resource. */
    can: (resource: Resource, action: Action) => (permissions[resource] ?? []).includes(action),
  };
}
