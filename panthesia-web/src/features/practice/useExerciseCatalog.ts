import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { ExerciseSpec } from "../../engine/commands.generated";
import type { ExerciseCatalog, SavedExercisePreset } from "./catalogTypes";

type Edit =
  | { type: "editExercisePreset"; name: string; spec: ExerciseSpec }
  | { type: "deleteExercisePreset"; id: string };

export function useExerciseCatalog() {
  const [presets, setPresets] = useState<SavedExercisePreset[]>([]);
  const [revision, setRevision] = useState<string>();
  const [reading, setReading] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [pendingRefresh, setPendingRefresh] = useState<string | null>(null);
  const pending = useRef<string | null>(null),
    working = useRef(false);
  const alive = useRef(true),
    sequence = useRef(0);
  const sourceEngine = useRef<{ engineId?: string } | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      sequence.current++;
    };
  }, []);
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    setReading(true);
    try {
      const before = await api.state();
      const value = await api.commandForEngine<ExerciseCatalog>(before.stateOrder?.engineId, {
        type: "exercisePresets",
      });
      const after = await api.state();
      if (after.stateOrder?.engineId !== before.stateOrder?.engineId)
        throw new Error("练习室连接已改变，请重新读取技术练习方案。");
      if (!alive.current || request !== sequence.current) return false;
      sourceEngine.current = { engineId: before.stateOrder?.engineId };
      setPresets(value.presets);
      setRevision(value.catalogRevision);
      return true;
    } catch (failure) {
      if (!alive.current || request !== sequence.current) return false;
      throw failure;
    } finally {
      if (alive.current && request === sequence.current) setReading(false);
    }
  }, []);
  const refresh = useCallback(async () => {
    setError("");
    try {
      const installed = await reload();
      if (installed && alive.current) {
        pending.current = null;
        setPendingRefresh(null);
      }
    } catch (failure) {
      if (alive.current)
        setError(
          `${pending.current ? `${pending.current}，列表刷新失败：` : "方案列表读取失败："}${failure instanceof Error ? failure.message : String(failure)}`,
        );
    }
  }, [reload]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const edit = async (command: Edit) => {
    if (working.current || pending.current || !revision) return;
    working.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.commandForEngine(sourceEngine.current?.engineId, { ...command, expected: revision });
      const message =
        command.type === "editExercisePreset"
          ? "技术练习方案已保存"
          : "技术练习方案已移除";
      pending.current = message;
      if (alive.current) {
        setPendingRefresh(message);
        setNotice(message);
      }
      await refresh();
    } catch (failure) {
      if (alive.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return {
    presets,
    reading,
    busy,
    error,
    notice,
    pendingRefresh,
    writable: !!revision && !busy && !reading && !pendingRefresh,
    refresh,
    save: (name: string, spec: ExerciseSpec) =>
      edit({ type: "editExercisePreset", name, spec }),
    remove: (id: string) => edit({ type: "deleteExercisePreset", id }),
  };
}
