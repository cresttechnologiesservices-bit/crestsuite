import nodemailer from "nodemailer";
import { prisma } from "../../lib/prisma";
import env from "../../config";

// MailHog-compatible transport (same settings as lib/mail.ts, but with per-notification subjects)
const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth:
    env.SMTP_USER && env.SMTP_PASS
      ? {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      }
      : undefined,
});

export const NOTIFICATION_TYPES = [
  "newsletter",
  "onboarding",
  "weekly_report",
  "long_running_timer",
  "scheduled_reports",
  "approval",
  "time_off",
  "alerts",
  "reminders",
  "schedule",
  "invoices",
] as const;

export type NotificationType = typeof NOTIFICATION_TYPES[number];

// REQ-ACC-B08: Default notification configuration (all enabled except Newsletter and Invoices)
export const DEFAULT_NOTIFICATION_PREFS: Record<NotificationType, boolean> = {
  newsletter: false,
  onboarding: true,
  weekly_report: true,
  long_running_timer: true,
  scheduled_reports: true,
  approval: true,
  time_off: true,
  alerts: true,
  reminders: true,
  schedule: true,
  invoices: false,
};

export class NotificationService {
  /**
   * REQ-ACC-B06: Get user's notification preferences
   */
  static async getPreferences(userId: string): Promise<Record<NotificationType, boolean>> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("User not found");
    const savedPrefs = (user.emailPrefs as Record<string, boolean>) || {};

    // Merge with defaults
    const prefs: Record<NotificationType, boolean> = { ...DEFAULT_NOTIFICATION_PREFS };
    for (const type of NOTIFICATION_TYPES) {
      if (savedPrefs[type] !== undefined) {
        prefs[type] = savedPrefs[type];
      }
    }
    return prefs;
  }

  /**
   * REQ-ACC-B06: Update user's notification preferences
   */
  static async updatePreferences(userId: string, prefs: Partial<Record<NotificationType, boolean>>) {
    // Validate types
    for (const key of Object.keys(prefs)) {
      if (!NOTIFICATION_TYPES.includes(key as NotificationType)) {
        throw new Error(`Invalid notification type: ${key}`);
      }
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("User not found");
    const savedRaw = (user.emailPrefs as Record<string, any>) || {};
    const current = await this.getPreferences(userId);
    const merged = { ...current, ...prefs };

    await prisma.user.update({
      where: { id: userId },
      // Preserve any non-notification keys stored alongside (e.g. general prefs)
      data: { emailPrefs: { ...savedRaw, ...merged } },
    });

    // REQ-ACC-B10: Log preference changes
    await prisma.auditLog.create({
      data: {
        userId,
        action: "NOTIFICATION_PREFS_UPDATED",
        metadata: { changes: prefs },
      },
    });

    return merged;
  }

  /**
   * REQ-ACC-B07: Check if user has a notification type enabled
   */
  static async isNotificationEnabled(userId: string, type: NotificationType): Promise<boolean> {
    const prefs = await this.getPreferences(userId);
    return prefs[type] === true;
  }

  /**
   * REQ-ACC-B07: Send notification (only if enabled)
   */
  static async sendNotification(
    userId: string,
    type: NotificationType,
    subject: string,
    body: string
  ): Promise<boolean> {
    const enabled = await this.isNotificationEnabled(userId, type);
    if (!enabled) return false;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return false;

    try {
      await transport.sendMail({
        from: env.SMTP_FROM,
        to: user.email,
        subject,
        text: body,
      });

      await prisma.notification.create({
        data: {
          userId,
          type,
          subject,
          body,
          delivered: true,
        },
      });

      return true;
    } catch (error) {
      await prisma.notification.create({
        data: {
          userId,
          type,
          subject,
          body,
          delivered: false,
        },
      });
      return false;
    }
  }

  /**
   * REQ-ACC-B07: Trigger notification based on event type
   */
  static async triggerEvent(event: string, userId: string, data: any = {}) {
    // Map events to notification types
    const eventMap: Record<string, { type: NotificationType; subject: string; body: string }> = {
      "timesheet.submitted": {
        type: "approval",
        subject: "Timesheet Submitted for Approval",
        body: `A timesheet has been submitted for approval. Details: ${JSON.stringify(data)}`,
      },
      "timesheet.approved": {
        type: "approval",
        subject: "Timesheet Approved",
        body: "Your timesheet has been approved.",
      },
      "time_off.requested": {
        type: "time_off",
        subject: "Time Off Request",
        body: "A time off request has been submitted.",
      },
      "timer.long_running": {
        type: "long_running_timer",
        subject: "Long Running Timer Alert",
        body: "You have a timer running for more than 8 hours.",
      },
      "reminder.timesheet_due": {
        type: "reminders",
        subject: "Timesheet Reminder",
        body: "Don't forget to submit your timesheet!",
      },
    };
    const mapping = eventMap[event];
    if (!mapping) return false;

    return this.sendNotification(userId, mapping.type, mapping.subject, mapping.body);
  }
}
