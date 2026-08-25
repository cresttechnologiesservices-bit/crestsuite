import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthedRequest } from "../../middleware/auth";
import { DashboardService } from "./service";
import { parseISO, endOfDay } from "date-fns";

const r = Router();
r.use(requireAuth);

async function canViewTeam(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return !!user && (user.role === "ADMIN" || user.role === "OWNER" || user.role === "MANAGER");
}

// REQ-DASH-B01: Summary data
r.get("/summary", async (req: AuthedRequest, res) => {
  try {
    const scope = (req.query.scope as string) || "me";
    const startDateStr = req.query.start_date as string;
    const endDateStr = req.query.end_date as string;
    const teamIdsParam = req.query.team_ids as string;
    if (!startDateStr || !endDateStr) {
      return res.status(400).json({ error: "start_date and end_date are required" });
    }

    // REQ-DASH-B06: Enforce role-based access for team scope
    if (scope === "team" && !(await canViewTeam(req.userId!))) {
      return res.status(403).json({ error: "Insufficient permissions for team scope" });
    }

    const startDate = parseISO(startDateStr);
    const endDate = endOfDay(parseISO(endDateStr));
    const teamIds = teamIdsParam ? teamIdsParam.split(",") : undefined;

    const summary = await DashboardService.getSummary(
      req.userId!,
      scope as "me" | "team",
      startDate,
      endDate,
      teamIds
    );

    res.json(summary);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-DASH-B02: Chart data
r.get("/chart", async (req: AuthedRequest, res) => {
  try {
    const scope = (req.query.scope as string) || "me";
    const groupBy = (req.query.group_by as string) || "project";
    const startDateStr = req.query.start_date as string;
    const endDateStr = req.query.end_date as string;
    const teamIdsParam = req.query.team_ids as string;
    if (!startDateStr || !endDateStr) {
      return res.status(400).json({ error: "start_date and end_date are required" });
    }

    if (scope === "team" && !(await canViewTeam(req.userId!))) {
      return res.status(403).json({ error: "Insufficient permissions for team scope" });
    }

    const startDate = parseISO(startDateStr);
    const endDate = endOfDay(parseISO(endDateStr));
    const teamIds = teamIdsParam ? teamIdsParam.split(",") : undefined;

    const chartData = await DashboardService.getChartData(
      req.userId!,
      scope as "me" | "team",
      startDate,
      endDate,
      groupBy as "project" | "billability",
      teamIds
    );

    res.json(chartData);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-DASH-B03: Breakdown data
r.get("/breakdown", async (req: AuthedRequest, res) => {
  try {
    const scope = (req.query.scope as string) || "me";
    const groupBy = (req.query.group_by as string) || "project";
    const startDateStr = req.query.start_date as string;
    const endDateStr = req.query.end_date as string;
    const teamIdsParam = req.query.team_ids as string;
    if (!startDateStr || !endDateStr) {
      return res.status(400).json({ error: "start_date and end_date are required" });
    }

    if (scope === "team" && !(await canViewTeam(req.userId!))) {
      return res.status(403).json({ error: "Insufficient permissions for team scope" });
    }

    const startDate = parseISO(startDateStr);
    const endDate = endOfDay(parseISO(endDateStr));
    const teamIds = teamIdsParam ? teamIdsParam.split(",") : undefined;

    const breakdown = await DashboardService.getBreakdown(
      req.userId!,
      scope as "me" | "team",
      startDate,
      endDate,
      groupBy as "project" | "billability",
      teamIds
    );

    res.json(breakdown);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-DASH-B04: Most tracked activities
r.get("/activities", async (req: AuthedRequest, res) => {
  try {
    const startDateStr = req.query.start_date as string;
    const endDateStr = req.query.end_date as string;
    const limit = Number(req.query.limit ?? 10);
    if (!startDateStr || !endDateStr) {
      return res.status(400).json({ error: "start_date and end_date are required" });
    }

    const startDate = parseISO(startDateStr);
    const endDate = endOfDay(parseISO(endDateStr));

    const activities = await DashboardService.getActivities(
      req.userId!,
      startDate,
      endDate,
      Math.min(limit, 50)
    );

    res.json(activities);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-DASH-B05, B07, B09: Team activities
r.get("/team-activities", async (req: AuthedRequest, res) => {
  try {
    // REQ-DASH-B06: Enforce role-based access
    if (!(await canViewTeam(req.userId!))) {
      return res.status(403).json({ error: "Insufficient permissions for team activities" });
    }
    const startDateStr = req.query.start_date as string;
    const endDateStr = req.query.end_date as string;
    const teamIdsParam = req.query.team_ids as string;
    const sortBy = (req.query.sort_by as string) || "total";
    const sortOrder = (req.query.sort_order as string) || "desc";

    if (!startDateStr || !endDateStr) {
      return res.status(400).json({ error: "start_date and end_date are required" });
    }

    const startDate = parseISO(startDateStr);
    const endDate = endOfDay(parseISO(endDateStr));
    const teamIds = teamIdsParam ? teamIdsParam.split(",") : undefined;

    const activities = await DashboardService.getTeamActivities(
      req.userId!,
      startDate,
      endDate,
      teamIds,
      sortBy,
      sortOrder as "asc" | "desc"
    );

    res.json(activities);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REQ-DASH-B10: Preferences
r.get("/preferences", async (req: AuthedRequest, res) => {
  try {
    const prefs = await DashboardService.getPreferences(req.userId!);
    res.json(prefs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

r.patch("/preferences", async (req: AuthedRequest, res) => {
  try {
    const schema = z.object({
      groupBy: z.enum(["project", "billability"]).optional(),
      scope: z.enum(["me", "team"]).optional(),
    });
    const body = schema.parse(req.body);
    const prefs = await DashboardService.updatePreferences(req.userId!, body);
    res.json(prefs);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "validation", details: error.flatten() });
    }
    res.status(500).json({ error: error.message });
  }
});

// REQ-DASH-F04 / B07: Get team members for the filter dropdown
r.get("/team-members", async (req: AuthedRequest, res) => {
  try {
    if (!(await canViewTeam(req.userId!))) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const search = (req.query.search as string) || "";
    const members = await prisma.user.findMany({
      where: {
        status: "active",
        ...(search ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        } : {}),
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
      take: 100,
    });

    res.json(members);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default r;
