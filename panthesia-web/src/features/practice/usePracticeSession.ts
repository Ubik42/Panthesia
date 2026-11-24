import { createSessionHealthStore } from "./sessionHealthStore";
import {
  EngineIdentity,
  matchesSong,
  olderState,
  sameEngine,
  verifySession,
} from "../../engine/stateOrder";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
import {
  api,
  emptyState,
  type EngineSession,
  type LoadedSong,
  type Snapshot,
} from "../../api";
import { shareWireValue } from "../../engine/wireValues";
import { createPlaybackStore } from "./playbackStore";
import { listen } from "@tauri-apps/api/event";

class SupersededSessionRead extends Error {}

/** The engine session as the window sees it: the published state (pushed by the engine), the
 * loaded song (read again when its revision changes) and the connection health. */
export function usePracticeSession() {
  const [playback] = useState(() => createPlaybackStore(emptyState));
  const state = useSyncExternalStore(
    playback.subscribe,
    playback.getControls,
    playback.getControls,
  );
  const [song, commitSong] = useState<LoadedSong | null>(null);
  const [connected, setConnected] = useState(false);
  const [binding, setBinding] = useState(true);
  const identity = useRef(new EngineIdentity());
  const [health] = useState(createSessionHealthStore);
  const messages = useSyncExternalStore(
    health.subscribe,
    health.getMessages,
    health.getMessages,
  );
  const setActionError = useCallback(
    (detail: string) => health.report("action", detail),
    [health],
  );
  const setReadError = useCallback(
    (detail: string) => health.report("session", detail),
    [health],
  );
  const setError = useCallback(
    (message: string) => {
      setActionError(message);
    },
    [setActionError],
  );
  const alive = useRef(true);
  const songRef = useRef(song);
  const generation = useRef(0);
  const snapshotEpoch = useRef(0);
  const sessionReads = useRef(new Set<number>());
  // A pushed state may show a new source before its document arrives. Keep that capture
  // for ordering without combining the new state with the old displayed score.
  const latestSeen = useRef<Snapshot>(emptyState);
  const [reading, setReading] = useState(false);
  const liveRevision = useRef(0);
  const startupReady = useRef(false);
  const needsRefresh = useRef(true);
  const nextRefreshAt = useRef(0);
  const invalidateSessionReads = useCallback(() => {
    generation.current++;
    snapshotEpoch.current++;
    sessionReads.current.clear();
    setReading(false);
    nextRefreshAt.current = 0;
  }, []);

  const setState = useCallback(
    (next: SetStateAction<Snapshot>) => {
      const value =
        typeof next === "function" ? next(playback.getSnapshot()) : next;
      if (identity.current.isRetired(value)) return;
      if (
        olderState(value, playback.getSnapshot()) ||
        olderState(value, latestSeen.current)
      )
        return;
      if (
        !identity.current.accepts(value) &&
        playback.getEngineId() &&
        !sameEngine(value, latestSeen.current)
      )
        invalidateSessionReads();
      latestSeen.current = value;
      if (
        !identity.current.accepts(value) ||
        !matchesSong(value, songRef.current)
      ) {
        needsRefresh.current = true;
        setBinding(true);
        return;
      }
      snapshotEpoch.current++;
      playback.update(value);
    },
    [playback, invalidateSessionReads],
  );
  const setSong = useCallback((next: SetStateAction<LoadedSong | null>) => {
    snapshotEpoch.current++;
    const previous = songRef.current;
    const candidate = typeof next === "function" ? next(previous) : next;
    const value =
      previous?.contentId === candidate?.contentId
        ? shareWireValue(previous, candidate)
        : candidate;
    songRef.current = value;
    commitSong(value);
  }, []);
  const installSession = useCallback(
    (session: EngineSession, legacyLiveAtStart?: number): Snapshot => {
      verifySession(session);
      // Capture order resolves concurrent reads from the bound engine. Request
      // order is only needed when introducing a new engine or serving a legacy one.
      if (
        !api.currentSessionRead(session) &&
        (!session.state.stateOrder || !identity.current.accepts(session.state))
      )
        throw new Error("已有更新的曲目读取请求，请等待或重新读取");
      const current = playback.getSnapshot(),
        candidate = session.state;
      const observed = latestSeen.current;
      if (
        candidate.stateOrder &&
        observed.stateOrder &&
        !sameEngine(candidate, observed) &&
        (!current.stateOrder || !sameEngine(current, observed))
      )
        throw new Error("连接已再次改变，正在读取最新练习室");
      const freshest =
        sameEngine(observed, candidate) &&
        (!sameEngine(current, candidate) || olderState(current, observed))
          ? observed
          : current;
      const sameSource = matchesSong(freshest, session.song);
      if (olderState(candidate, freshest) && !sameSource) {
        needsRefresh.current = true;
        setBinding(true);
        throw new Error("当前曲目已有更新，已保留较新的练习内容，请重新读取");
      }
      if (!identity.current.bind(candidate))
        throw new Error("这次读取来自已关闭的练习室，请重新读取当前状态");
      const useCurrent =
        sameEngine(candidate, freshest) &&
        sameSource &&
        (olderState(candidate, freshest) ||
          (!candidate.stateOrder &&
            !current.stateOrder &&
            legacyLiveAtStart !== undefined &&
            liveRevision.current > legacyLiveAtStart));
      const installed = useCurrent ? freshest : candidate;
      latestSeen.current = installed;
      setSong(session.song);
      snapshotEpoch.current++;
      playback.update(installed);
      setConnected(true);
      health.connectionSucceeded();
      setBinding(false);
      setReadError("");
      needsRefresh.current = false;
      nextRefreshAt.current = 0;
      startupReady.current = installed.startup?.ready ?? true;
      return installed;
    },
    [playback, setSong],
  );
  const readSession = useCallback(
    async (installed?: (snapshot: Snapshot) => void) => {
      const request = ++generation.current;
      const epoch = ++snapshotEpoch.current;
      const liveAtStart = liveRevision.current;
      sessionReads.current.add(request);
      setReading(true);
      try {
        const session = await api.session();
        if (
          !alive.current ||
          request !== generation.current ||
          epoch !== snapshotEpoch.current ||
          (!api.currentSessionRead(session) &&
            (!session.state.stateOrder ||
              !identity.current.accepts(session.state)))
        )
          return;
        const snapshot = installSession(session, liveAtStart);
        installed?.(snapshot);
      } catch (failure) {
        if (
          !alive.current ||
          request !== generation.current ||
          epoch !== snapshotEpoch.current
        )
          return;
        needsRefresh.current = true;
        throw failure;
      } finally {
        sessionReads.current.delete(request);
        if (alive.current) setReading(sessionReads.current.size > 0);
      }
    },
    [installSession],
  );
  const refreshSession = useCallback(() => readSession(), [readSession]);
  const refreshConfirmedSession = useCallback(async (): Promise<Snapshot> => {
    let installed: Snapshot | undefined;
    await readSession((snapshot) => {
      installed = snapshot;
    });
    if (!installed)
      throw new SupersededSessionRead(
        "这次读取已由更新的会话请求替代，请查看最新状态",
      );
    return installed;
  }, [readSession]);
  // A successful open changes the engine before the potentially large song read.
  // Keep that handoff active when reading fails, so recovery only reads again.
  const refreshOpenedSession = useCallback(async (): Promise<Snapshot> => {
    needsRefresh.current = true;
    setBinding(true);
    try {
      return await refreshConfirmedSession();
    } catch (failure) {
      if (alive.current && needsRefresh.current)
        setReadError(
          `练习已准备，当前界面尚未读取完成：${failure instanceof Error ? failure.message : String(failure)}。可重新读取当前练习继续。`,
        );
      throw failure;
    }
  }, [refreshConfirmedSession, setReadError]);
  const refresh = useCallback(async () => {
    try {
      await readSession();
    } catch (failure) {
      if (alive.current)
        setReadError(
          failure instanceof Error ? failure.message : String(failure),
        );
    }
  }, [readSession, setReadError]);
  const refreshProblem = useCallback(async (): Promise<
    "refreshed" | "superseded"
  > => {
    try {
      await refreshConfirmedSession();
      if (!alive.current) return "superseded";
      const remaining = health.getMessages().session;
      if (remaining) throw new Error(remaining);
      return "refreshed";
    } catch (failure) {
      if (failure instanceof SupersededSessionRead) return "superseded";
      if (alive.current)
        health.report(
          "session",
          failure instanceof Error ? failure.message : String(failure),
        );
      throw failure;
    }
  }, [refreshConfirmedSession, health]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
      generation.current++;
      snapshotEpoch.current++;
      sessionReads.current.clear();
    };
  }, [refresh]);
  // Published states arrive in order from the engine. A state of another song or a new
  // engine marks the loaded song stale; it is read again at most once a second.
  useEffect(() => {
    const accept = (next: Snapshot) => {
      setConnected(true);
      health.connectionSucceeded();
      const knownEngine = identity.current.accepts(next);
      if (
        identity.current.isRetired(next) ||
        olderState(next, playback.getSnapshot()) ||
        olderState(next, latestSeen.current)
      )
        return;
      if (
        !knownEngine &&
        playback.getEngineId() &&
        !sameEngine(next, latestSeen.current)
      )
        invalidateSessionReads();
      latestSeen.current = next;
      const sameSong = knownEngine && matchesSong(next, songRef.current);
      const becameReady =
        !startupReady.current && (next.startup?.ready ?? true);
      if (sameSong) {
        liveRevision.current++;
        playback.update(next);
        startupReady.current = next.startup?.ready ?? true;
      } else {
        setBinding(true);
        needsRefresh.current = true;
      }
      if (
        (!sameSong || becameReady || needsRefresh.current) &&
        sessionReads.current.size === 0 &&
        Date.now() >= nextRefreshAt.current
      ) {
        nextRefreshAt.current = Date.now() + 1000;
        void refresh();
      }
    };
    const fail = (failure: unknown) => {
      health.connectionFailed(failure);
      invalidateSessionReads();
      needsRefresh.current = true;
      setConnected(false);
      setBinding(true);
    };
    return api.subscribeState(accept, fail);
  }, [refresh, playback, invalidateSessionReads, health]);

  const getBoundSong = useCallback(
    () =>
      !needsRefresh.current &&
      matchesSong(playback.getSnapshot(), songRef.current)
        ? songRef.current
        : null,
    [playback],
  );
  return {
    getBoundSong,
    playback,
    state,
    setState,
    song,
    refreshSession,
    refreshConfirmedSession,
    refreshOpenedSession,
    installSession,
    binding,
    reading,
    connected,
    error: messages.action || messages.session,
    health,
    refreshProblem,
    setError,
    refresh,
  };
}
