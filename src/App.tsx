import { useCallback, useEffect, useState } from "react";
import { Display } from "./views/Display";
import { Control } from "./views/Control";
import { fetchData } from "./lib/api";
import type { AppData } from "./types";

// Tiny zero-dependency router. Open the TV on "/" and the operator laptop
// window on "/control" (or "#control").
function isControl(): boolean {
  return (
    window.location.pathname.replace(/\/+$/, "").endsWith("/control") ||
    window.location.hash.includes("control")
  );
}

export function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const control = isControl();

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

  return control ? (
    <Control data={data} reload={reload} />
  ) : (
    <Display data={data} reload={reload} />
  );
}
