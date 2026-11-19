import { useEffect, useRef } from "react";

// Take a guard before awaiting work. A result belongs to the source and editor
// inputs visible at that moment, even when the same song remains open.
export function useRequestScope(key: string) {
  const current = useRef(key);
  const mounted = useRef(true);
  current.current = key;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return () => {
    const captured = current.current;
    return () => mounted.current && current.current === captured;
  };
}
