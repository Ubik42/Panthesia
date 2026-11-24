import { useEffect } from "react";

/** The interface scale (settings → display) zooms the whole document; `--ui-scale` lets
 * full-height layouts divide by it. */
export function useUiScale(percent: number) {
  useEffect(() => {
    const root = document.documentElement;
    root.style.zoom = String(percent / 100);
    root.style.setProperty("--ui-scale", String(percent / 100));
    return () => {
      root.style.zoom = "";
      root.style.removeProperty("--ui-scale");
    };
  }, [percent]);
}
