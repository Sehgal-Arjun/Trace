const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "3m", "5h", "2d", "Sep 29" — compact age for lists. */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)}d`;
  return shortDate(iso, false);
}

/** For sentences: "just now", "5h ago", or "on Sep 29" once it's old enough to show a date. */
export function since(iso: string, now = Date.now()): string {
  const a = ago(iso, now);
  if (a === "now") return "just now";
  return /^\d/.test(a) ? `${a} ago` : `on ${a}`;
}

/** "Sep 29, 2026", or "Sep 29" without the year. */
export function shortDate(iso: string, withYear = true): string {
  const d = new Date(iso);
  const base = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return withYear ? `${base}, ${d.getUTCFullYear()}` : base;
}

/** "38 s", "1 min 6 s", "2 h 4 min". */
export function duration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  if (s < 3600) return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`;
  const m = Math.floor(s / 60);
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export const shortSha = (sha: string) => sha.slice(0, 7);

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
