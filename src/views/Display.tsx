import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { AppData, BusMessage, EventItem } from "../types";
import { createBus } from "../lib/bus";
import { computeState, countdownLabel, formatTime12 } from "../lib/time";
import { Background } from "../components/Background";
import { AnnouncementOverlay } from "../components/AnnouncementOverlay";
import { unlockAudio, playChime } from "../lib/chime";

// The TV screen — clean, monochrome, large-type. Read-only: driven by the wall
// clock and by messages from the Control panel over the BroadcastChannel bus.
export function Display({ data }: { data: AppData }) {
  const busRef = useRef(createBus());
  const [manualId, setManualId] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [, tick] = useState(0);

  async function arm() {
    await unlockAudio();
    await playChime();
    setArmed(true);
  }

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const bus = busRef.current;
    const off = bus.on((m: BusMessage) => {
      if (m.type === "setCurrent") setManualId(m.payload.eventId);
    });
    return off;
  }, []);

  const state = useMemo(
    () => computeState(data.schedule.events, manualId),
    [data.schedule.events, manualId],
  );

  // Ring the cabin chime whenever the live segment changes (after arming).
  const prevCurrentId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const id = state.current?.id ?? null;
    if (prevCurrentId.current === undefined) {
      prevCurrentId.current = id;
      return;
    }
    if (id !== prevCurrentId.current) {
      prevCurrentId.current = id;
      if (armed) playChime();
    }
  }, [state.current?.id, armed]);

  const subscribe = (h: (m: BusMessage) => void) => busRef.current.on(h);

  return (
    <div className="relative h-full w-full bg-[#0a0a0a] text-neutral-100">
      <Background />

      <div className="safe relative flex h-full flex-col">
        <TopBar title={data.schedule.date} />
        <div className="grid flex-1 grid-cols-[1.55fr_1fr] gap-8 overflow-hidden pt-8">
          <NowHero state={state} />
          <Schedule
            events={data.schedule.events}
            currentId={state.current?.id ?? null}
          />
        </div>
      </div>

      <AnnouncementOverlay subscribe={subscribe} />
      {!armed && <ArmGate onArm={arm} />}
    </div>
  );
}

// ---- Top bar --------------------------------------------------------------
function TopBar({ title }: { title: string }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <header className="flex items-center justify-between border-b border-neutral-800 pb-6">
      <span className="text-3xl font-semibold tracking-tight">{title}</span>
      <span className="text-5xl font-semibold tabular-nums tracking-tight text-neutral-200">
        {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </span>
    </header>
  );
}

// ---- Now (hero) -----------------------------------------------------------
function NowHero({ state }: { state: ReturnType<typeof computeState> }) {
  const { current, next, progress } = state;
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-900/40">
      <div className="flex flex-1 flex-col justify-center px-12 py-10">
        <div className="flex items-center gap-3.5 text-xl text-neutral-400">
          <Pulse />
          <span>On screen now</span>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={current?.id ?? "pre"}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="mt-5"
          >
            <h2 className="text-[5.5rem] font-semibold leading-[1.02] tracking-tight">
              {current ? current.title.en : "Pre-show"}
            </h2>
            {current && (
              <div className="fa mt-4 text-5xl text-neutral-400">
                {current.title.fa}
              </div>
            )}
            {current?.subtitle && (
              <div className="mt-7 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-neutral-400">
                <span className="text-3xl">{current.subtitle.en}</span>
                <span className="fa text-2xl text-neutral-500">
                  {current.subtitle.fa}
                </span>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Up next */}
      <div className="flex items-center justify-between gap-6 border-t border-neutral-800 px-12 py-7">
        <div className="min-w-0">
          <div className="text-xl text-neutral-500">Up next</div>
          {next ? (
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4">
              <span className="text-4xl font-medium tracking-tight">
                {next.title.en}
              </span>
              <span className="fa text-2xl text-neutral-400">
                {next.title.fa}
              </span>
            </div>
          ) : (
            <div className="mt-1.5 text-4xl text-neutral-500">
              End of the evening
            </div>
          )}
        </div>
        {next && (
          <div className="shrink-0 text-right">
            <div className="text-5xl font-semibold tabular-nums tracking-tight">
              {formatTime12(next.time)}
            </div>
            <div className="mt-1 text-xl text-neutral-500">
              {countdownLabel(next.time)}
            </div>
          </div>
        )}
      </div>

      {current && next && (
        <div className="h-1.5 w-full bg-neutral-800">
          <motion.div
            className="h-full bg-neutral-100"
            animate={{ width: `${Math.round(progress * 100)}%` }}
            transition={{ duration: 1, ease: "linear" }}
          />
        </div>
      )}
    </section>
  );
}

// ---- Schedule -------------------------------------------------------------
function Schedule({
  events,
  currentId,
}: {
  events: EventItem[];
  currentId: string | null;
}) {
  const currentIdx = events.findIndex((e) => e.id === currentId);
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-900/40">
      <div className="border-b border-neutral-800 px-8 py-6 text-2xl font-semibold tracking-tight">
        Schedule
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="space-y-1">
          {events.map((e, i) => {
            const isLive = e.id === currentId;
            const done = currentIdx !== -1 && i < currentIdx;
            return (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: done ? 0.4 : 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.4 }}
                className={`flex items-center gap-5 rounded-2xl border px-5 py-4 transition-colors ${
                  isLive
                    ? "border-neutral-600 bg-neutral-800/60"
                    : "border-transparent"
                }`}
              >
                <span className="w-24 shrink-0 tabular-nums text-2xl text-neutral-400">
                  {formatTime12(e.time)}
                </span>
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    isLive ? "bg-white" : "bg-neutral-600"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-3xl font-medium tracking-tight ${
                      isLive ? "text-neutral-50" : "text-neutral-200"
                    }`}
                  >
                    {e.title.en}
                  </span>
                  <span className="fa block truncate text-xl text-neutral-400">
                    {e.title.fa}
                  </span>
                </span>
                {isLive && (
                  <span className="shrink-0 text-lg text-neutral-300">Now</span>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---- Bits -----------------------------------------------------------------
function ArmGate({ onArm }: { onArm: () => void }) {
  return (
    <button
      onClick={onArm}
      className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-[#0a0a0a]/95 text-center"
    >
      <span className="text-4xl font-semibold tracking-tight">Tap to begin</span>
      <span className="mt-4 text-lg text-neutral-500">
        enables sound on the TV — you’ll hear a soft chime
      </span>
    </button>
  );
}

function Pulse() {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
    </span>
  );
}
