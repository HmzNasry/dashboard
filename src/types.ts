// Shared content types. The schedule + announcements are plain JSON in /data
// so you can add events and reminders without touching any code.

export interface Bilingual {
  en: string;
  fa: string;
}

export interface EventItem {
  id: string;
  /** 24h "HH:MM" local time the segment starts. */
  time: string;
  title: Bilingual;
  subtitle?: Bilingual;
  /** Emoji or short glyph shown on the timeline. Optional. */
  icon?: string;
}

export interface ScheduleData {
  date: string; // human-readable, shown in the header
  events: EventItem[];
}

export interface Announcement {
  id: string;
  /** Short label shown on the control-panel button. */
  label: string;
  text: Bilingual;
  /** Pre-generated audio file paths (served from /audio). Optional per lang. */
  audio?: { en?: string; fa?: string };
  /** Play the cabin chime before the announcement. Defaults to true. */
  chime?: boolean;
}

export interface AnnouncementsData {
  announcements: Announcement[];
}

export interface AppData {
  schedule: ScheduleData;
  announcements: Announcement[];
}

// ---- Cross-window message bus (Control panel -> Display) -----------------
export type BusMessage =
  | {
      type: "announce";
      payload: {
        text: Bilingual;
        chime: boolean;
        audio?: { en?: string; fa?: string };
        /** Order languages are spoken in. */
        order: ("en" | "fa")[];
      };
    }
  | { type: "stop" }
  | { type: "setCurrent"; payload: { eventId: string | null } }
  | { type: "ping" };
