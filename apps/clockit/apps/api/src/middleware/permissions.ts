import { Response, NextFunction } from "express";
import { AuthedRequest } from "./auth";
import { can, Resource, Action } from "../lib/permissions";

const LABEL: Record<Resource, string> = {
  projects: "projects",
  clients: "clients",
  tasks: "tasks",
  timeEntries: "time entries",
  reports: "reports",
  team: "team",
};

/**
 * Enforces a Workspace Settings → Permissions rule on a route.
 *
 * The matrix is the authority for Managers and Members; administrators and
 * owners always pass. Applying it server-side is what makes the setting real —
 * hiding a button would still leave the endpoint open.
 */
export function requirePermission(resource: Resource, action: Action) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.userId) return res.status(401).json({ error: "unauthorized" });
    if (await can(req.userId, resource, action)) return next();
    return res.status(403).json({
      error: "permission_denied",
      resource,
      action,
      message: `Your role is not allowed to ${action} ${LABEL[resource]} in this workspace.`,
    });
  };
}
