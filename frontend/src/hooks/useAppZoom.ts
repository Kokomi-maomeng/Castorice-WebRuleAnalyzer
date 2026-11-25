import { useEffect, useLayoutEffect, useState } from "react";

const levels = [50, 67, 80, 90, 100, 110, 125, 150, 175, 200];
export const minZoom = levels[0];
export const maxZoom = levels[levels.length - 1];

export function useAppZoom() {
  const [zoom, setZoom] = useState(100);

  function changeZoom(action: "in" | "out" | "reset") {
    setZoom((current) => {
      if (action === "reset") return 100;
      const next = levels.indexOf(current) + (action === "in" ? 1 : -1);
      return levels[Math.min(levels.length - 1, Math.max(0, next))];
    });
  }

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const action = { "+": "in", "=": "in", "-": "out", 0: "reset" } as const;
      if (!Object.hasOwn(action, event.key)) return;
      event.preventDefault();
      changeZoom(action[event.key as keyof typeof action]);
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--app-zoom", String(zoom / 100));
    return () => {
      root.style.removeProperty("--app-zoom");
    };
  }, [zoom]);

  return { zoom, changeZoom };
}
