import { useEffect, useState } from "react";
import type { ScorePages } from "./scoreRenderCache";
/** An old page response cannot replace the currently selected page or source. */
export function useScorePage(pages: ScorePages, index: number) {
  const [state, setState] = useState({
    pages,
    index,
    markup: "",
    error: "",
    loading: !!pages.length,
  });
  useEffect(() => {
    const controller = new AbortController();
    setState({ pages, index, markup: "", error: "", loading: !!pages.length });
    if (pages.length)
      void pages
        .get(index, controller.signal)
        .then((markup) => {
          if (!controller.signal.aborted)
            setState({ pages, index, markup, error: "", loading: false });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setState({
              pages,
              index,
              markup: "",
              error: error instanceof Error ? error.message : String(error),
              loading: false,
            });
        });
    return () => controller.abort();
  }, [pages, index]);
  return state.pages === pages && state.index === index
    ? state
    : { markup: "", error: "", loading: !!pages.length };
}
