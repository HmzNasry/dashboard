import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Display } from "./views/Display";
import { Control } from "./views/Control";
import { SchedulePage } from "./views/SchedulePage";
import { fetchData } from "./lib/api";
import type { AppData } from "./types";

// Tiny zero-dependency router. TV on "/", operator laptop on "/control"
// (or "#control"), and the guest-facing mobile schedule on "/schedule".
type Route = "control" | "schedule" | "display";
function currentRoute(): Route {
  const path = window.location.pathname.replace(/\/+$/, "");
  const hash = window.location.hash;
  if (path.endsWith("/control") || hash.includes("control")) return "control";
  if (path.endsWith("/schedule") || hash.includes("schedule")) return "schedule";
  return "display";
}

// Simple shared-password gate for the control panel. Client-side only (the
// server still requires admin approval to actually drive the TV) — this just
// keeps casual guests out of the operator UI. Asked once per browser tab.
const CONTROL_PASSWORD = "Vancouver@2026";
function ControlGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(
    () => sessionStorage.getItem("wd-control-ok") === "1",
  );

  const ask = useCallback(() => {
    // Loop until correct or cancelled.
    for (;;) {
      const entry = window.prompt("Enter the control password:");
      if (entry === null) return false; // cancelled
      if (entry === CONTROL_PASSWORD) {
        sessionStorage.setItem("wd-control-ok", "1");
        setAuthed(true);
        return true;
      }
      window.alert("Incorrect password.");
    }
  }, []);

  useEffect(() => {
    if (!authed) ask();
  }, [authed, ask]);

  if (authed) return <>{children}</>;
  return (
    <div className="safe flex h-full flex-col items-center justify-center bg-[#0a0a0a] px-8 text-center text-neutral-100">
      <h1 className="text-2xl font-semibold tracking-tight">Locked</h1>
      <p className="mt-2 max-w-sm text-neutral-400">
        The control panel is password protected.
      </p>
      <button
        onClick={ask}
        className="mt-6 rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
      >
        Unlock
      </button>
    </div>
  );
}

export function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const route = currentRoute();
  const control = route === "control";

  const reload = useCallback(
    () =>
      fetchData()
        .then(setData)
        .catch((e) => setError((e as Error).message)),
    [],
  );

  useEffect(() => {
    reload();
    // Re-poll so edits show up without a manual refresh.
    const id = setInterval(reload, 15_000);
    return () => clearInterval(id);
  }, [reload]);

  if (error) {
    return (
      <div
        className={`safe flex h-full items-center justify-center text-center ${
          control ? "bg-[#0a0a0a] text-neutral-100" : "bg-[#f4f2ed] text-neutral-900"
        }`}
      >
        <div>
          <p className="text-2xl font-semibold tracking-tight">
            Couldn’t load content
          </p>
          <p className="mt-2 text-neutral-500">{error}</p>
          <p className="mt-4 text-sm text-neutral-500">
            Is the server running? Try <code>npm run dev</code>.
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div
        className={`safe flex h-full items-center justify-center ${
          control ? "bg-[#0a0a0a]" : "bg-[#f4f2ed]"
        }`}
      >
        <span
          className={`h-8 w-8 animate-spin rounded-full border-2 ${
            control
              ? "border-neutral-700 border-t-neutral-200"
              : "border-neutral-300 border-t-neutral-700"
          }`}
        />
      </div>
    );
  }

  if (route === "control") {
    return (
      <ControlGate>
        <Control data={data} reload={reload} />
      </ControlGate>
    );
  }
  if (route === "schedule") {
    return <SchedulePage data={data} />;
  }
  return <Display data={data} reload={reload} />;
}
