import type { BusMessage } from "../types";

// Same-machine, no-network channel between the Control panel window (laptop)
// and the Display window (TV). Works fully offline.
const CHANNEL = "wedding-dashboard";

export function createBus() {
  const bc = new BroadcastChannel(CHANNEL);
  return {
    send(msg: BusMessage) {
      bc.postMessage(msg);
    },
    on(handler: (msg: BusMessage) => void) {
      const listener = (e: MessageEvent<BusMessage>) => handler(e.data);
      bc.addEventListener("message", listener);
      return () => bc.removeEventListener("message", listener);
    },
    close() {
      bc.close();
    },
  };
}
