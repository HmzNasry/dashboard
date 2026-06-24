import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { AppData, Announcement, EventItem } from "../types";
import { createBus } from "../lib/bus";
import { computeState, countdownLabel } from "../lib/time";
import { generateTts, ttsHealth } from "../lib/api";
import { useAnimatedFill } from "../hooks/useAnimatedFill";

type Lang = "en" | "fa";

const ORDERS: { id: string; label: string; value: Lang[] }[] = [
  { id: "en,fa", label: "EN · FA", value: ["en", "fa"] },
  { id: "fa,en", label: "FA · EN", value: ["fa", "en"] },
  { id: "en", label: "EN", value: ["en"] },
  { id: "fa", label: "FA", value: ["fa"] },
];

export function Control({ data }: { data: AppData }) {
  useAnimatedFill();
  const busRef = useRef(createBus());
  const [pinned, setPinned] = useState<string | null>(null);
  const [order, setOrder] = useState<Lang[]>(["en", "fa"]);
  const [chime, setChime] = useState(true);
  const [tts, setTts] = useState({ ready: false, detail: "checking" });
  const [toast, setToast] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    ttsHealth().then(setTts);
  }, []);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const live = useMemo(
    () => computeState(data.schedule.events, pinned),
    [data.schedule.events, pinned],
  );

  function notify(text: string) {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? null : t)), 2200);
  }

  const setCurrent = (id: string | null) => {
    setPinned(id);
    busRef.current.send({ type: "setCurrent", payload: { eventId: id } });
  };

  const fire = (a: Pick<Announcement, "text" | "audio">, label?: string) => {
    busRef.current.send({
      type: "announce",
      payload: { text: a.text, audio: a.audio, chime, order },
    });
    notify(label ? `Broadcasting — ${label}` : "Broadcasting");
  };

  // No toast — the Clear button shows its own checkmark confirmation.
  const stop = () => {
    busRef.current.send({ type: "stop" });
  };

  return (
    <div className="h-screen overflow-y-auto bg-[#0a0a0a] text-neutral-100">
      <TopBar />

      <main className="mx-auto max-w-6xl px-6 py-8">
        <StatusHero live={live} pinned={!!pinned} onClear={stop} />

        <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <ScheduleColumn
            events={data.schedule.events}
            currentId={live.current?.id ?? null}
            pinned={pinned}
            onPick={setCurrent}
          />
          <div className="space-y-10">
            <AnnouncementsColumn
              announcements={data.announcements}
              order={order}
              setOrder={setOrder}
              chime={chime}
              setChime={setChime}
              onFire={fire}
            />
            <Compose tts={tts} order={order} onFire={fire} />
          </div>
        </div>

        <footer className="mt-14 border-t border-neutral-900 pt-6 text-center text-sm text-neutral-500">
          The TV display opens at <code className="text-neutral-300">/</code> ·
          this panel is <code className="text-neutral-300">/control</code>
        </footer>
      </main>

      <Toast text={toast} />
    </div>
  );
}

// ---- Top bar --------------------------------------------------------------
function TopBar() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <header className="sticky top-0 z-20 border-b border-neutral-900 bg-[#0a0a0a]/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <span className="text-[15px] font-semibold tracking-tight">Control</span>
        <span className="text-lg tabular-nums text-neutral-300">
          {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </header>
  );
}

// ---- Status hero ----------------------------------------------------------
function StatusHero({
  live,
  pinned,
  onClear,
}: {
  live: ReturnType<typeof computeState>;
  pinned: boolean;
  onClear: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/40">
      <div className="flex flex-col gap-7 p-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 text-sm text-neutral-400">
            <Pulse />
            <span>On screen now</span>
            <span className="text-neutral-600">·</span>
            <span className="text-neutral-500">
              {pinned ? "pinned" : "following clock"}
            </span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={live.current?.id ?? "pre"}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
              className="mt-3"
            >
              <div className="text-[2rem] font-semibold leading-tight tracking-tight">
                {live.current ? live.current.title.en : "Pre-show"}
              </div>
              {live.current && (
                <div className="fa mt-1 text-2xl text-neutral-400">
                  {live.current.title.fa}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <ClearButton onClear={onClear} />
      </div>

      {/* Up next strip */}
      <div className="flex items-center justify-between gap-4 border-t border-neutral-800 px-8 py-5">
        <div className="min-w-0">
          <div className="text-sm text-neutral-500">Up next</div>
          {live.next ? (
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
              <span className="text-lg font-medium tracking-tight">
                {live.next.title.en}
              </span>
              <span className="fa text-base text-neutral-400">
                {live.next.title.fa}
              </span>
            </div>
          ) : (
            <div className="mt-1 text-lg text-neutral-500">End of evening</div>
          )}
        </div>
        {live.next && (
          <div className="shrink-0 text-right">
            <div className="text-2xl font-semibold tabular-nums tracking-tight">
              {live.next.time}
            </div>
            <div className="text-sm text-neutral-500">
              {countdownLabel(live.next.time)}
            </div>
          </div>
        )}
      </div>

      {live.current && live.next && (
        <div className="h-1 w-full bg-neutral-800">
          <motion.div
            className="h-full bg-neutral-200"
            animate={{ width: `${Math.round(live.progress * 100)}%` }}
            transition={{ duration: 0.8 }}
          />
        </div>
      )}
    </section>
  );
}

// ---- Schedule -------------------------------------------------------------
function ScheduleColumn({
  events,
  currentId,
  pinned,
  onPick,
}: {
  events: EventItem[];
  currentId: string | null;
  pinned: string | null;
  onPick: (id: string | null) => void;
}) {
  return (
    <section>
      <SectionHead title="Schedule">
        <button
          onClick={() => onPick(null)}
          className={`animated-fill rounded-lg border px-3 py-1.5 text-sm transition-colors duration-300 hover:text-black ${
            pinned === null
              ? "border-neutral-400 text-white"
              : "border-neutral-800 text-neutral-400"
          }`}
        >
          Follow clock
        </button>
      </SectionHead>

      <div className="space-y-2.5">
        {events.map((e, i) => {
          const isLive = currentId === e.id;
          const isPinned = pinned === e.id;
          return (
            <motion.button
              key={e.id}
              onClick={() => onPick(isPinned ? null : e.id)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.025 }}
              whileTap={{ scale: 0.99 }}
              className={`flex w-full items-center gap-4 rounded-xl border px-4 py-3.5 text-left transition-colors duration-300 ${
                isLive
                  ? "border-neutral-500 bg-neutral-800/60"
                  : "border-neutral-800 bg-neutral-900/40 hover:border-neutral-600"
              }`}
            >
              <span className="w-12 shrink-0 tabular-nums text-sm text-neutral-400">
                {e.time}
              </span>
              <span
                className={`h-2 w-2 shrink-0 rounded-full transition-colors ${
                  isLive ? "bg-white" : "bg-neutral-600"
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium tracking-tight">
                  {e.title.en}
                </span>
                <span className="fa block truncate text-sm text-neutral-400">
                  {e.title.fa}
                </span>
              </span>
              <span className="shrink-0 text-sm">
                {isLive ? (
                  <span className="text-white">Live</span>
                ) : isPinned ? (
                  <span className="text-neutral-400">Pinned</span>
                ) : (
                  <span className="text-neutral-600">Set live</span>
                )}
              </span>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}

// ---- Announcements --------------------------------------------------------
function AnnouncementsColumn({
  announcements,
  order,
  setOrder,
  chime,
  setChime,
  onFire,
}: {
  announcements: Announcement[];
  order: Lang[];
  setOrder: (v: Lang[]) => void;
  chime: boolean;
  setChime: (v: boolean) => void;
  onFire: (a: Announcement, label: string) => void;
}) {
  return (
    <section>
      <SectionHead title="Announcements">
        <div className="flex items-center gap-2.5">
          <Segmented
            options={ORDERS}
            value={order.join()}
            onChange={(id) => setOrder(ORDERS.find((o) => o.id === id)!.value)}
          />
          <button
            onClick={() => setChime(!chime)}
            className={`animated-fill flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors duration-300 hover:text-black ${
              chime
                ? "border-neutral-400 text-white"
                : "border-neutral-800 text-neutral-500"
            }`}
            title="Cabin chime before each announcement"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${chime ? "bg-white" : "bg-neutral-600"}`}
            />
            Chime
          </button>
        </div>
      </SectionHead>

      <div className="space-y-2.5">
        {announcements.map((a, i) => (
          <motion.div
            key={a.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.025 }}
            className="flex items-center justify-between gap-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 transition-colors duration-300 hover:border-neutral-600"
          >
            <div className="min-w-0">
              <div className="font-medium tracking-tight">{a.label}</div>
              <p className="mt-1 line-clamp-1 text-sm text-neutral-400">
                {a.text.en}
              </p>
              <p className="fa mt-0.5 line-clamp-1 text-sm text-neutral-500">
                {a.text.fa}
              </p>
            </div>
            <button
              onClick={() => onFire(a, a.label)}
              className="animated-fill shrink-0 rounded-lg border border-neutral-400 px-4 py-2 text-sm font-medium text-white transition-colors duration-300 hover:text-black active:scale-95"
            >
              Broadcast
            </button>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ---- Compose (on-demand offline TTS) -------------------------------------
function Compose({
  tts,
  order,
  onFire,
}: {
  tts: { ready: boolean; detail: string };
  order: Lang[];
  onFire: (a: Pick<Announcement, "text" | "audio">, label: string) => void;
}) {
  const [en, setEn] = useState("");
  const [fa, setFa] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const empty = !en.trim() && !fa.trim();

  async function speakNow() {
    setBusy(true);
    setMsg(null);
    try {
      const audio: { en?: string; fa?: string } = {};
      for (const lang of order) {
        const text = lang === "en" ? en : fa;
        if (!text.trim()) continue;
        const r = await generateTts(text, lang);
        if (!r.ok) {
          setMsg(`Couldn’t generate ${lang === "en" ? "English" : "Persian"} audio — ${r.error}`);
          return;
        }
        audio[lang] = r.url;
      }
      onFire({ text: { en, fa }, audio }, "custom");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-medium text-neutral-100">
          Write something now
        </h2>
        <span className="flex items-center gap-2 text-sm text-neutral-400">
          <span
            className={`h-1.5 w-1.5 rounded-full ${tts.ready ? "bg-emerald-400" : "bg-neutral-600"}`}
          />
          {tts.ready ? "Offline voice ready" : "No voice — text shows silently"}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <textarea
          value={en}
          onChange={(e) => setEn(e.target.value)}
          placeholder="English"
          rows={3}
          className="resize-none rounded-xl border border-neutral-800 bg-[#0a0a0a] p-4 text-neutral-100 placeholder:text-neutral-600 outline-none transition focus:border-neutral-500"
        />
        <textarea
          value={fa}
          onChange={(e) => setFa(e.target.value)}
          dir="rtl"
          placeholder="فارسی"
          rows={3}
          className="fa resize-none rounded-xl border border-neutral-800 bg-[#0a0a0a] p-4 text-neutral-100 placeholder:text-neutral-600 outline-none transition focus:border-neutral-500"
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          disabled={busy || empty}
          onClick={speakNow}
          className="animated-fill rounded-xl border border-neutral-400 px-5 py-2.5 text-sm font-medium text-white transition-colors duration-300 hover:text-black active:scale-95 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:text-neutral-600 disabled:hover:text-neutral-600"
        >
          {busy ? "Generating…" : "Generate & broadcast"}
        </button>
        <button
          disabled={empty}
          onClick={() => onFire({ text: { en, fa } }, "custom")}
          className="animated-fill rounded-xl border border-neutral-700 px-5 py-2.5 text-sm text-neutral-300 transition-colors duration-300 hover:text-black disabled:opacity-40 disabled:hover:text-neutral-300"
        >
          Show text only
        </button>
        {msg && <span className="text-sm text-amber-400">{msg}</span>}
      </div>
    </section>
  );
}

// ---- Shared primitives ----------------------------------------------------
function SectionHead({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-medium text-neutral-100">{title}</h2>
      {children}
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-neutral-800 bg-[#0a0a0a] p-1">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className="relative rounded-md px-2.5 py-1 text-sm transition-colors"
        >
          {value === o.id && (
            <motion.span
              layoutId="seg"
              className="absolute inset-0 rounded-md bg-white"
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
            />
          )}
          <span
            className={`relative ${value === o.id ? "text-black" : "text-neutral-400 hover:text-white"}`}
          >
            {o.label}
          </span>
        </button>
      ))}
    </div>
  );
}

function Toast({ text }: { text: string | null }) {
  return (
    <AnimatePresence>
      {text && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-full border border-neutral-700 bg-neutral-900/95 px-5 py-2.5 text-sm shadow-2xl backdrop-blur"
        >
          <span className="flex items-center gap-2.5">
            <Pulse />
            {text}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Pulse() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
    </span>
  );
}

// Destructive action: red outline, red flood on hover, and on click it briefly
// shows a drawn-in checkmark on the button itself (no toast) before reverting.
function ClearButton({ onClear }: { onClear: () => void }) {
  const [done, setDone] = useState(false);
  const click = () => {
    onClear();
    setDone(true);
    window.setTimeout(() => setDone(false), 2000);
  };
  return (
    <button
      onClick={click}
      className="animated-fill fill-danger shrink-0 rounded-xl border border-red-800/70 px-5 py-2.5 text-sm font-medium text-red-300 transition-colors duration-300 hover:text-white"
    >
      <span className="grid min-h-[22px] min-w-[92px] place-items-center">
        <AnimatePresence mode="wait" initial={false}>
          {done ? (
            <motion.span
              key="done"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="text-emerald-400"
            >
              <CheckMark />
            </motion.span>
          ) : (
            <motion.span
              key="label"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              Clear screen
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </button>
  );
}

function CheckMark() {
  return (
    <motion.svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <motion.path
        d="M20 6 9 17l-5-5"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      />
    </motion.svg>
  );
}
