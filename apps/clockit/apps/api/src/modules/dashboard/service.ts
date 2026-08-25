import { prisma } from "../../lib/prisma";
import { eachDayOfInterval, format, differenceInMinutes } from "date-fns";

// REQ-DASH-B10: preferences persist in User.uiPrefs (JSON) so they survive
// server restarts and follow the user across devices.

export class DashboardService {
  /**
   * REQ-DASH-B01, B08: Get summary data (total time, top project, top client, billable percentage)
   */
  static async getSummary(
    userId: string,
    scope: "me" | "team",
    startDate: Date,
    endDate: Date,
    teamIds?: string[]
  ) {
    const where = {
      start: { gte: startDate, lte: endDate },
      end: { not: null },
      ...(scope === "me" ? { userId } : teamIds?.length ? { userId: { in: teamIds } } : {}),
    };
    const entries = await prisma.timeEntry.findMany({
      where,
      include: { project: { include: { client: true } } },
    });

    // Calculate total duration
    let totalMinutes = 0;
    let billableMinutes = 0;
    const projectTotals: Record<string, { name: string; minutes: number; clientId?: string; clientName?: string }> = {};

    entries.forEach((entry: any) => {
      if (!entry.end) return;
      const duration = differenceInMinutes(entry.end, entry.start);
      totalMinutes += duration;
      if (entry.billable) billableMinutes += duration;

      if (entry.projectId) {
        if (!projectTotals[entry.projectId]) {
          projectTotals[entry.projectId] = {
            name: entry.project?.name || "Unknown",
            minutes: 0,
            clientId: entry.project?.clientId || undefined,
            clientName: entry.project?.client?.name || undefined,
          };
        }
        projectTotals[entry.projectId].minutes += duration;
      }
    });

    // Find top project and client
    const sortedProjects = Object.entries(projectTotals).sort((a, b) => b[1].minutes - a[1].minutes);
    const topProject = sortedProjects[0]?.[1]?.name || null;
    const topClient = sortedProjects[0]?.[1]?.clientName || null;

    // REQ-DASH-B08: billable % = (billable duration / total duration) * 100
    const billablePercentage = totalMinutes > 0 ? Math.round((billableMinutes / totalMinutes) * 100) : 0;

    return {
      totalTime: this.formatDuration(totalMinutes),
      totalMinutes,
      topProject,
      topClient,
      billablePercentage,
    };
  }

  /**
   * REQ-DASH-B02, B11: Get chart data (per-day totals, segmented by project or billability).
   * Returns { days, series } where series describes each stack segment (key, name, color).
   */
  static async getChartData(
    userId: string,
    scope: "me" | "team",
    startDate: Date,
    endDate: Date,
    groupBy: "project" | "billability",
    teamIds?: string[]
  ) {
    const where = {
      start: { gte: startDate, lte: endDate },
      end: { not: null },
      ...(scope === "me" ? { userId } : teamIds?.length ? { userId: { in: teamIds } } : {}),
    };
    const entries = await prisma.timeEntry.findMany({
      where,
      include: { project: true },
    });

    // Build the series (legend) metadata
    const seriesMap: Record<string, { key: string; name: string; color: string }> = {};
    if (groupBy === "billability") {
      seriesMap["billable"] = { key: "billable", name: "Billable", color: "#4f46e5" };
      seriesMap["non-billable"] = { key: "non-billable", name: "Non-billable", color: "#94a3b8" };
    } else {
      entries.forEach((entry: any) => {
        const key = entry.projectId || "no-project";
        if (!seriesMap[key]) {
          seriesMap[key] = {
            key,
            name: entry.project?.name || "No Project",
            color: entry.project?.color || "#94a3b8",
          };
        }
      });
    }

    const days = eachDayOfInterval({ start: startDate, end: endDate });
    const chartDays: any[] = [];

    // REQ-DASH-B11: every day in the period gets a row, zero-value days included
    days.forEach((day) => {
      const dateStr = format(day, "yyyy-MM-dd");
      const dayEntries = entries.filter((e: any) => format(e.start, "yyyy-MM-dd") === dateStr);

      let totalMinutes = 0;
      const segments: Record<string, number> = {};

      dayEntries.forEach((entry: any) => {
        if (!entry.end) return;
        const duration = differenceInMinutes(entry.end, entry.start);
        totalMinutes += duration;

        const key =
          groupBy === "project"
            ? entry.projectId || "no-project"
            : entry.billable
              ? "billable"
              : "non-billable";
        if (!segments[key]) segments[key] = 0;
        segments[key] += duration;
      });

      chartDays.push({
        date: dateStr,
        total: this.formatDuration(totalMinutes),
        totalMinutes,
        segments,
      });
    });

    return {
      days: chartDays,
      series: Object.values(seriesMap),
    };
  }

  /**
   * REQ-DASH-B03, B12: Get breakdown data (grouped by project or billability)
   */
  static async getBreakdown(
    userId: string,
    scope: "me" | "team",
    startDate: Date,
    endDate: Date,
    groupBy: "project" | "billability",
    teamIds?: string[]
  ) {
    const where = {
      start: { gte: startDate, lte: endDate },
      end: { not: null },
      ...(scope === "me" ? { userId } : teamIds?.length ? { userId: { in: teamIds } } : {}),
    };
    const entries = await prisma.timeEntry.findMany({
      where,
      include: { project: { include: { client: true } } },
    });

    let totalMinutes = 0;
    const groups: Record<string, { name: string; minutes: number; color?: string; clientName?: string }> = {};

    entries.forEach((entry: any) => {
      if (!entry.end) return;
      const duration = differenceInMinutes(entry.end, entry.start);
      totalMinutes += duration;

      let key: string;
      let name: string;
      let color: string | undefined;
      let clientName: string | undefined;

      if (groupBy === "project") {
        key = entry.projectId || "no-project";
        name = entry.project?.name || "No Project";
        color = entry.project?.color || "#94a3b8";
        clientName = entry.project?.client?.name;
      } else {
        key = entry.billable ? "billable" : "non-billable";
        name = entry.billable ? "Billable" : "Non-billable";
        color = entry.billable ? "#4f46e5" : "#94a3b8";
      }

      if (!groups[key]) {
        groups[key] = { name, minutes: 0, color, clientName };
      }
      groups[key].minutes += duration;
    });

    // Calculate percentages and sort descending by duration (REQ-DASH-F16)
    const breakdown = Object.entries(groups)
      .map(([key, data]) => ({
        key,
        name: data.name,
        duration: this.formatDuration(data.minutes),
        minutes: data.minutes,
        percentage: totalMinutes > 0 ? Math.round((data.minutes / totalMinutes) * 100) : 0,
        color: data.color,
        clientName: data.clientName,
      }))
      .sort((a, b) => b.minutes - a.minutes);

    return {
      total: this.formatDuration(totalMinutes),
      totalMinutes,
      breakdown,
    };
  }

  /**
   * REQ-DASH-B04, B12: Get most tracked activities (for "Only me" scope)
   */
  static async getActivities(
    userId: string,
    startDate: Date,
    endDate: Date,
    limit: number = 10
  ) {
    const entries = await prisma.timeEntry.findMany({
      where: {
        userId,
        start: { gte: startDate, lte: endDate },
        end: { not: null },
      },
      include: { project: { include: { client: true } } },
    });
    const activityMap: Record<string, { description: string; projectName: string; clientName: string | null; minutes: number }> = {};

    entries.forEach((entry: any) => {
      if (!entry.end) return;
      const duration = differenceInMinutes(entry.end, entry.start);
      const key = `${entry.description}|${entry.projectId}`;

      if (!activityMap[key]) {
        activityMap[key] = {
          description: entry.description || "(no description)",
          projectName: entry.project?.name || "No Project",
          clientName: entry.project?.client?.name || null,
          minutes: 0,
        };
      }
      activityMap[key].minutes += duration;
    });

    const activities = Object.values(activityMap)
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, limit)
      .map((activity) => ({
        ...activity,
        duration: this.formatDuration(activity.minutes),
      }));

    return activities;
  }

  /**
   * REQ-DASH-B05, B07, B09: Get team activities (for "Team" scope)
   */
  static async getTeamActivities(
    userId: string,
    startDate: Date,
    endDate: Date,
    teamIds?: string[],
    sortBy: string = "total",
    sortOrder: "asc" | "desc" = "desc"
  ) {
    // REQ-DASH-B06: only privileged roles may view team data
    const requester = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!requester || (requester.role !== "ADMIN" && requester.role !== "OWNER" && requester.role !== "MANAGER")) {
      return [];
    }

    const where = {
      start: { gte: startDate, lte: endDate },
      end: { not: null },
      ...(teamIds?.length ? { userId: { in: teamIds } } : {}),
    };

    const entries = await prisma.timeEntry.findMany({
      where,
      include: { user: true, project: true },
    });

    // Group by user
    const userMap: Record<string, {
      userId: string;
      name: string;
      email: string;
      totalMinutes: number;
      latestActivity: { description: string; projectName: string; timestamp: Date } | null;
      composition: Record<string, { key: string; name: string; color: string; minutes: number }>;
    }> = {};

    entries.forEach((entry: any) => {
      if (!entry.end) return;
      const duration = differenceInMinutes(entry.end, entry.start);

      if (!userMap[entry.userId]) {
        userMap[entry.userId] = {
          userId: entry.userId,
          name: entry.user.name,
          email: entry.user.email,
          totalMinutes: 0,
          latestActivity: null,
          composition: {},
        };
      }

      userMap[entry.userId].totalMinutes += duration;

      // Track latest activity
      if (!userMap[entry.userId].latestActivity || entry.start > userMap[entry.userId].latestActivity!.timestamp) {
        userMap[entry.userId].latestActivity = {
          description: entry.description || "(no description)",
          projectName: entry.project?.name || "No Project",
          timestamp: entry.start,
        };
      }

      // REQ-DASH-F21: per-project composition for the proportional bar
      const projectKey = entry.projectId || "no-project";
      if (!userMap[entry.userId].composition[projectKey]) {
        userMap[entry.userId].composition[projectKey] = {
          key: projectKey,
          name: entry.project?.name || "No Project",
          color: entry.project?.color || "#94a3b8",
          minutes: 0,
        };
      }
      userMap[entry.userId].composition[projectKey].minutes += duration;
    });

    // Convert to array and sort
    const teamActivities = Object.values(userMap).map((user) => ({
      userId: user.userId,
      name: user.name,
      email: user.email,
      latestActivity: user.latestActivity,
      totalDuration: this.formatDuration(user.totalMinutes),
      totalMinutes: user.totalMinutes,
      composition: Object.values(user.composition)
        .map((c) => ({
          ...c,
          percentage: user.totalMinutes > 0 ? Math.round((c.minutes / user.totalMinutes) * 100) : 0,
        }))
        .sort((a, b) => b.minutes - a.minutes),
    }));

    // REQ-DASH-B09: server-side sorting by name, latest activity, or total
    teamActivities.sort((a, b) => {
      let comparison = 0;
      if (sortBy === "name") {
        comparison = a.name.localeCompare(b.name);
      } else if (sortBy === "latest") {
        const aTime = a.latestActivity?.timestamp.getTime() || 0;
        const bTime = b.latestActivity?.timestamp.getTime() || 0;
        comparison = aTime - bTime;
      } else {
        comparison = a.totalMinutes - b.totalMinutes;
      }
      return sortOrder === "desc" ? -comparison : comparison;
    });

    return teamActivities;
  }

  /**
   * REQ-DASH-B10: Get user's dashboard preferences
   */
  static async getPreferences(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const ui = (user?.uiPrefs as any) || {};
    return { groupBy: "project", scope: "me", ...(ui.dashboard || {}) };
  }

  /**
   * REQ-DASH-B10: Update user's dashboard preferences
   */
  static async updatePreferences(userId: string, preferences: { groupBy?: string; scope?: string }) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const ui = (user?.uiPrefs as any) || {};
    const updated = { groupBy: "project", scope: "me", ...(ui.dashboard || {}), ...preferences };
    await prisma.user.update({
      where: { id: userId },
      data: { uiPrefs: { ...ui, dashboard: updated } },
    });
    return updated;
  }

  /**
   * Format minutes to H:MM string
   */
  private static formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${String(mins).padStart(2, "0")}`;
  }
}
