import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import QRCode from "qrcode";
import type { AppData, Announcement, DeviceInfo, EventItem } from "../types";
import { connect, guessName, type NetClient, type NetState } from "../lib/net";
import { computeState, countdownLabel, toMinutes } from "../lib/time";
import {
  generateTts,
  ttsHealth,
  saveSchedule,
  saveAnnouncements,
} from "../lib/api";
import { useAnimatedFill } from "../hooks/useAnimatedFill";

type Lang = "en" | "fa";

const ORDERS: { id: string; label: string; value: Lang[] }[] = [
  { id: "en,fa", label: "EN · FA", value: ["en", "fa"] },
  { id: "fa,en", label: "FA · EN", value: ["fa", "en"] },
  { id: "en", label: "EN", value: ["en"] },
  { id: "fa", label: "FA", value: ["fa"] },
];

const inputCls =
  "w-full rounded-lg border border-neutral-800 bg-[#0a0a0a] px-3.5 py-2.5 text-neutral-100 placeholder:text-neutral-600 outline-none transition focus:border-neutral-500";

export function Control({
  data,
  reload,
}: {
  data: AppData;
  reload: () => void;
}) {
  useAnimatedFill();
  const clientRef = useRef<NetClient | null>(null);
  if (!clientRef.current)
    clientRef.current = connect({ role: "control", name: guessName() });
  const client = clientRef.current;

  const [pinned, setPinned] = useState<string | null>(null);
  const [order, setOrder] = useState<Lang[]>(["en", "fa"]);
  const [chime, setChime] = useState(true);
  const [tts, setTts] = useState({ ready: false, detail: "checking" });
  const [toast, setToast] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [net, setNet] = useState<NetState>({
    connected: false,
    me: null,
    devices: [],
    serverUrls: [],
    removed: false,
  });
  const [eventEdit, setEventEdit] = useState<EventItem | "new" | null>(null);
  const [annEdit, setAnnEdit] = useState<Announcement | "new" | null>(null);
  const [, tick] = useState(0);

  useEffect(() => () => client.close(), [client]);
  useEffect(() => {
    ttsHealth().then(setTts);
  }, []);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => client.onState(setNet), [client]);
  // The TV tells us when an announcement finishes (5-min timeout or cleared) so
  // the toggle button can flip back to "Broadcast".
  useEffect(
    () =>
      client.onBus((m) => {
        if (m.type === "announceEnded") setActiveId(null);
      }),
    [client],
  );

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
    client.send({ type: "setCurrent", payload: { eventId: id } });
  };

  // Broadcasts stay up for 5 minutes (or until cleared).
  const HOLD_MS = 5 * 60 * 1000;

  const fire = (a: Pick<Announcement, "text" | "audio">, label?: string) => {
    client.send({
      type: "announce",
      payload: { text: a.text, audio: a.audio, chime, order, holdMs: HOLD_MS },
    });
    notify(label ? `Broadcasting — ${label}` : "Broadcasting");
  };

  // Library broadcast: generate speech from the announcement text (Piper, server
  // cached) so it's actually read aloud, then send it and mark it live.
  const broadcast = async (a: Announcement) => {
    setActiveId(a.id);
    const audio: { en?: string; fa?: string } = {};
    for (const lang of order) {
      const text = a.text[lang];
      if (!text || !text.trim()) continue;
      const r = await generateTts(text, lang);
      if (r.ok && r.url) audio[lang] = r.url;
    }
    fire({ text: a.text, audio }, a.label);
  };

  // No toast — clearing is its own confirmation (checkmark / button flip).
  const stop = () => {
    setActiveId(null);
    client.send({ type: "stop" });
  };

  // ---- Editing schedule + announcements ----------------------------------
  const events = data.schedule.events;
  const announcements = data.announcements;

  const persistSchedule = async (newEvents: EventItem[]) => {
    const sorted = [...newEvents].sort(
      (a, b) => toMinutes(a.time) - toMinutes(b.time),
    );
    await saveSchedule({ ...data.schedule, events: sorted });
    reload();
    client.send({ type: "reload" });
  };
  const upsertEvent = (ev: EventItem) => {
    const list = events.some((e) => e.id === ev.id)
      ? events.map((e) => (e.id === ev.id ? ev : e))
      : [...events, ev];
    persistSchedule(list);
    setEventEdit(null);
  };
  const deleteEvent = (ev: EventItem) => {
    if (window.confirm(`Delete “${ev.title.en}”?`)) {
      persistSchedule(events.filter((e) => e.id !== ev.id));
    }
  };

  const persistAnns = async (list: Announcement[]) => {
    await saveAnnouncements(list);
    reload();
    client.send({ type: "reload" });
  };
  const upsertAnn = (a: Announcement) => {
    const list = announcements.some((x) => x.id === a.id)
      ? announcements.map((x) => (x.id === a.id ? a : x))
      : [...announcements, a];
    persistAnns(list);
    setAnnEdit(null);
  };
  const deleteAnn = (a: Announcement) => {
    if (window.confirm(`Delete “${a.label}”?`)) {
      persistAnns(announcements.filter((x) => x.id !== a.id));
    }
  };

  // This device was removed by the admin — gone until the link is opened again.
  if (net.removed) {
    return <RemovedScreen />;
  }
  // A remote (phone) that hasn't been approved yet waits on a gate.
  if (net.me && !net.me.admin && !net.me.approved) {
    return <WaitingScreen connected={net.connected} name={net.me.name} />;
  }

  return (
    <div className="h-screen overflow-y-auto bg-[#0a0a0a] text-neutral-100">
      <TopBar connected={net.connected} />

      <main className="mx-auto max-w-6xl px-6 py-8">
        <StatusHero live={live} pinned={!!pinned} onClear={stop} />

        <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <ScheduleColumn
            events={data.schedule.events}
            currentId={live.current?.id ?? null}
            pinned={pinned}
            onPick={setCurrent}
            onAdd={() => setEventEdit("new")}
            onEdit={setEventEdit}
            onDelete={deleteEvent}
          />
          <div className="space-y-10">
            <AnnouncementsColumn
              announcements={data.announcements}
              order={order}
              setOrder={setOrder}
              chime={chime}
              setChime={setChime}
              activeId={activeId}
              onBroadcast={broadcast}
              onClear={stop}
              onAdd={() => setAnnEdit("new")}
              onEdit={setAnnEdit}
              onDelete={deleteAnn}
            />
            <Compose tts={tts} order={order} onFire={fire} />
          </div>
        </div>

        {net.me?.admin && (
          <DevicesPanel
            devices={net.devices}
            serverUrls={net.serverUrls}
            admin={client.admin}
          />
        )}

        <footer className="mt-14 border-t border-neutral-900 pt-6 text-center text-sm text-neutral-500">
          The TV display opens at <code className="text-neutral-300">/</code> ·
          this panel is <code className="text-neutral-300">/control</code>
        </footer>
      </main>

      <Toast text={toast} />

      <AnimatePresence>
        {eventEdit && (
          <EventEditor
            initial={eventEdit === "new" ? null : eventEdit}
            onSave={upsertEvent}
            onCancel={() => setEventEdit(null)}
          />
        )}
        {annEdit && (
          <AnnouncementEditor
            initial={annEdit === "new" ? null : annEdit}
            onSave={upsertAnn}
            onCancel={() => setAnnEdit(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---- Top bar --------------------------------------------------------------
function TopBar({ connected }: { connected: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <header className="sticky top-0 z-20 border-b border-neutral-900 bg-[#0a0a0a]/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <span className="text-[15px] font-semibold tracking-tight">Control</span>
        <div className="flex items-center gap-5 text-sm">
          <span className="flex items-center gap-2 text-neutral-400">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connected ? "bg-emerald-400" : "bg-amber-400"
              }`}
            />
            {connected ? "Connected" : "Reconnecting…"}
          </span>
          <span className="tabular-nums text-neutral-300">
            {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </div>
    </header>
  );
}

// ---- Devices / phone setup (admin only) ----------------------------------
function DevicesPanel({
  devices,
  serverUrls,
  admin,
}: {
  devices: DeviceInfo[];
  serverUrls: string[];
  admin: NetClient["admin"];
}) {
  const url = serverUrls[0];
  const pending = devices.filter(
    (d) => d.role === "control" && !d.admin && !d.approved,
  );
  const others = devices.filter((d) => !(d.role === "control" && !d.admin && !d.approved));

  return (
    <section className="mt-12 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h2 className="text-base font-medium text-neutral-100">Devices</h2>
          <p className="mt-1 max-w-md text-sm text-neutral-500">
            Open this address on your phone (same Wi-Fi or hotspot), then approve
            it here to use it as a remote.
          </p>
          {url ? (
            <a
              href={url}
              className="mt-3 inline-block rounded-lg border border-neutral-700 px-3 py-1.5 font-mono text-sm text-neutral-200"
            >
              {url}
            </a>
          ) : (
            <p className="mt-3 text-sm text-amber-400">
              No network address found — connect the laptop to Wi-Fi or start a
              hotspot.
            </p>
          )}
        </div>
        {url && <Qr text={url} />}
      </div>

      {pending.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 text-sm text-amber-400">
            Waiting for approval
          </div>
          <div className="space-y-2">
            {pending.map((d) => (
              <DeviceRow key={d.id} d={d} admin={admin} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 space-y-2">
        {others.map((d) => (
          <DeviceRow key={d.id} d={d} admin={admin} />
        ))}
      </div>
    </section>
  );
}

function StatusBadge({ approved }: { approved: boolean }) {
  return approved ? (
    <span
      title="Approved"
      className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-emerald-500 text-black"
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  ) : (
    <span
      title="Pending approval"
      className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-amber-500 text-[12px] font-bold leading-none text-black"
    >
      !
    </span>
  );
}

function PhoneGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <line x1="11" y1="18" x2="13" y2="18" />
    </svg>
  );
}
function LaptopGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <line x1="2" y1="20" x2="22" y2="20" />
    </svg>
  );
}
function TabletGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <line x1="11" y1="18" x2="13" y2="18" />
    </svg>
  );
}
function TvGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <polyline points="8 21 12 17 16 21" />
    </svg>
  );
}

function DeviceTypeIcon({ d }: { d: DeviceInfo }) {
  const n = d.name.toLowerCase();
  let glyph;
  if (d.role === "display") glyph = <TvGlyph />;
  else if (/iphone|android|phone/.test(n)) glyph = <PhoneGlyph />;
  else if (/ipad|tablet/.test(n)) glyph = <TabletGlyph />;
  else glyph = <LaptopGlyph />;
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-neutral-800 text-neutral-300">
      {glyph}
    </span>
  );
}

function DeviceRow({
  d,
  admin,
}: {
  d: DeviceInfo;
  admin: NetClient["admin"];
}) {
  const rename = () => {
    const name = window.prompt("Rename device", d.name);
    if (name && name.trim()) admin.rename(d.id, name.trim());
  };
  return (
    <div
      className={`flex items-center gap-4 rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 ${
        d.connected ? "" : "opacity-70"
      }`}
    >
      <DeviceTypeIcon d={d} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium tracking-tight">{d.name}</span>
          <StatusBadge approved={d.approved} />
          {d.admin && (
            <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
              this laptop
            </span>
          )}
          {d.role === "display" && (
            <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
              TV
            </span>
          )}
        </div>
        <div className="text-xs text-neutral-500">
          {d.role === "control" ? "Remote" : "Display"}
          {d.ip ? ` · ${d.ip}` : ""} ·{" "}
          <span className={d.connected ? "text-emerald-400" : "text-red-400"}>
            {d.connected ? "online" : "offline"}
          </span>
        </div>
      </div>

      {/* Actions only for remote controls (phones) */}
      {d.role === "control" && !d.admin && (
        <div className="flex shrink-0 items-center gap-2">
          {!d.approved ? (
            <button
              onClick={() => admin.approve(d.id)}
              className="animated-fill rounded-lg border border-emerald-600/70 px-3 py-1.5 text-sm text-emerald-300 transition-colors duration-300 hover:text-black"
              style={{ "--fill-base": "16 185 129" } as CSSProperties}
            >
              Approve
            </button>
          ) : (
            <button
              onClick={() => admin.remove(d.id)}
              className="animated-fill fill-danger rounded-lg border border-red-700/70 px-3 py-1.5 text-sm text-red-300 transition-colors duration-300 hover:text-white"
            >
              Revoke
            </button>
          )}
          <button
            onClick={rename}
            className="animated-fill rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 transition-colors duration-300 hover:text-black"
          >
            Rename
          </button>
        </div>
      )}
    </div>
  );
}

function Qr({ text }: { text: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(text, {
      width: 128,
      margin: 1,
      color: { dark: "#0a0a0a", light: "#ffffff" },
    })
      .then(setSrc)
      .catch(() => setSrc(null));
  }, [text]);
  return src ? (
    <img
      src={src}
      alt="Scan to open on phone"
      className="h-32 w-32 rounded-lg border border-neutral-800 bg-white p-1"
    />
  ) : null;
}

// ---- Waiting-for-approval gate (shown on an unapproved phone) -------------
function WaitingScreen({
  connected,
  name,
}: {
  connected: boolean;
  name: string;
}) {
  return (
    <div className="flex h-screen flex-col items-center justify-center bg-[#0a0a0a] px-8 text-center text-neutral-100">
      <span className="relative flex h-3 w-3">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-400" />
      </span>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">
        Waiting for approval
      </h1>
      <p className="mt-2 max-w-sm text-neutral-400">
        Approve <span className="text-neutral-200">“{name}”</span> in the Devices
        panel on the laptop to use this phone as a remote.
      </p>
      <p className="mt-4 text-sm text-neutral-600">
        {connected ? "Connected to the dashboard" : "Connecting…"}
      </p>
    </div>
  );
}

function RemovedScreen() {
  return (
    <div className="flex h-screen flex-col items-center justify-center bg-[#0a0a0a] px-8 text-center text-neutral-100">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-red-500/15 text-2xl text-red-400">
        ✕
      </span>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">
        Device removed
      </h1>
      <p className="mt-2 max-w-sm text-neutral-400">
        This phone’s access was revoked. Open the link again — or rescan the QR
        code on the laptop — to reconnect.
      </p>
    </div>
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
  onAdd,
  onEdit,
  onDelete,
}: {
  events: EventItem[];
  currentId: string | null;
  pinned: string | null;
  onPick: (id: string | null) => void;
  onAdd: () => void;
  onEdit: (e: EventItem) => void;
  onDelete: (e: EventItem) => void;
}) {
  return (
    <section>
      <SectionHead title="Schedule">
        <div className="flex items-center gap-2">
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
          <button
            onClick={onAdd}
            className="animated-fill rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 transition-colors duration-300 hover:text-black"
          >
            + Add event
          </button>
        </div>
      </SectionHead>

      <div className="space-y-2.5">
        {events.map((e, i) => {
          const isLive = currentId === e.id;
          const isPinned = pinned === e.id;
          return (
            <motion.div
              key={e.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.025 }}
              className={`group flex items-center gap-3 rounded-xl border px-4 py-3.5 transition-colors duration-300 ${
                isLive
                  ? "border-neutral-500 bg-neutral-800/60"
                  : "border-neutral-800 bg-neutral-900/40 hover:border-neutral-600"
              }`}
            >
              <button
                onClick={() => onPick(isPinned ? null : e.id)}
                className="flex min-w-0 flex-1 items-center gap-4 text-left"
                title={isPinned ? "Release to clock" : "Set live"}
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
              </button>

              {isLive && (
                <span className="shrink-0 text-sm text-white">Live</span>
              )}
              <IconButton label="Edit event" onClick={() => onEdit(e)}>
                <PencilIcon />
              </IconButton>
              <IconButton label="Delete event" danger onClick={() => onDelete(e)}>
                <TrashIcon />
              </IconButton>
            </motion.div>
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
  activeId,
  onBroadcast,
  onClear,
  onAdd,
  onEdit,
  onDelete,
}: {
  announcements: Announcement[];
  order: Lang[];
  setOrder: (v: Lang[]) => void;
  chime: boolean;
  setChime: (v: boolean) => void;
  activeId: string | null;
  onBroadcast: (a: Announcement) => void;
  onClear: () => void;
  onAdd: () => void;
  onEdit: (a: Announcement) => void;
  onDelete: (a: Announcement) => void;
}) {
  return (
    <section>
      <SectionHead title="Announcements">
        <div className="flex flex-wrap items-center gap-2.5">
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
          <button
            onClick={onAdd}
            className="animated-fill rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 transition-colors duration-300 hover:text-black"
          >
            + Add
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
            <div className="flex shrink-0 items-center gap-2">
              <BroadcastButton
                active={activeId === a.id}
                onBroadcast={() => onBroadcast(a)}
                onClear={onClear}
              />
              <IconButton label="Edit announcement" onClick={() => onEdit(a)}>
                <PencilIcon />
              </IconButton>
              <IconButton
                label="Delete announcement"
                danger
                onClick={() => onDelete(a)}
              >
                <TrashIcon />
              </IconButton>
            </div>
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

// Per-announcement toggle: "Broadcast" sends it (stays up 5 min); while live the
// button smoothly turns red and reads "CLEAR" — clicking clears the screen and
// flips it back. Backgroundless; the colour only fills in via the hover effect.
function BroadcastButton({
  active,
  onBroadcast,
  onClear,
}: {
  active: boolean;
  onBroadcast: () => void;
  onClear: () => void;
}) {
  return (
    <button
      onClick={active ? onClear : onBroadcast}
      className={`animated-fill shrink-0 rounded-lg border px-4 py-2 text-sm font-medium transition-colors duration-300 active:scale-95 ${
        active
          ? "fill-danger border-red-700/70 text-red-300 hover:text-white"
          : "border-neutral-400 text-white hover:text-black"
      }`}
    >
      <span className="grid min-w-[84px] place-items-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={active ? "clear" : "broadcast"}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.2 }}
          >
            {active ? "CLEAR" : "Broadcast"}
          </motion.span>
        </AnimatePresence>
      </span>
    </button>
  );
}

// ---- Edit / delete bits ---------------------------------------------------
function IconButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-neutral-800 text-neutral-400 transition hover:border-neutral-600 ${
        danger ? "hover:text-red-300" : "hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function PencilIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
    </svg>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl"
        initial={{ scale: 0.96, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, y: 8 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-neutral-500 transition hover:text-white"
          >
            ✕
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

function EditorActions({
  onCancel,
  onSave,
  canSave,
}: {
  onCancel: () => void;
  onSave: () => void;
  canSave: boolean;
}) {
  return (
    <div className="flex justify-end gap-3 pt-2">
      <button
        onClick={onCancel}
        className="animated-fill rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 transition-colors duration-300 hover:text-black"
      >
        Cancel
      </button>
      <button
        onClick={onSave}
        disabled={!canSave}
        className="rounded-lg bg-white px-5 py-2 text-sm font-medium text-black transition hover:bg-neutral-200 active:scale-95 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-600"
      >
        Save
      </button>
    </div>
  );
}

function EventEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: EventItem | null;
  onSave: (e: EventItem) => void;
  onCancel: () => void;
}) {
  const [time, setTime] = useState(initial?.time ?? "18:00");
  const [titleEn, setTitleEn] = useState(initial?.title.en ?? "");
  const [titleFa, setTitleFa] = useState(initial?.title.fa ?? "");
  const [bodyEn, setBodyEn] = useState(initial?.body?.en ?? "");
  const [bodyFa, setBodyFa] = useState(initial?.body?.fa ?? "");
  const canSave = !!time && !!(titleEn.trim() || titleFa.trim());

  const save = () => {
    const hasBody = bodyEn.trim() || bodyFa.trim();
    onSave({
      id: initial?.id ?? `e${Date.now()}`,
      time,
      title: { en: titleEn.trim(), fa: titleFa.trim() },
      ...(hasBody ? { body: { en: bodyEn.trim(), fa: bodyFa.trim() } } : {}),
    });
  };

  return (
    <Modal title={initial ? "Edit event" : "Add event"} onClose={onCancel}>
      <div className="space-y-4">
        <Field label="Time">
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-40 rounded-lg border border-neutral-800 bg-[#0a0a0a] px-3.5 py-2.5 text-neutral-100 outline-none transition focus:border-neutral-500"
          />
        </Field>
        <Field label="Title — English">
          <input
            value={titleEn}
            onChange={(e) => setTitleEn(e.target.value)}
            placeholder="Dinner Service"
            className={inputCls}
          />
        </Field>
        <Field label="Title — Farsi">
          <input
            dir="rtl"
            value={titleFa}
            onChange={(e) => setTitleFa(e.target.value)}
            placeholder="صرف شام"
            className={`fa ${inputCls}`}
          />
        </Field>
        <Field label="Body — English">
          <textarea
            rows={2}
            value={bodyEn}
            onChange={(e) => setBodyEn(e.target.value)}
            placeholder="Guests are invited to enjoy dinner and fellowship."
            className={`resize-none ${inputCls}`}
          />
        </Field>
        <Field label="Body — Farsi">
          <textarea
            rows={2}
            dir="rtl"
            value={bodyFa}
            onChange={(e) => setBodyFa(e.target.value)}
            placeholder="از مهمانان دعوت می‌شود از شام لذت ببرند."
            className={`fa resize-none ${inputCls}`}
          />
        </Field>
        <EditorActions onCancel={onCancel} onSave={save} canSave={canSave} />
      </div>
    </Modal>
  );
}

function AnnouncementEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: Announcement | null;
  onSave: (a: Announcement) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [textEn, setTextEn] = useState(initial?.text.en ?? "");
  const [textFa, setTextFa] = useState(initial?.text.fa ?? "");
  const canSave = !!label.trim() && !!(textEn.trim() || textFa.trim());

  const save = () =>
    onSave({
      id: initial?.id ?? `a${Date.now()}`,
      label: label.trim(),
      chime: initial?.chime ?? true,
      text: { en: textEn.trim(), fa: textFa.trim() },
      ...(initial?.audio ? { audio: initial.audio } : {}),
    });

  return (
    <Modal
      title={initial ? "Edit announcement" : "Add announcement"}
      onClose={onCancel}
    >
      <div className="space-y-4">
        <Field label="Button label">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Dinner is served"
            className={inputCls}
          />
        </Field>
        <Field label="Message — English">
          <textarea
            rows={3}
            value={textEn}
            onChange={(e) => setTextEn(e.target.value)}
            className={`resize-none ${inputCls}`}
          />
        </Field>
        <Field label="Message — Farsi">
          <textarea
            rows={3}
            dir="rtl"
            value={textFa}
            onChange={(e) => setTextFa(e.target.value)}
            className={`fa resize-none ${inputCls}`}
          />
        </Field>
        <EditorActions onCancel={onCancel} onSave={save} canSave={canSave} />
      </div>
    </Modal>
  );
}
