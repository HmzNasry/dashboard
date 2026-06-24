import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { BusMessage, Bilingual } from "../types";
import { playChime } from "../lib/chime";
import { playQueue } from "../lib/player";

interface Active {
  text: Bilingual;
}

/**
 * Listens on the bus for "announce" messages. When one arrives it dims the
 * dashboard, plays the cabin chime, plays the audio in the chosen order, then
 * fades out. The "Announcement" banner uses the looping character roll.
 */
export function AnnouncementOverlay({
  subscribe,
}: {
  subscribe: (h: (m: BusMessage) => void) => () => void;
}) {
  const [active, setActive] = useState<Active | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const unsub = subscribe(async (msg) => {
      if (msg.type === "stop") {
        cancelRef.current?.();
        setActive(null);
        return;
      }
      if (msg.type !== "announce") return;

      cancelRef.current?.();
      setActive({ text: msg.payload.text });

      if (msg.payload.chime) await playChime();

      const urls = msg.payload.order
        .map((l) => msg.payload.audio?.[l])
        .filter((u): u is string => !!u);

      if (urls.length) {
        const t0 = performance.now();
        const { done, cancel } = playQueue(urls);
        cancelRef.current = cancel;
        await done;
        // If the files don't exist yet they "finish" instantly — hold the text
        // long enough to read instead of flashing past.
        const played = performance.now() - t0;
        await new Promise((r) => setTimeout(r, played < 1200 ? 6000 : 1500));
      } else {
        await new Promise((r) => setTimeout(r, 7000));
      }
      setActive(null);
    });
    return unsub;
  }, [subscribe]);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="absolute inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          style={{ background: "rgba(10,10,10,0.93)", backdropFilter: "blur(12px)" }}
        >
          <motion.div
            className="safe max-w-[82%] text-center"
            initial={{ scale: 0.95, y: 16 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, y: -10 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="mb-12 flex items-center justify-center gap-6 text-neutral-300">
              <span className="h-px w-16 bg-neutral-700" />
              <RollText
                text="ANNOUNCEMENT"
                className="text-2xl font-medium tracking-[0.4em] text-white"
              />
              <span className="h-px w-16 bg-neutral-700" />
            </div>
            <p className="text-balance text-7xl font-semibold leading-tight tracking-tight text-neutral-50">
              {active.text.en}
            </p>
            <p className="fa mt-10 text-balance text-5xl leading-relaxed text-neutral-300">
              {active.text.fa}
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Looping character roll ("horizontal spiral"): two stacked copies of each
// glyph; CSS animates the flip with a per-character stagger.
function RollText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`roll-text roll-loop ${className ?? ""}`} aria-label={text}>
      {Array.from(text).map((ch, i) => (
        <span
          aria-hidden="true"
          className="roll-char"
          key={`${ch}-${i}`}
          style={{ "--roll-index": i } as CSSProperties}
        >
          <span>{ch === " " ? " " : ch}</span>
          <span>{ch === " " ? " " : ch}</span>
        </span>
      ))}
    </span>
  );
}
