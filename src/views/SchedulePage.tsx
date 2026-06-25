import { useEffect, useMemo, useState } from "react";
import type { AppData } from "../types";
import { computeState, formatTime12, toMinutes } from "../lib/time";

// Guest-facing, mobile-friendly schedule. Read-only by design: it only fetches
// the schedule JSON (via the parent App's poll) and runs a local clock — no
// WebSocket, no device registration — so any number of phones can open it
// without touching the control channel or loading the server. Follows the wall
// clock (it does not reflect an operator's manual pin).
export function SchedulePage({ data }: { data: AppData }) {
  // One-second tick drives both "what's live now" and the countdown.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const state = useMemo(
    () => computeState(data.schedule.events, null, nowMin),
    [data.schedule.events, nowMin],
  );

  const ordered = useMemo(
    () => [...data.schedule.events].sort((a, b) => toMinutes(a.time) - toMinutes(b.time)),
    [data.schedule.events],
  );
  const currentId = state.current?.id ?? null;
  const currentIdx = ordered.findIndex((e) => e.id === currentId);
  const next = state.next;

  return (
    <div className="relative flex h-full flex-col bg-[#f4f2ed] text-neutral-900">
      {/* Header */}
      <header
        className="shrink-0 border-b border-neutral-300 px-3 pb-4"
        style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))" }}
      >
        <div className="font-display text-3xl tracking-tight">
          {data.schedule.date}
        </div>
        <div className="font-display mt-1 text-base text-neutral-500">Schedule</div>
      </header>

      {/* Event list — a tight, full-width table; scrolls above the bottom bar. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {ordered.map((e, i) => {
          const isLive = e.id === currentId;
          const done = currentIdx !== -1 && i < currentIdx;
          return (
            <div
              key={e.id}
              className={`flex items-start gap-3 px-2 py-4 transition-colors ${
                isLive
                  ? "my-1 rounded-xl border-2 border-neutral-900 bg-white shadow-sm"
                  : "border-b border-neutral-200/70 last:border-b-0"
              } ${done ? "opacity-45" : ""}`}
            >
              <span
                className={`w-16 shrink-0 whitespace-nowrap pt-0.5 text-left tabular-nums text-sm font-medium ${
                  isLive ? "text-neutral-700" : "text-neutral-500"
                }`}
              >
                {formatTime12(e.time)}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={`text-xl font-medium leading-snug tracking-tight [overflow-wrap:anywhere] ${
                    isLive ? "text-neutral-900" : "text-neutral-700"
                  }`}
                >
                  {e.title.en}
                </div>
                <div
                  className={`fa mt-3 text-xl leading-relaxed [overflow-wrap:anywhere] ${
                    isLive ? "text-neutral-600" : "text-neutral-500"
                  }`}
                >
                  {e.title.fa}
                </div>
              </div>
              {isLive && (
                <span className="mt-1 shrink-0 rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white">
                  Now
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Up next — a full-width bar flush to the bottom edge (not a floating
          island). Extends through the phone's bottom safe-area. */}
      <NextNotch next={next} now={now} />
    </div>
  );
}

function NextNotch({
  next,
  now,
}: {
  next: AppData["schedule"]["events"][number] | null;
  now: Date;
}) {
  return (
    <div
      className="z-10 flex shrink-0 items-center justify-between gap-4 rounded-t-3xl border-t border-neutral-800 bg-neutral-900 px-4 pt-5 text-white shadow-[0_-6px_24px_rgba(0,0,0,0.18)]"
      style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
    >
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-neutral-400">
          {next ? "Up next" : "Schedule"}
        </div>
        {next ? (
          <>
            <div className="text-lg font-semibold leading-snug [overflow-wrap:anywhere]">
              {next.title.en}
            </div>
            <div className="fa mt-1.5 text-base leading-relaxed text-neutral-300 [overflow-wrap:anywhere]">
              {next.title.fa}
            </div>
          </>
        ) : (
          <div className="text-lg font-semibold leading-snug">
            End of the evening
          </div>
        )}
      </div>
      {next && (
        <div className="shrink-0 text-right">
          <div className="font-mono text-3xl font-semibold tabular-nums leading-none">
            {countdown(next.time, now)}
          </div>
          <div className="mt-1.5 text-[11px] tabular-nums text-neutral-400">
            {formatTime12(next.time)}
          </div>
        </div>
      )}
    </div>
  );
}

// "H:MM:SS" until the given "HH:MM" today (clamped at 0).
function countdown(time: string, now: Date): string {
  const [h, m] = time.split(":").map(Number);
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  let secs = Math.max(0, Math.floor((target.getTime() - now.getTime()) / 1000));
  const hh = Math.floor(secs / 3600);
  secs %= 3600;
  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${hh}:${pad(mm)}:${pad(ss)}`;
}
