import { prisma } from "../../lib/prisma";
import { format } from "date-fns";

export class CalendarService {
  /**
   * REQ-CAL-B01/B07: Get time entries for a date range (overlaps allowed,
   * all entries returned so the client can lay them out side by side).
   */
  static async getEntries(userId: string, startDate: Date, endDate: Date) {
    const entries = await prisma.timeEntry.findMany({
      where: {
        userId,
        start: { gte: startDate, lte: endDate },
      },
      include: { project: true },
      orderBy: { start: "asc" },
    });
    return entries;
  }

  /**
   * REQ-CAL-B02: Get total logged hours per day
   */
  static async getDailyTotals(userId: string, startDate: Date, endDate: Date) {
    const entries = await prisma.timeEntry.findMany({
      where: {
        userId,
        start: { gte: startDate, lte: endDate },
        end: { not: null },
      },
      select: { start: true, end: true },
    });
    const totals: Record<string, number> = {};

    entries.forEach((entry) => {
      if (!entry.end) return;
      const date = format(entry.start, "yyyy-MM-dd");
      const durationMinutes = Math.round(
        (entry.end.getTime() - entry.start.getTime()) / 60000
      );
      if (!totals[date]) totals[date] = 0;
      totals[date] += durationMinutes;
    });

    // Format as HH:MM
    const formatted: Record<string, string> = {};
    Object.entries(totals).forEach(([date, minutes]) => {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      formatted[date] = `${hours}:${String(mins).padStart(2, "0")}`;
    });

    return formatted;
  }

  /**
   * REQ-CAL-B03/B05/B08: Create a new time entry
   */
  static async createEntry(
    userId: string,
    projectId: string,
    start: Date,
    end: Date,
    description?: string,
    billable?: boolean,
    tags?: string[]
  ) {
    // Validate duration
    const durationMs = end.getTime() - start.getTime();
    if (durationMs <= 0) {
      throw new Error("End time must be after start time");
    }
    if (durationMs > 24 * 60 * 60 * 1000) {
      throw new Error("Duration cannot exceed 24 hours");
    }

    const entry = await prisma.timeEntry.create({
      data: {
        userId,
        projectId,
        description: description || "",
        start,
        end,
        billable: billable ?? false,
        tags: tags || [],
      },
      include: { project: true },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId,
        action: "CALENDAR_ENTRY_CREATE",
        target: entry.id,
        metadata: { projectId, start: start.toISOString(), end: end.toISOString() },
      },
    });

    return entry;
  }

  /**
   * REQ-CAL-B04/B05/B08: Update a time entry (for drag/resize/edit)
   */
  static async updateEntry(
    userId: string,
    entryId: string,
    updates: {
      start?: Date;
      end?: Date;
      description?: string;
      projectId?: string;
      billable?: boolean;
      tags?: string[];
    }
  ) {
    const entry = await prisma.timeEntry.findUnique({
      where: { id: entryId },
    });
    if (!entry || entry.userId !== userId) {
      throw new Error("Entry not found or access denied");
    }

    // Validate duration against the effective start/end
    const effectiveStart = updates.start ?? entry.start;
    const effectiveEnd = updates.end ?? entry.end;
    if (effectiveEnd) {
      const durationMs = effectiveEnd.getTime() - effectiveStart.getTime();
      if (durationMs <= 0) {
        throw new Error("End time must be after start time");
      }
      if (durationMs > 24 * 60 * 60 * 1000) {
        throw new Error("Duration cannot exceed 24 hours");
      }
    }

    const updated = await prisma.timeEntry.update({
      where: { id: entryId },
      data: {
        start: updates.start,
        end: updates.end,
        description: updates.description,
        projectId: updates.projectId,
        billable: updates.billable,
        tags: updates.tags,
      },
      include: { project: true },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId,
        action: "CALENDAR_ENTRY_UPDATE",
        target: entryId,
        metadata: JSON.parse(JSON.stringify(updates)),
      },
    });

    return updated;
  }

  /**
   * REQ-CAL-B08: Delete a time entry
   */
  static async deleteEntry(userId: string, entryId: string) {
    const entry = await prisma.timeEntry.findUnique({
      where: { id: entryId },
    });
    if (!entry || entry.userId !== userId) {
      throw new Error("Entry not found or access denied");
    }

    await prisma.timeEntry.delete({ where: { id: entryId } });

    await prisma.auditLog.create({
      data: {
        userId,
        action: "CALENDAR_ENTRY_DELETE",
        target: entryId,
        metadata: { start: entry.start.toISOString(), end: entry.end?.toISOString() },
      },
    });
  }

  /**
   * REQ-CAL-B06: Get calendar preferences
   */
  static async getPreferences(userId: string) {
    const prefs = await prisma.calendarPreference.findUnique({
      where: { userId },
    });
    return (
      prefs || {
        viewMode: "week",
        zoomLevel: 60,
        showWorkingDaysOnly: false,
      }
    );
  }

  /**
   * REQ-CAL-B06/B09: Update calendar preferences
   */
  static async updatePreferences(
    userId: string,
    updates: {
      viewMode?: string;
      zoomLevel?: number;
      showWorkingDaysOnly?: boolean;
    }
  ) {
    const prefs = await prisma.calendarPreference.upsert({
      where: { userId },
      update: updates,
      create: {
        userId,
        viewMode: updates.viewMode || "week",
        zoomLevel: updates.zoomLevel || 60,
        showWorkingDaysOnly: updates.showWorkingDaysOnly || false,
      },
    });
    return prefs;
  }

  /**
   * REQ-CAL-B12: Get integration status
   */
  static async getIntegrationStatus(userId: string) {
    const integrations = await prisma.externalCalendarIntegration.findMany({
      where: { userId },
      select: { provider: true, connectedAt: true },
    });
    const status = {
      google: false,
      outlook: false,
    };

    integrations.forEach((integration) => {
      if (integration.provider === "google") status.google = true;
      if (integration.provider === "outlook") status.outlook = true;
    });

    return status;
  }

  /**
   * REQ-CAL-B13: Disconnect calendar integration
   */
  static async disconnectIntegration(userId: string, provider: string) {
    await prisma.externalCalendarIntegration.deleteMany({
      where: { userId, provider },
    });
  }

  /**
   * REQ-CAL-B07: Get overlapping entries for layout calculation
   */
  static async getOverlappingEntries(userId: string, date: Date) {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const entries = await prisma.timeEntry.findMany({
      where: {
        userId,
        start: { gte: dayStart, lte: dayEnd },
        end: { not: null },
      },
      include: { project: true },
      orderBy: { start: "asc" },
    });

    // Calculate layout positions for overlapping entries
    return this.calculateLayout(entries);
  }

  /**
   * Calculate side-by-side layout positions for overlapping entries
   */
  private static calculateLayout(entries: any[]) {
    const layout: any[] = [];
    const columns: any[][] = [];

    entries.forEach((entry) => {
      if (!entry.end) return;

      let placed = false;
      for (let i = 0; i < columns.length; i++) {
        const lastInColumn = columns[i][columns[i].length - 1];
        if (lastInColumn.end <= entry.start) {
          columns[i].push(entry);
          layout.push({
            ...entry,
            column: i,
            totalColumns: 0, // Will be updated below
          });
          placed = true;
          break;
        }
      }

      if (!placed) {
        columns.push([entry]);
        layout.push({
          ...entry,
          column: columns.length - 1,
          totalColumns: 0,
        });
      }
    });

    // Update total columns for each entry
    const totalColumns = columns.length;
    layout.forEach((item) => {
      item.totalColumns = totalColumns;
    });

    return layout;
  }
}
