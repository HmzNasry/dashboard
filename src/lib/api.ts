import type {
  AppData,
  ScheduleData,
  AnnouncementsData,
  Announcement,
} from "../types";

// All content is fetched from the Node server so editing the JSON in /data and
// refreshing is enough — no rebuild needed to add events or reminders.
export async function fetchData(): Promise<AppData> {
  const [sched, ann] = await Promise.all([
    fetch("/api/schedule").then((r) => r.json() as Promise<ScheduleData>),
    fetch("/api/announcements").then(
      (r) => r.json() as Promise<AnnouncementsData>,
    ),
  ]);
  return { schedule: sched, announcements: ann.announcements };
}

async function postJson(url: string, body: unknown): Promise<void> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const msg = await r.json().catch(() => ({}));
    throw new Error(msg.error || `HTTP ${r.status}`);
  }
}

/** Persist the schedule (writes data/schedule.json on the server). */
export const saveSchedule = (schedule: ScheduleData) =>
  postJson("/api/schedule", schedule);

/** Persist the announcement library (writes data/announcements.json). */
export const saveAnnouncements = (announcements: Announcement[]) =>
  postJson("/api/announcements", { announcements });

export interface TtsResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/**
 * Generate speech on-demand, fully offline, via the local Piper server.
 * Returns a URL to the generated audio file (served from /audio/generated).
 */
export async function generateTts(
  text: string,
  lang: "en" | "fa",
): Promise<TtsResult> {
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang }),
    });
    const data = (await res.json()) as TtsResult;
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return data;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Is the offline TTS engine configured & reachable? */
export async function ttsHealth(): Promise<{ ready: boolean; detail: string }> {
  try {
    const res = await fetch("/api/tts/health");
    return (await res.json()) as { ready: boolean; detail: string };
  } catch {
    return { ready: false, detail: "server unreachable" };
  }
}
