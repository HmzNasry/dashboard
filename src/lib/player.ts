// Sequential audio file playback. Returns a promise that resolves when the
// whole queue finishes, and a cancel() to stop early.
export function playQueue(urls: string[]): {
  done: Promise<void>;
  cancel: () => void;
} {
  let cancelled = false;
  let currentEl: HTMLAudioElement | null = null;

  const done = (async () => {
    for (const url of urls) {
      if (cancelled || !url) continue;
      await new Promise<void>((resolve) => {
        const el = new Audio(url);
        currentEl = el;
        el.onended = () => resolve();
        el.onerror = () => resolve(); // skip a missing file rather than hang
        el.play().catch(() => resolve());
      });
    }
  })();

  return {
    done,
    cancel: () => {
      cancelled = true;
      if (currentEl) {
        currentEl.pause();
        currentEl.currentTime = 0;
      }
    },
  };
}
