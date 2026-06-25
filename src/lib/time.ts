import type { EventItem } from "../types";

/** Minutes since midnight for an "HH:MM" string. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function nowMinutes(d = new Date()): number {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

export interface ScheduleState {
  current: EventItem | null;
  next: EventItem | null;
  /** 0..1 progress through the current segment toward the next. */
  progress: number;
}

/**
 * Determine the current and next segment from the wall clock.
 * `manualId` overrides the "current" segment when the operator pins one.
 */
export function computeState(
  events: EventItem[],
  manualId: string | null,
  now = nowMinutes(),
): ScheduleState {
  const sorted = [...events].sort((a, b) => toMinutes(a.time) - toMinutes(b.time));

  if (manualId) {
    const idx = sorted.findIndex((e) => e.id === manualId);
    if (idx !== -1) {
      const cur = sorted[idx];
      const nxt = sorted[idx + 1] ?? null;
      let prog = 0;
      if (nxt) {
        const a = toMinutes(cur.time);
        const b = toMinutes(nxt.time);
        prog = b > a ? Math.min(1, Math.max(0, (now - a) / (b - a))) : 0;
      }
      return { current: cur, next: nxt, progress: prog };
    }
  }

  let current: EventItem | null = null;
  let next: EventItem | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const start = toMinutes(sorted[i].time);
    if (now >= start) {
      current = sorted[i];
      next = sorted[i + 1] ?? null;
    } else {
      if (!current) next = sorted[i];
      break;
    }
  }

  let progress = 0;
  if (current && next) {
    const a = toMinutes(current.time);
    const b = toMinutes(next.time);
    progress = b > a ? Math.min(1, Math.max(0, (now - a) / (b - a))) : 0;
  }

  return { current, next, progress };
}

/** "18:00" -> "6:00 PM" for guest-facing display. */
export function formatTime12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, "0")} ${period}`;
}

/** "in 25 min" / "now" style label for an upcoming time. */
export function countdownLabel(hhmm: string, now = nowMinutes()): string {
  const diff = Math.round(toMinutes(hhmm) - now);
  if (diff <= 0) return "now";
  if (diff < 60) return `in ${diff} min`;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}
