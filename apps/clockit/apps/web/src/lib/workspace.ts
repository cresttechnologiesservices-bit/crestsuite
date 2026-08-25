import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

/**
 * Workspace configuration as the client's source of truth.
 *
 * Every screen reads its formatting, week boundaries, capacity and feature
 * availability from here rather than hard-coding them, so a change an admin
 * makes in Workspace Settings → General is reflected everywhere.
 */
export interface Workspace {
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
  canManage?: boolean;
}

export const WORKSPACE_DEFAULTS: Workspace = {
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
};

/** Shared query key so a settings save can refresh every consumer at once. */
export const WORKSPACE_QUERY_KEY = ["workspace-settings"];

export function useWorkspace(): Workspace {
  const { data } = useQuery({
    queryKey: WORKSPACE_QUERY_KEY,
    queryFn: async () => (await api.get("/workspace/settings")).data,
    staleTime: 30_000,
  });
  return { ...WORKSPACE_DEFAULTS, ...(data ?? {}) };
}

const DAY_INDEX: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

/** date-fns `weekStartsOn` for the workspace's Week start setting. */
export function weekStartsOn(ws: Workspace): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return DAY_INDEX[ws.weekStart] ?? 1;
}

/** True when the date is one of the workspace's working days. */
export function isWorkingDay(ws: Workspace, date: Date): boolean {
  const name = Object.keys(DAY_INDEX).find((d) => DAY_INDEX[d] === date.getDay());
  return !!name && ws.workingDays.includes(name);
}

/**
 * Format a duration according to the workspace Duration format:
 *   compact  2:30      full  2h 30m      decimal  2.50
 */
export function formatDuration(ws: Workspace, minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (ws.durationFormat === "decimal") return (total / 60).toFixed(2);
  if (ws.durationFormat === "full") return mins ? `${hours}h ${mins}m` : `${hours}h`;
  return `${hours}:${String(mins).padStart(2, "0")}`;
}

/** Same, from seconds — the tracker works in seconds. */
export function formatDurationSeconds(ws: Workspace, seconds: number): string {
  return formatDuration(ws, Math.max(0, seconds) / 60);
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", INR: "₹", AUD: "A$",
  CAD: "C$", JPY: "¥", CHF: "CHF", SGD: "S$", AED: "AED",
};

/** Currencies with no minor unit — ¥1,000 rather than ¥1,000.00. */
const CURRENCY_DECIMALS: Record<string, number> = { JPY: 0 };

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? code;
}

export function currencyDecimals(code: string): number {
  return CURRENCY_DECIMALS[code] ?? 2;
}

/** A currency whose symbol is just its code has no distinct symbol form. */
export function hasDistinctSymbol(code: string): boolean {
  return currencySymbol(code) !== code;
}

/** Apply the workspace Number format to a numeric value. */
export function formatNumber(ws: Workspace, value: number, decimals = 2): string {
  const fixed = Math.abs(value).toFixed(decimals);
  const [whole, fraction] = fixed.split(".");
  const sign = value < 0 ? "-" : "";
  if (ws.numberFormat === "1.000,00") {
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${sign}${grouped}${fraction ? "," + fraction : ""}`;
  }
  if (ws.numberFormat === "1 000.00") {
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return `${sign}${grouped}${fraction ? "." + fraction : ""}`;
  }
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}${fraction ? "." + fraction : ""}`;
}

/** Money in the workspace currency, placed per the Currency format setting. */
export function formatMoney(ws: Workspace, value: number): string {
  // Decimal places follow the currency, so JPY reads ¥1,000 not ¥1,000.00
  const amount = formatNumber(ws, value, currencyDecimals(ws.currency));
  const symbol = currencySymbol(ws.currency);
  switch (ws.currencyFormat) {
    case "symbol-after":
      return `${amount}${symbol}`;
    case "code-before":
      return `${ws.currency} ${amount}`;
    case "code-after":
      return `${amount} ${ws.currency}`;
    default:
      return `${symbol}${amount}`;
  }
}
