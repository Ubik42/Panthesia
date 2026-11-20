import { useLayoutEffect, useRef, useState } from "react";
/** Stage measurements never open a library/inspector or mutate saved layouts. */
export function usePerformanceSize() {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ compact: false, short: false });
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const update = () => {
      if (!node.clientWidth) return;
      const compact = node.clientWidth <= 1100,
        short = node.clientHeight < 560;
      setSize((previous) =>
        previous.compact === compact && previous.short === short
          ? previous
          : { compact, short },
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    update();
    return () => observer.disconnect();
  }, []);
  return { root, ...size };
}
