/**
 * Day/week/month boundaries in a *user's* timezone.
 *
 * The API container runs in UTC while people see their own local days. Deriving
 * period boundaries from the server clock therefore splits someone's evening or
 * early-morning work across two "days", which silently corrupts any per-day
 * total — overtime being the obvious casualty.
 *
 * All maths here is done on UTC fields of a shifted "wall clock" Date, so it is
 * independent of whatever timezone the process happens to run in.
 */

/**
 * A zone is either an IANA name (from the user's profile) or a fixed offset in
 * minutes as reported by the browser's `getTimezoneOffset()` — same sign
 * convention, so the two are interchangeable here.
 */
export type Zone = string | number;

/** Minutes to subtract from an instant to get its wall clock in `timeZone`. */
export function zoneOffsetMinutes(timeZone: Zone, instant: Date): number {
  if (typeof timeZone === "number") return Number.isFinite(timeZone) ? timeZone : 0;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .reduce((acc: Record<string, string>, part) => {
        acc[part.type] = part.value;
        return acc;
      }, {});
    const wall = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second)
    );
    return (instant.getTime() - wall) / 60000;
  } catch {
    return 0; // unknown zone — behave as UTC rather than throwing
  }
}

/** A Date whose UTC fields read as the wall clock in `timeZone`. */
function toWall(timeZone: Zone, instant: Date): Date {
  return new Date(instant.getTime() - zoneOffsetMinutes(timeZone, instant) * 60000);
}

/** The real instant for a wall clock expressed as UTC fields. */
function fromWall(timeZone: Zone, wall: Date): Date {
  let instant = new Date(wall.getTime());
  // Two passes settle DST transitions
  for (let i = 0; i < 2; i++) {
    instant = new Date(wall.getTime() + zoneOffsetMinutes(timeZone, instant) * 60000);
  }
  return instant;
}

const DAY_MS = 86400000;

export interface Period {
  from: Date;
  to: Date;
  /** Wall-clock days in the period, for counting working days */
  days: { weekday: number }[];
}

/**
 * The calendar day/week/month containing `instant` **as the user experiences
 * it**, returned as real UTC instants suitable for querying.
 */
export function zonedPeriod(
  timeZone: Zone,
  instant: Date,
  unit: "day" | "week" | "month",
  weekStartsOn: number
): Period {
  const wall = toWall(timeZone, instant);
  const y = wall.getUTCFullYear();
  const m = wall.getUTCMonth();
  const d = wall.getUTCDate();

  let startWall: Date;
  let endWall: Date;
  if (unit === "week") {
    const dayStart = Date.UTC(y, m, d);
    const shift = (new Date(dayStart).getUTCDay() - weekStartsOn + 7) % 7;
    startWall = new Date(dayStart - shift * DAY_MS);
    endWall = new Date(startWall.getTime() + 7 * DAY_MS - 1);
  } else if (unit === "month") {
    startWall = new Date(Date.UTC(y, m, 1));
    endWall = new Date(Date.UTC(y, m + 1, 1) - 1);
  } else {
    startWall = new Date(Date.UTC(y, m, d));
    endWall = new Date(startWall.getTime() + DAY_MS - 1);
  }

  const days: { weekday: number }[] = [];
  for (let t = startWall.getTime(); t <= endWall.getTime(); t += DAY_MS) {
    days.push({ weekday: new Date(t).getUTCDay() });
  }

  return { from: fromWall(timeZone, startWall), to: fromWall(timeZone, endWall), days };
}
