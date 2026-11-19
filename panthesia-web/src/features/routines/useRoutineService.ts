import { useEffect, useMemo, useRef } from "react";
import { api, type HistoryReadScope } from "../../api";
import type { EngineCommand } from "../../engine/commands.generated";

/** A plan editor keeps its drafts while requests remain bound to its connection. */
export function useRoutineService(engineId?: string) {
  const scope = useMemo(() => ({ engineId }), [engineId]);
  const current = useRef(scope);
  current.current = scope;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return useMemo(() => {
    const isCurrent = () => alive.current && current.current === scope;
    const assertCurrent = () => {
      if (!isCurrent())
        throw new Error(
          "练习室连接已改变，草稿继续保留。请在当前连接重新读取计划。",
        );
    };
    return {
      isCurrent,
      assertCurrent,
      async command<T = { ok: boolean }>(command: EngineCommand): Promise<T> {
        assertCurrent();
        const result = await api.commandForEngine<T>(scope.engineId, command);
        assertCurrent();
        return result;
      },
      async read(day: string, reader?: HistoryReadScope) {
        assertCurrent();
        const result = await api.routines(day, reader, scope.engineId);
        assertCurrent();
        return result;
      },
      async options(contentId: string) {
        assertCurrent();
        const result = await api.routineOptions(contentId, scope.engineId);
        assertCurrent();
        if (result.contentId !== contentId)
          throw new Error("曲目已切换，请重新读取计划来源。");
        return result;
      },
      async state() {
        assertCurrent();
        const state = await api.state();
        assertCurrent();
        if (scope.engineId && state.stateOrder?.engineId !== scope.engineId)
          throw new Error("练习室已重新连接，请重新读取当前项目。");
        return state;
      },
    };
  }, [scope]);
}
