export function fmtDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

export function fmtHM(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  return `${h}:${m}`;
}

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function dateKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dayLabel(key: string) {
  const today = dateKey(new Date().toISOString());
  const yesterday = dateKey(new Date(Date.now() - 86400000).toISOString());
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return new Date(`${key}T00:00:00`).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Monday-based week key (yyyy-MM-dd of that week's Monday) for a day key. */
export function weekStartKey(key: string) {
  const d = new Date(`${key}T00:00:00`);
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return dateKey(d.toISOString());
}

/** "This week" / "Last week" / "4 – 10 Aug 2026" for a week's Monday key. */
export function weekLabel(mondayKey: string) {
  const today = dateKey(new Date().toISOString());
  if (mondayKey === weekStartKey(today)) return "This week";
  if (mondayKey === weekStartKey(dateKey(new Date(Date.now() - 7 * 86400000).toISOString()))) {
    return "Last week";
  }
  const start = new Date(`${mondayKey}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
  const formatter = new Intl.DateTimeFormat(undefined, opts);
  // formatRange collapses the shared month/year ("Aug 17 – 23, 2026")
  if (typeof (formatter as any).formatRange === "function") {
    return (formatter as any).formatRange(start, end);
  }
  return `${start.toLocaleDateString([], opts)} – ${end.toLocaleDateString([], opts)}`;
}

// Parse a user-typed duration into seconds (I-B semantics):
//   "HH:MM" / "HH:MM:SS"  -> hours:minutes(:seconds)
//   "1.5" / "2" / "1.5h"  -> decimal hours (a bare number is always HOURS)
//   "45m" / "90m"         -> minutes (explicit m suffix)
// Returns null when the text is not a duration.
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const minMatch = t.match(/^(\d+(?:\.\d+)?)\s*m$/);
  if (minMatch) return Math.round(parseFloat(minMatch[1]) * 60);
  const hourMatch = t.match(/^(\d+(?:\.\d+)?)\s*h?$/);
  if (hourMatch) return Math.round(parseFloat(hourMatch[1]) * 3600);
  const parts = t.split(":");
  if (parts.length > 3) return null;
  if (!parts.every((p) => /^\d+$/.test(p))) return null;
  const [h, m, s = "0"] = parts;
  if (Number(m) > 59 || Number(s) > 59) return null;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

export function entrySeconds(e: { start: string; end: string | null; durationSeconds?: number | null }) {
  if (typeof e.durationSeconds === "number") return e.durationSeconds;
  if (!e.end) return Math.floor((Date.now() - new Date(e.start).getTime()) / 1000);
  return Math.floor((new Date(e.end).getTime() - new Date(e.start).getTime()) / 1000);
}
