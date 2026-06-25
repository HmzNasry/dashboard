import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { BusMessage, Bilingual } from "../types";
import { playChime } from "../lib/chime";
import { playQueue } from "../lib/player";

interface Entry {
  text: Bilingual;
  id: number;
  settled: boolean;
}

const INTRO_MS = 2600; // big red↔white "ANNOUNCEMENT" pulse before it settles
const SPEAK_DELAY = 300; // extra beat after settle before the message is read
const CALM_RED = "#cf5b54";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Announcement takeover. Two phases per announcement:
 *   1. intro  — a big "ANNOUNCEMENT" pulses calm red ↔ white,
 *   2. settled — it shrinks/rises to its banner spot, the spiral roll begins,
 *      and the EN/FA text appears. The spoken audio waits for the settle.
 * Each announcement is keyed, so firing a new one while one is up cleanly
 * cross-fades instead of snapping.
 */
export function AnnouncementOverlay({
  subscribe,
  onEnded,
}: {
  subscribe: (h: (m: BusMessage) => void) => () => void;
  onEnded: () => void;
}) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const settleTimer = useRef<number | undefined>(undefined);
  const runRef = useRef(0);

  useEffect(() => {
    const finish = () => {
      setEntry(null);
      onEnded();
    };

    const unsub = subscribe(async (msg) => {
      if (msg.type === "stop") {
        runRef.current++;
        window.clearTimeout(settleTimer.current);
        cancelRef.current?.();
        finish();
        return;
      }
      if (msg.type !== "announce") return;

      const my = ++runRef.current;
      window.clearTimeout(settleTimer.current);
      cancelRef.current?.(); // stop any audio still playing from a prior one
      setEntry({ text: msg.payload.text, id: my, settled: false });
      settleTimer.current = window.setTimeout(() => {
        setEntry((e) => (e && e.id === my ? { ...e, settled: true } : e));
      }, INTRO_MS);

      const t0 = performance.now();
      if (msg.payload.chime) await playChime();
      if (runRef.current !== my) return;

      // Hold the spoken message until the intro animation has settled.
      const waited = performance.now() - t0;
      if (waited < INTRO_MS + SPEAK_DELAY) {
        await wait(INTRO_MS + SPEAK_DELAY - waited);
      }
      if (runRef.current !== my) return;

      const urls = msg.payload.order
        .map((l) => msg.payload.audio?.[l])
        .filter((u): u is string => !!u);

      let playedReal = false;
      if (urls.length) {
        const a0 = performance.now();
        const { done, cancel } = playQueue(urls);
        cancelRef.current = cancel;
        await done;
        playedReal = performance.now() - a0 > 1200;
      }
      if (runRef.current !== my) return;

      const { holdMs } = msg.payload;
      const remaining =
        holdMs != null
          ? Math.max(0, holdMs - (performance.now() - t0))
          : playedReal
            ? 1500
            : 7000;
      await wait(remaining);
      if (runRef.current !== my) return;
      finish();
    });
    return unsub;
  }, [subscribe, onEnded]);

  const settled = entry?.settled ?? false;

  return (
    <AnimatePresence>
      {entry && (
        <motion.div
          key="backdrop"
          className="absolute inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          style={{ background: "rgba(12,12,12,0.95)", backdropFilter: "blur(12px)" }}
        >
          <div className="safe relative flex h-full w-full flex-col items-center justify-center text-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="flex w-full flex-col items-center"
              >
                {/* Banner */}
                <div className="flex items-center justify-center gap-6">
                  <motion.span
                    className="h-px w-16 origin-right bg-neutral-600"
                    animate={{ opacity: settled ? 1 : 0, scaleX: settled ? 1 : 0 }}
                    transition={{ duration: 0.5 }}
                  />
                  <motion.div
                    animate={{ scale: settled ? 1 : 2.6 }}
                    transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
                    className="origin-center"
                  >
                    <motion.div
                      animate={
                        settled
                          ? { color: "#ededed" }
                          : { color: [CALM_RED, "#ffffff", CALM_RED] }
                      }
                      transition={
                        settled
                          ? { duration: 0.5 }
                          : { duration: 1.3, repeat: Infinity, ease: "easeInOut" }
                      }
                    >
                      <RollText
                        text="ANNOUNCEMENT"
                        loop={settled}
                        className="font-serif text-[2rem] font-semibold tracking-[0.32em]"
                      />
                    </motion.div>
                  </motion.div>
                  <motion.span
                    className="h-px w-16 origin-left bg-neutral-600"
                    animate={{ opacity: settled ? 1 : 0, scaleX: settled ? 1 : 0 }}
                    transition={{ duration: 0.5 }}
                  />
                </div>

                {/* Body — EN on top, FA on bottom, warm-white shine */}
                {settled && (
                  <motion.div
                    initial={{ opacity: 0, y: 28 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
                    className="mt-12 flex w-full max-w-[86%] flex-col items-center"
                  >
                    <p className="shine-text text-balance text-[clamp(2.25rem,4vw,4rem)] font-semibold leading-tight tracking-tight">
                      {entry.text.en}
                    </p>
                    <div className="my-7 h-px w-28 bg-[rgba(255,240,210,0.35)] shadow-[0_0_10px_rgba(255,235,200,0.3)]" />
                    <p className="fa shine-text text-balance text-[clamp(2.25rem,4vw,4rem)] font-semibold leading-snug tracking-tight">
                      {entry.text.fa}
                    </p>
                  </motion.div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Looping character roll ("horizontal spiral") — two stacked copies per glyph;
// CSS animates the flip with a per-character stagger when `loop` is on.
function RollText({
  text,
  loop,
  className,
}: {
  text: string;
  loop: boolean;
  className?: string;
}) {
  return (
    <span
      className={`roll-text ${loop ? "roll-loop" : ""} ${className ?? ""}`}
      aria-label={text}
    >
      {Array.from(text).map((ch, i) => (
        <span
          aria-hidden="true"
          className="roll-char"
          key={`${ch}-${i}`}
          style={{ "--roll-index": i } as CSSProperties}
        >
          <span>{ch === " " ? " " : ch}</span>
          <span>{ch === " " ? " " : ch}</span>
        </span>
      ))}
    </span>
  );
}
