import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { AppData, BusMessage, EventItem } from "../types";
import { connect, type NetClient } from "../lib/net";
import { computeState, formatTime12, toMinutes } from "../lib/time";
import { Background } from "../components/Background";
import { AnnouncementOverlay } from "../components/AnnouncementOverlay";
import { unlockAudio, playChime } from "../lib/chime";

// The TV screen — clean, light, large-type. Read-only: driven by the wall clock
// and by messages from the Control panel over the BroadcastChannel bus.
export function Display({
  data,
  reload,
}: {
  data: AppData;
  reload: () => void;
}) {
  const clientRef = useRef<NetClient | null>(null);
  if (!clientRef.current) clientRef.current = connect({ role: "display", name: "TV display" });
  const client = clientRef.current;
  const [manualId, setManualId] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => () => client.close(), [client]);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  // No on-screen prompt: silently unlock audio on the first interaction with
  // the TV window (a click, key press, or F11 all count).
  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      setArmed(true);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    const off = client.onBus((m: BusMessage) => {
      if (m.type === "setCurrent") setManualId(m.payload.eventId);
      else if (m.type === "reload") reload();
    });
    return off;
  }, [client, reload]);

  const state = useMemo(
    () => computeState(data.schedule.events, manualId),
    [data.schedule.events, manualId],
  );

  // Ring the cabin chime whenever the live segment changes (once audio armed).
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

  const subscribe = (h: (m: BusMessage) => void) => client.onBus(h);

  return (
    <div className="relative h-full w-full bg-[#f4f2ed] text-neutral-900">
      <Background />

      <div className="safe relative flex h-full flex-col">
        <TopBar title={data.schedule.date} />
        <div className="grid flex-1 grid-cols-[1.7fr_1fr] gap-8 overflow-hidden pt-8">
          <NowHero state={state} />
          <Schedule
            events={data.schedule.events}
            currentId={state.current?.id ?? null}
          />
        </div>
      </div>

      <AnnouncementOverlay
        subscribe={subscribe}
        onEnded={() => client.send({ type: "announceEnded" })}
      />
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
    <header className="flex items-center justify-between border-b border-neutral-300 pb-6">
      <span className="text-3xl font-semibold tracking-tight">{title}</span>
      <span className="text-4xl font-medium tabular-nums tracking-tight text-neutral-800">
        {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </span>
    </header>
  );
}

// ---- Now (hero) -----------------------------------------------------------
function NowHero({ state }: { state: ReturnType<typeof computeState> }) {
  const { current, next, progress } = state;
  const bodyCls =
    "text-balance text-[clamp(1.8rem,3.3vw,3.5rem)] font-semibold leading-tight tracking-tight";
  const smallTitle = "text-2xl font-medium text-neutral-500";

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <AnimatePresence mode="wait">
          <motion.div
            key={current?.id ?? "pre"}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="flex min-h-0 flex-1 flex-col"
          >
            {current ? (
              <>
                {/* English — small title top-left, body is the main text */}
                <div className="relative flex flex-1 flex-col items-center justify-center px-14 text-center">
                  <span className={`absolute left-8 top-4 ${smallTitle}`}>
                    {current.title.en}
                  </span>
                  <p className={bodyCls}>
                    {current.body?.en || current.title.en}
                  </p>
                </div>

                <div className="mx-10 h-px bg-neutral-200" />

                {/* Farsi — small title top-right, body is the main text */}
                <div className="relative flex flex-1 flex-col items-center justify-center px-14 text-center">
                  <span className={`fa absolute right-8 top-4 ${smallTitle}`}>
                    {current.title.fa}
                  </span>
                  <p className={`fa ${bodyCls}`}>
                    {current.body?.fa || current.title.fa}
                  </p>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <h2 className="text-6xl font-semibold tracking-tight text-neutral-400">
                  Pre-show
                </h2>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Up next */}
      <div className="flex items-center justify-between gap-8 border-t border-neutral-200 px-12 py-7">
        <div className="min-w-0">
          <div className="text-lg text-neutral-500">Up next</div>
          {next ? (
            <>
              <div className="mt-2 text-4xl font-semibold tracking-tight">
                {next.title.en}
              </div>
              <div className="fa mt-1.5 text-3xl text-neutral-500">
                {next.title.fa}
              </div>
            </>
          ) : (
            <div className="mt-2 text-4xl text-neutral-400">
              End of the evening
            </div>
          )}
        </div>
        {next && (
          <div className="shrink-0 text-right">
            <div className="text-4xl font-semibold tabular-nums tracking-tight">
              {formatTime12(next.time)}
            </div>
            <div className="mt-1 text-lg tabular-nums text-neutral-500">
              <Countdown time={next.time} />
            </div>
          </div>
        )}
      </div>

      {current && next && (
        <div className="h-1.5 w-full bg-neutral-200">
          <motion.div
            className="h-full bg-neutral-900"
            animate={{ width: `${Math.round(progress * 100)}%` }}
            transition={{ duration: 1, ease: "linear" }}
          />
        </div>
      )}
    </section>
  );
}

// Live H:MM:SS countdown to the next event.
function Countdown({ time }: { time: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const [h, m] = time.split(":").map(Number);
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  let secs = Math.max(0, Math.floor((target.getTime() - now.getTime()) / 1000));
  const hh = Math.floor(secs / 3600);
  secs %= 3600;
  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return <>{`${hh}:${pad(mm)}:${pad(ss)}`}</>;
}

// ---- Schedule -------------------------------------------------------------
function Schedule({
  events,
  currentId,
}: {
  events: EventItem[];
  currentId: string | null;
}) {
  const ordered = [...events].sort(
    (a, b) => toMinutes(a.time) - toMinutes(b.time),
  );
  const currentIdx = ordered.findIndex((e) => e.id === currentId);
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-200 px-8 py-6 text-2xl font-semibold tracking-tight">
        Schedule
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-3 py-1">
        {ordered.map((e, i) => {
          const isLive = e.id === currentId;
          const done = currentIdx !== -1 && i < currentIdx;
          return (
            <motion.div
              key={e.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: done ? 0.45 : 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.4 }}
              className={`flex min-h-0 flex-1 items-center gap-6 px-5 transition-colors ${
                isLive
                  ? "my-0.5 rounded-xl border-2 border-neutral-900 bg-neutral-100"
                  : "border-b border-neutral-200/70 last:border-b-0"
              }`}
            >
              <span
                className={`w-24 shrink-0 whitespace-nowrap tabular-nums text-lg ${
                  isLive ? "text-neutral-700" : "text-neutral-500"
                }`}
              >
                {formatTime12(e.time)}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-[1.55rem] font-medium leading-tight tracking-tight ${
                    isLive ? "text-neutral-900" : "text-neutral-700"
                  }`}
                >
                  {e.title.en}
                </div>
                <div
                  className={`fa mt-0.5 truncate text-[1.7rem] leading-tight ${
                    isLive ? "text-neutral-600" : "text-neutral-500"
                  }`}
                >
                  {e.title.fa}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
