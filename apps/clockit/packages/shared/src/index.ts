import { z } from "zod";

export const EmailSchema = z.string().email();
export const PasswordSchema = z.string().min(8).regex(/(?=.*[A-Z])(?=.*\d)/);
export const OtpSchema = z.string().length(6).regex(/^\d+$/);

export const DurationSchema = z.string().regex(/^\d{1,3}:\d{2}$/);

export type Role = "OWNER" | "ADMIN" | "MANAGER" | "MEMBER";
export type ProjectStatus = "ACTIVE" | "ARCHIVED";
export type TimesheetStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

export interface TimeEntry {
  id: string;
  userId: string;
  projectId: string | null;
  description: string;
  start: string;
  end: string | null;
  billable: boolean;
  tags: string[];
}