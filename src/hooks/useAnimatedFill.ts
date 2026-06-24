import { useEffect } from "react";

// Drives the `.animated-fill` hover effect (ported from the invitation admin
// panel). One document-level listener positions the fill disc at the cursor and
// scales it just big enough to cover the element from that point.
export function useAnimatedFill() {
  useEffect(() => {
    const update = (target: HTMLElement, event?: PointerEvent | FocusEvent) => {
      const rect = target.getBoundingClientRect();
      const cx =
        event && "clientX" in event && typeof event.clientX === "number"
          ? event.clientX
          : rect.left + rect.width / 2;
      const cy =
        event && "clientY" in event && typeof event.clientY === "number"
          ? event.clientY
          : rect.top + rect.height / 2;
      const x = cx - rect.left;
      const y = cy - rect.top;

      const maxDist = Math.max(
        Math.hypot(x, y),
        Math.hypot(rect.width - x, y),
        Math.hypot(x, rect.height - y),
        Math.hypot(rect.width - x, rect.height - y),
      );
      const scale = Math.max((maxDist / 18) * 1.1, 1);

      target.style.setProperty("--fill-x", `${x}px`);
      target.style.setProperty("--fill-y", `${y}px`);
      target.style.setProperty("--fill-scale", `${scale}`);
    };

    const onPointer = (e: PointerEvent) => {
      const t = (e.target as HTMLElement | null)?.closest?.(
        ".animated-fill",
      ) as HTMLElement | null;
      if (t) update(t, e);
    };
    const onFocus = (e: FocusEvent) => {
      const t = (e.target as HTMLElement | null)?.closest?.(
        ".animated-fill",
      ) as HTMLElement | null;
      if (t) update(t, e);
    };

    document.addEventListener("pointerover", onPointer, true);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("focusin", onFocus, true);
    return () => {
      document.removeEventListener("pointerover", onPointer, true);
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("focusin", onFocus, true);
    };
  }, []);
}
