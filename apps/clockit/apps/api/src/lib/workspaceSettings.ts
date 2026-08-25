import { prisma } from "./prisma";

/**
 * Workspace-level configuration, read as the single source of truth by every
 * module that needs it (feature gating, project defaults, overtime, week
 * boundaries, money formatting).
 *
 * Values are cached briefly so hot paths do not hit the database on every
 * request; `invalidateWorkspaceSettings()` clears the cache the moment an
 * admin saves, so a change takes effect immediately.
 */
export const SETTINGS_ID = "workspace";
const CACHE_MS = 5_000;

export interface WorkspaceConfig {
  name: string;
  logoDataUrl: string | null;
  timesheetEnabled: boolean;
  timeTrackerEnabled: boolean;
  kioskEnabled: boolean;
  defaultBillable: boolean;
  defaultProjectPublic: boolean;
  organizeTimeBy: string;
  durationFormat: string;
  weekStart: string;
  workingDays: string[];
  dailyWorkCapacity: number;
  overtimePeriod: string;
  billableRate: number | null;
  currency: string;
  numberFormat: string;
  currencyFormat: string;
  /** Role permission matrix (Workspace Settings → Permissions) */
  permissions: Record<string, Record<string, string[]>>;
}

const DEFAULTS: WorkspaceConfig = {
  name: "My Workspace",
  logoDataUrl: null,
  timesheetEnabled: true,
  timeTrackerEnabled: true,
  kioskEnabled: false,
  defaultBillable: true,
  defaultProjectPublic: true,
  organizeTimeBy: "client-project-task",
  durationFormat: "compact",
  weekStart: "Monday",
  workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  dailyWorkCapacity: 8,
  overtimePeriod: "weekly",
  billableRate: null,
  currency: "USD",
  numberFormat: "1,000.00",
  currencyFormat: "symbol-before",
  permissions: {},
};

let cache: { value: WorkspaceConfig; at: number } | null = null;

export function invalidateWorkspaceSettings() {
  cache = null;
}

export async function getWorkspaceSettings(): Promise<WorkspaceConfig> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let row: any = null;
  try {
    row = await prisma.workspaceSettings.findUnique({ where: { id: SETTINGS_ID } });
  } catch {
    // Never let a settings read break a request — fall back to defaults
    return DEFAULTS;
  }
  const value: WorkspaceConfig = {
    ...DEFAULTS,
    ...(row
      ? {
          name: row.name,
          logoDataUrl: row.logoDataUrl ?? null,
          timesheetEnabled: row.timesheetEnabled,
          timeTrackerEnabled: row.timeTrackerEnabled,
          kioskEnabled: row.kioskEnabled,
          defaultBillable: row.defaultBillable,
          defaultProjectPublic: row.defaultProjectPublic,
          organizeTimeBy: row.organizeTimeBy,
          durationFormat: row.durationFormat,
          weekStart: row.weekStart,
          workingDays: Array.isArray(row.workingDays) ? row.workingDays : DEFAULTS.workingDays,
          dailyWorkCapacity:
            row.dailyWorkCapacity != null ? Number(row.dailyWorkCapacity) : DEFAULTS.dailyWorkCapacity,
          overtimePeriod: row.overtimePeriod,
          billableRate: row.billableRate != null ? Number(row.billableRate) : null,
          currency: row.currency,
          numberFormat: row.numberFormat,
          currencyFormat: row.currencyFormat,
          permissions: (row.permissions as any) ?? {},
        }
      : {}),
  };
  cache = { value, at: Date.now() };
  return value;
}

const DAY_INDEX: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

/** date-fns `weekStartsOn` for the configured Week start. */
export function weekStartsOn(config: WorkspaceConfig): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return (DAY_INDEX[config.weekStart] ?? 1) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

/** True when the given date falls on a configured working day. */
export function isWorkingDay(config: WorkspaceConfig, date: Date): boolean {
  const name = Object.keys(DAY_INDEX).find((d) => DAY_INDEX[d] === date.getDay());
  return !!name && config.workingDays.includes(name);
}
