import type { BusMessage, DeviceInfo } from "../types";

// Server-relayed message bus over WebSocket. Replaces BroadcastChannel so the
// control panel can run on a separate device (phone) and still drive the TV:
// control → server → display. Auto-reconnects.

export interface NetState {
  connected: boolean;
  me: DeviceInfo | null;
  devices: DeviceInfo[];
  serverUrls: string[];
}

export interface NetClient {
  send(msg: BusMessage): void;
  onBus(h: (m: BusMessage) => void): () => void;
  onState(h: (s: NetState) => void): () => void;
  admin: {
    approve(id: string): void;
    revoke(id: string): void;
    rename(id: string, name: string): void;
    remove(id: string): void;
  };
  close(): void;
}

function deviceId(): string {
  const KEY = "wd-device-id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id =
      (crypto.randomUUID && crypto.randomUUID()) ||
      `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

export function guessName(): string {
  const ua = navigator.userAgent;
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua)) return "Android phone";
  if (/macintosh|mac os/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows PC";
  return "Device";
}

export function connect({
  role,
  name,
}: {
  role: "display" | "control";
  name?: string;
}): NetClient {
  const id = deviceId();
  const busHandlers = new Set<(m: BusMessage) => void>();
  const stateHandlers = new Set<(s: NetState) => void>();
  let state: NetState = { connected: false, me: null, devices: [], serverUrls: [] };
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;

  const emitState = () => stateHandlers.forEach((h) => h(state));

  function open() {
    if (closed) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.onopen = () => {
      retry = 0;
      ws?.send(JSON.stringify({ kind: "hello", role, name, deviceId: id }));
      state = { ...state, connected: true };
      emitState();
    };

    ws.onmessage = (ev) => {
      let m: { kind?: string; msg?: BusMessage; me?: DeviceInfo; devices?: DeviceInfo[]; serverUrls?: string[] };
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.kind === "bus" && m.msg) {
        busHandlers.forEach((h) => h(m.msg as BusMessage));
      } else if (m.kind === "state") {
        state = {
          connected: true,
          me: m.me ?? null,
          devices: m.devices ?? [],
          serverUrls: m.serverUrls ?? [],
        };
        emitState();
      }
    };

    const reconnect = () => {
      state = { ...state, connected: false };
      emitState();
      if (closed) return;
      retry = Math.min(retry + 1, 6);
      setTimeout(open, 400 * retry); // backoff up to ~2.4s
    };
    ws.onclose = reconnect;
    ws.onerror = () => ws?.close();
  }

  open();

  const adminAction = (action: string, payload: object) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ kind: "admin", action, ...payload }));
    }
  };

  return {
    send(msg) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ kind: "bus", msg }));
      }
    },
    onBus(h) {
      busHandlers.add(h);
      return () => busHandlers.delete(h);
    },
    onState(h) {
      stateHandlers.add(h);
      h(state); // emit current immediately
      return () => stateHandlers.delete(h);
    },
    admin: {
      approve: (deviceTargetId) => adminAction("approve", { id: deviceTargetId }),
      revoke: (deviceTargetId) => adminAction("revoke", { id: deviceTargetId }),
      rename: (deviceTargetId, newName) =>
        adminAction("rename", { id: deviceTargetId, name: newName }),
      remove: (deviceTargetId) => adminAction("remove", { id: deviceTargetId }),
    },
    close() {
      closed = true;
      ws?.close();
    },
  };
}
