import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { BusMessage, Bilingual } from "../types";
import { playChime } from "../lib/chime";
import { playQueue } from "../lib/player";

interface Active {
  text: Bilingual;
}

const INTRO_MS = 2600; // how long the big red↔white "ANNOUNCEMENT" pulses
const CALM_RED = "#cf5b54";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Announcement takeover. Two phases:
 *   1. intro  — a big "ANNOUNCEMENT" pulses calm red ↔ white,
 *   2. settled — it shrinks/rises to its banner spot, the red pulse stops, the
 *      horizontal-spiral roll begins, and the EN/FA text slides in.
 */
export function AnnouncementOverlay({
  subscribe,
  onEnded,
}: {
  subscribe: (h: (m: BusMessage) => void) => () => void;
  onEnded: () => void;
}) {
  const [active, setActive] = useState<Active | null>(null);
  const [settled, setSettled] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const settleTimer = useRef<number | undefined>(undefined);
  const runRef = useRef(0);

  useEffect(() => {
    const hide = () => {
      setActive(null);
      setSettled(false);
      onEnded();
    };

    const unsub = subscribe(async (msg) => {
      if (msg.type === "stop") {
        runRef.current++;
        window.clearTimeout(settleTimer.current);
        cancelRef.current?.();
        hide();
        return;
      }
      if (msg.type !== "announce") return;

      const myRun = ++runRef.current;
      window.clearTimeout(settleTimer.current);
      cancelRef.current?.();
      setActive({ text: msg.payload.text });
      setSettled(false);
      settleTimer.current = window.setTimeout(() => {
        if (runRef.current === myRun) setSettled(true);
      }, INTRO_MS);

      const t0 = performance.now();
      if (msg.payload.chime) await playChime();
      if (runRef.current !== myRun) return;

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
      if (runRef.current !== myRun) return;

      // How long to stay up: explicit hold (e.g. 5 min), else audio-based.
      const { holdMs } = msg.payload;
      const remaining =
        holdMs != null
          ? Math.max(0, holdMs - (performance.now() - t0))
          : playedReal
            ? 1500
            : 7000;

      await wait(remaining);
      if (runRef.current !== myRun) return;
      hide();
    });
    return unsub;
  }, [subscribe, onEnded]);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="absolute inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          style={{ background: "rgba(12,12,12,0.95)", backdropFilter: "blur(12px)" }}
        >
          <div className="safe relative flex h-full w-full flex-col items-center justify-center text-center">
            {/* Banner — animates from big centered to small top spot */}
            <motion.div
              layout="position"
              className="flex items-center justify-center gap-6"
            >
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
            </motion.div>

            {/* Body — EN on top, FA on bottom, same size, warm-white shine */}
            <AnimatePresence>
              {settled && (
                <motion.div
                  key="body"
                  initial={{ opacity: 0, y: 28 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
                  className="mt-12 flex w-full max-w-[86%] flex-col items-center"
                >
                  <p className="shine-text text-balance text-[clamp(2.25rem,4vw,4rem)] font-semibold leading-tight tracking-tight">
                    {active.text.en}
                  </p>
                  <div className="my-7 h-px w-28 bg-[rgba(255,240,210,0.35)] shadow-[0_0_10px_rgba(255,235,200,0.3)]" />
                  <p className="fa shine-text text-balance text-[clamp(2.25rem,4vw,4rem)] font-semibold leading-snug tracking-tight">
                    {active.text.fa}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Looping character roll ("horizontal spiral") — two stacked copies per glyph;
// CSS animates the flip with a per-character stagger when `loop` is on. Colour
// is inherited so the parent can pulse it.
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
