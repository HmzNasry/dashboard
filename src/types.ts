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
  /** Short name of the segment (shown small + in the schedule). */
  title: Bilingual;
  /** Main descriptive text (the big text shown in the "Now" box). */
  body?: Bilingual;
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

// ---- Networked devices (control panel ⇄ TV via the server) ---------------
export interface DeviceInfo {
  id: string;
  role: "display" | "control";
  name: string;
  admin: boolean;
  approved: boolean;
  connected: boolean;
  ip?: string;
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
        /** How long to keep it on screen (ms). Omit for audio-length default. */
        holdMs?: number;
      };
    }
  | { type: "stop" }
  /** Display -> Control: the announcement finished/cleared on screen. */
  | { type: "announceEnded" }
  | { type: "setCurrent"; payload: { eventId: string | null } }
  /** Schedule/announcements were edited — refetch content. */
  | { type: "reload" }
  /** Show/hide the full-screen looping video on the TV. */
  | { type: "video"; payload: { on: boolean } }
  | { type: "ping" };
