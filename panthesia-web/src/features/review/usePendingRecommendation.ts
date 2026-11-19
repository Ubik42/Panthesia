import { useEffect, useMemo, useRef, useState } from "react";
import { RetainedSession } from "../../engine/retainedSession";
import type { RecommendationSubmission as Submission } from "./recommendationTypes";
const valid = (raw: unknown, key: string): raw is Submission => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const value = raw as Submission;
  return (
    keyOf(value.routineId, value.day) === key &&
    (value.routineId === null || typeof value.routineId === "string") &&
    (value.day === null || typeof value.day === "string") &&
    typeof value.name === "string" &&
    value.name.length <= 80 &&
    (value.routineId === null
      ? typeof value.requestId === "string" &&
        /^[A-Za-z0-9_-]{1,128}$/.test(value.requestId)
      : value.requestId === null) &&
    Array.isArray(value.ids) &&
    value.ids.length > 0 &&
    value.ids.length <= 60 &&
    value.ids.every((id) => typeof id === "string" && id.length <= 160) &&
    new Set(value.ids).size === value.ids.length &&
    Array.isArray(value.edits) &&
    value.edits.length === value.ids.length &&
    value.edits.every(
      (edit, index) =>
        edit &&
        edit.id === value.ids[index] &&
        Number.isFinite(edit.speed) &&
        edit.speed >= 0.25 &&
        edit.speed <= 2 &&
        Number.isInteger(edit.passes) &&
        edit.passes >= 1 &&
        edit.passes <= 100 &&
        Number.isInteger(edit.accuracy) &&
        edit.accuracy >= 50 &&
        edit.accuracy <= 100 &&
        (edit.onTime == null ||
          (Number.isInteger(edit.onTime) &&
            edit.onTime >= 50 &&
            edit.onTime <= 100)),
    )
  );
};
const store = new RetainedSession<Submission>(valid);
const keyOf = (routineId: string | null, day: string | null) =>
  `panthesia-pending-review:${JSON.stringify([routineId, day])}`;
export function usePendingRecommendation(
  routineId: string | null,
  day: string | null,
) {
  const key = keyOf(routineId, day);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const active = useRef(key);
  active.current = key;
  const initial = useMemo(() => store.read(key), [key]);
  const [state, setState] = useState(initial);
  const snapshot = state.key === key ? state : initial;
  useEffect(() => {
    setState(initial);
  }, [initial]);
  const update = (scope: string, value: Submission | null, replace = false) => {
    const next = store.write(scope, value, replace);
    if (mounted.current && active.current === scope) setState(next);
    return next;
  };
  return {
    pending: snapshot.value,
    unread: snapshot.unread,
    error: snapshot.error,
    original: snapshot.original,
    remember: (value: Submission) =>
      update(keyOf(value.routineId, value.day), value),
    clear: (value: Submission) =>
      update(keyOf(value.routineId, value.day), null),
    retry: () => {
      const next = store.retry(key);
      if (mounted.current && active.current === key) setState(next);
    },
    clearOriginal: () => update(key, snapshot.value, true),
  };
}
