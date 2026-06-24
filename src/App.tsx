import { useEffect, useState } from "react";
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

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchData()
        .then((d) => alive && setData(d))
        .catch((e) => alive && setError((e as Error).message));
    load();
    // Re-poll so edits to the JSON show up without a manual refresh.
    const id = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (error) {
    return (
      <div className="safe flex h-full items-center justify-center bg-[#0a0a0a] text-center text-neutral-100">
        <div>
          <p className="text-2xl font-semibold tracking-tight">
            Couldn’t load content
          </p>
          <p className="mt-2 text-neutral-400">{error}</p>
          <p className="mt-4 text-sm text-neutral-500">
            Is the server running? Try <code>npm run dev</code>.
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="safe flex h-full items-center justify-center bg-[#0a0a0a]">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-200" />
      </div>
    );
  }

  return control ? <Control data={data} /> : <Display data={data} />;
}
