// The airplane cabin "bong" — the high-low seatbelt chime, synthesized with
// the Web Audio API so there's no copyrighted sound file to ship. It's a soft
// mallet/glockenspiel-like dual tone: a higher note, then a lower note.

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext {
  if (!ctx) {
    ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext)();
  }
  return ctx;
}

// Some browsers suspend audio until a user gesture. Call once on first click.
export async function unlockAudio(): Promise<void> {
  const c = audioCtx();
  if (c.state === "suspended") await c.resume();
}

/** One soft struck note with a gentle harmonic, mallet-style decay. */
function strike(c: AudioContext, freq: number, start: number, dur: number) {
  const master = c.createGain();
  master.connect(c.destination);

  // Bell-ish tone: fundamental + a quiet octave overtone.
  [
    { f: freq, g: 0.5 },
    { f: freq * 2.01, g: 0.12 },
  ].forEach(({ f, g }) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = f;

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(g, start + 0.012); // fast attack
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur); // long decay

    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  });
}

/**
 * Play the classic two-tone cabin chime. Resolves when the sound finishes,
 * so callers can chain speech right after.
 */
export function playChime(): Promise<void> {
  const c = audioCtx();
  const t0 = c.currentTime + 0.05;
  // High note then low note — the recognizable "bing-bong".
  strike(c, 660, t0, 1.1); // E5
  strike(c, 523.25, t0 + 0.42, 1.5); // C5
  return new Promise((resolve) => setTimeout(resolve, 1300));
}
