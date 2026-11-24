import { useEffect } from "react";

/** How much larger the interface is drawn in a larger window: 1 at 1180 x 740 CSS pixels,
 * growing with the smaller of the width and height ratios but damped (60 %) so a large monitor
 * gets readable text, not a magnified layout; at most 1.6. */
export function windowFit(width: number, height: number) {
  const ratio = Math.min(width / 1180, height / 740);
  return Math.max(1, Math.min(1.6, 1 + 0.6 * (ratio - 1)));
}

/** The interface scale (settings → display) times the window fit zooms the whole document;
 * `--ui-scale` lets full-height layouts divide by it. Follows window resizes. */
export function useUiScale(percent: number) {
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const scale = (percent / 100) * windowFit(window.innerWidth, window.innerHeight);
      root.style.zoom = String(scale);
      root.style.setProperty("--ui-scale", String(scale));
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      root.style.zoom = "";
      root.style.removeProperty("--ui-scale");
    };
  }, [percent]);
}
