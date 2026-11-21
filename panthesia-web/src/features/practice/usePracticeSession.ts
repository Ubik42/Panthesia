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
  type CollectionSong,
  type EngineSession,
  type LoadedSong,
  type Snapshot,
  type SongRow,
} from "../../api";
import { shareWireValue } from "../../engine/wireValues";
import { createPlaybackStore } from "./playbackStore";
import { listen } from "@tauri-apps/api/event";

class SupersededSessionRead extends Error {}

export interface CollectionRead {
  songs: CollectionSong[];
  revision: number;
  engineId?: string;
}

export function usePracticeSession() {
  const [playback] = useState(() => createPlaybackStore(emptyState));
  const state = useSyncExternalStore(
    playback.subscribe,
    playback.getControls,
    playback.getControls,
  );
  const [song, commitSong] = useState<LoadedSong | null>(null);
  const [songs, setSongs] = useState<SongRow[]>([]);
  const [collection, setCollection] = useState<CollectionSong[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState({
    library: false,
    collection: false,
  });
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
  const setLibraryError = useCallback(
    (detail: string) => health.report("library", detail),
    [health],
  );
  const setCollectionError = useCallback(
    (detail: string) => health.report("collection", detail),
    [health],
  );
  const setError = useCallback(
    (message: string) => {
      setActionError(message);
    },
    [setActionError],
  );
  const wakeConnection = useRef<() => void>(() => {});
  const alive = useRef(true);
  const songRef = useRef(song);
  const generation = useRef(0);
  const relatedGeneration = useRef(0);
  const relatedWorking = useRef(0);
  const relatedDirty = useRef(true);
  const libraryGeneration = useRef(0);
  const collectionGeneration = useRef(0);
  const snapshotEpoch = useRef(0);
  const sessionReads = useRef(new Set<number>());
  // A poll may see a new source before its document arrives. Keep that capture
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
      if (!sameEngine(current, installed)) {
        setLibraryLoaded({ library: false, collection: false });
        relatedGeneration.current++;
        libraryGeneration.current++;
        collectionGeneration.current++;
        relatedWorking.current = 0;
        relatedDirty.current = true;
      }
      setSong(session.song);
      snapshotEpoch.current++;
      playback.update(installed);
      setConnected(true);
      health.connectionSucceeded();
      wakeConnection.current();
      setBinding(false);
      setReadError("");
      needsRefresh.current = false;
      nextRefreshAt.current = 0;
      startupReady.current = installed.startup?.ready ?? true;
      return installed;
    },
    [playback, setSong],
  );
  const refreshLibrary = useCallback(async () => {
    const request = ++libraryGeneration.current;
    try {
      const data = await api.library();
      if (!alive.current || request !== libraryGeneration.current)
        throw new SupersededSessionRead(
          "曲库已有更新的读取请求，请等待最新结果。",
        );
      setSongs(data.songs);
      setLibraryLoaded((loaded) =>
        loaded.library ? loaded : { ...loaded, library: true },
      );
      setLibraryError("");
    } catch (failure) {
      if (!alive.current || request !== libraryGeneration.current)
        throw new SupersededSessionRead(
          "曲库已有更新的读取请求，请等待最新结果。",
        );
      setLibraryError(
        `曲库读取未完成：${failure instanceof Error ? failure.message : String(failure)}`,
      );
      throw failure;
    }
  }, [setLibraryError]);
  const readCollection = useCallback(async (): Promise<CollectionRead> => {
    const request = ++collectionGeneration.current,
      engineId = playback.getEngineId();
    try {
      // Practice history per song is not listed any more; the start page shows recent files.
      void engineId;
      const data: { songs: CollectionSong[] } = { songs: [] };
      if (
        !alive.current ||
        request !== collectionGeneration.current ||
        engineId !== playback.getEngineId()
      )
        throw new SupersededSessionRead(
          "收藏与队列已有更新的读取请求，请等待最新结果。",
        );
      setCollection(data.songs);
      setLibraryLoaded((loaded) =>
        loaded.collection ? loaded : { ...loaded, collection: true },
      );
      setCollectionError("");
      return { songs: data.songs, revision: request, engineId };
    } catch (failure) {
      if (
        !alive.current ||
        request !== collectionGeneration.current ||
        engineId !== playback.getEngineId()
      )
        throw new SupersededSessionRead(
          "收藏与队列已有更新的读取请求，请等待最新结果。",
        );
      setCollectionError(
        `收藏与队列读取未完成：${failure instanceof Error ? failure.message : String(failure)}`,
      );
      throw failure;
    }
  }, [playback, setCollectionError]);
  const updateCollection = useCallback(async () => {
    await readCollection();
  }, [readCollection]);
  const readRelated = useCallback(
    async (knownCollection?: CollectionRead) => {
      const request = ++relatedGeneration.current;
      relatedWorking.current = request;
      relatedDirty.current = false;
      const engineId = playback.getEngineId();
      const known =
        knownCollection?.engineId === engineId &&
        knownCollection?.revision === collectionGeneration.current
          ? knownCollection
          : undefined;
      const libraryRequest = ++libraryGeneration.current;
      const collectionRequest =
        known?.revision ?? ++collectionGeneration.current;
      try {
        const [library, savedCollection] = await Promise.allSettled([
          Promise.resolve({ songs: [] as SongRow[] }),
          Promise.resolve({ songs: known?.songs ?? ([] as CollectionSong[]) }),
        ]);
        if (!alive.current || request !== relatedGeneration.current) return;
        if (libraryRequest === libraryGeneration.current) {
          if (library.status === "fulfilled") {
            setSongs(library.value.songs);
            setLibraryLoaded((loaded) =>
              loaded.library ? loaded : { ...loaded, library: true },
            );
            setLibraryError("");
          } else setLibraryError(`曲库读取失败：${String(library.reason)}`);
        }
        if (collectionRequest === collectionGeneration.current) {
          if (savedCollection.status === "fulfilled") {
            setCollection(savedCollection.value.songs);
            setLibraryLoaded((loaded) =>
              loaded.collection ? loaded : { ...loaded, collection: true },
            );
            setCollectionError("");
          } else
            setCollectionError(
              `收藏信息读取失败：${String(savedCollection.reason)}`,
            );
        }
        return (
          libraryRequest === libraryGeneration.current &&
          collectionRequest === collectionGeneration.current &&
          library.status === "fulfilled" &&
          savedCollection.status === "fulfilled"
        );
      } finally {
        if (relatedWorking.current === request) relatedWorking.current = 0;
      }
    },
    [playback],
  );
  const readSession = useCallback(
    async (
      includeRelated: boolean,
      installed?: (snapshot: Snapshot) => void,
      knownCollection?: CollectionRead,
    ) => {
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
        const installedState = installSession(session, liveAtStart);
        installed?.(installedState);
        if (!startupReady.current) return;
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
      if (!includeRelated) return;
      await readRelated(knownCollection);
    },
    [installSession, readRelated],
  );
  const refreshSession = useCallback(() => readSession(false), [readSession]);
  const refreshConfirmedSession = useCallback(async (): Promise<Snapshot> => {
    let installed: Snapshot | undefined;
    await readSession(false, (snapshot) => {
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
  const refreshWithCollection = useCallback(
    (known?: CollectionRead) => readSession(true, undefined, known),
    [readSession],
  );
  const refreshEdits = useCallback(
    async (known?: CollectionRead) => {
      await refreshConfirmedSession();
      if (!(await readRelated(known)))
        throw new Error(
          "已保存结果继续保留，曲目或收藏资料尚未完整刷新，请重试读取。",
        );
    },
    [refreshConfirmedSession, readRelated],
  );
  const refreshOrThrow = useCallback(() => readSession(true), [readSession]);
  const refresh = useCallback(async () => {
    try {
      await refreshOrThrow();
    } catch (failure) {
      if (alive.current) {
        setReadError(
          failure instanceof Error ? failure.message : String(failure),
        );
      }
    }
  }, [refreshOrThrow]);

  const refreshProblem = useCallback(
    async (
      kind: "session" | "library" | "collection",
    ): Promise<"refreshed" | "superseded"> => {
      try {
        if (kind === "session") await refreshConfirmedSession();
        else if (kind === "library") await refreshLibrary();
        else await updateCollection();
        if (!alive.current) return "superseded";
        const remaining = health.getMessages()[kind];
        if (remaining) throw new Error(remaining);
        return "refreshed";
      } catch (failure) {
        if (failure instanceof SupersededSessionRead) return "superseded";
        if (alive.current)
          health.report(
            kind,
            failure instanceof Error ? failure.message : String(failure),
          );
        throw failure;
      }
    },
    [refreshConfirmedSession, refreshLibrary, updateCollection, health],
  );

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
      generation.current++;
      relatedGeneration.current++;
      libraryGeneration.current++;
      collectionGeneration.current++;
      snapshotEpoch.current++;
      sessionReads.current.clear();
    };
  }, [refresh]);
  useEffect(() => {
    if (!api.desktop) return;
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    void listen<string>("neothesia-close-blocked", (event) => {
      if (!stopped) setError(event.payload);
    })
      .then((release) => {
        if (stopped) release();
        else unsubscribe = release;
      })
      .catch(() => {});
    return () => {
      stopped = true;
      unsubscribe?.();
    };
  }, []);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let transportWorking = false,
      failures = 0;
    const poll = async () => {
      clearTimeout(timer);
      if (stopped || transportWorking) return;
      transportWorking = true;
      const epoch = snapshotEpoch.current;
      try {
        const next = await api.pollState(playback.getSnapshot());
        if (!stopped && epoch === snapshotEpoch.current) {
          failures = 0;
          setConnected(true);
          health.connectionSucceeded();
          const knownEngine = identity.current.accepts(next);
          if (
            identity.current.isRetired(next) ||
            olderState(next, playback.getSnapshot()) ||
            olderState(next, latestSeen.current)
          ) {
            return;
          }
          if (
            !knownEngine &&
            playback.getEngineId() &&
            !sameEngine(next, latestSeen.current)
          ) {
            invalidateSessionReads();
          }
          latestSeen.current = next;
          const sameSong = knownEngine && matchesSong(next, songRef.current);
          const annotationOnly =
            knownEngine &&
            !needsRefresh.current &&
            next.contentId === (songRef.current?.contentId ?? null) &&
            next.scoreRevision === songRef.current?.scoreRevision &&
            startupReady.current;
          const becameReady =
            !startupReady.current && (next.startup?.ready ?? true);
          if (sameSong) {
            liveRevision.current++;
            playback.update(next);
            startupReady.current = next.startup?.ready ?? true;
          }
          if (!sameSong) {
            setBinding(true);
            needsRefresh.current = true;
          }
          if (
            sameSong &&
            !becameReady &&
            !needsRefresh.current &&
            startupReady.current &&
            relatedDirty.current &&
            !relatedWorking.current
          )
            void readRelated();
          if (
            (!sameSong || becameReady || needsRefresh.current) &&
            sessionReads.current.size === 0 &&
            Date.now() >= nextRefreshAt.current
          ) {
            nextRefreshAt.current = Date.now() + 1000;
            // Keep the lightweight transport poll running while a large song is transferred.
            if (annotationOnly)
              void readSession(false).catch((failure) => {
                if (!stopped)
                  setReadError(
                    failure instanceof Error
                      ? failure.message
                      : String(failure),
                  );
              });
            else void refresh();
          }
        }
      } catch (failure) {
        if (!stopped && epoch === snapshotEpoch.current) {
          failures = Math.min(6, failures + 1);
          health.connectionFailed(failure);
          invalidateSessionReads();
          needsRefresh.current = true;
          setConnected(false);
          setBinding(true);
        }
      } finally {
        transportWorking = false;
        if (!stopped)
          timer = setTimeout(
            poll,
            failures ? Math.min(5000, 250 * 2 ** (failures - 1)) : 80,
          );
      }
    };
    const wake = () => {
      failures = 0;
      if (!stopped && !transportWorking) {
        clearTimeout(timer);
        timer = setTimeout(poll, 80);
      }
    };
    wakeConnection.current = wake;
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (wakeConnection.current === wake) wakeConnection.current = () => {};
    };
  }, [refresh, readSession, readRelated, playback, invalidateSessionReads]);

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
    songs,
    collection,
    libraryReady: !binding && libraryLoaded.library && libraryLoaded.collection,
    libraryProblem: messages.library || messages.collection,
    refreshSession,
    refreshConfirmedSession,
    refreshOpenedSession,
    installSession,
    binding,
    reading,
    connected,
    error:
      messages.action ||
      messages.session ||
      messages.library ||
      messages.collection,
    health,
    refreshProblem,
    setError,
    refresh,
    refreshOrThrow,
    updateCollection,
    refreshLibrary,
    readCollection,
    refreshWithCollection,
    refreshEdits,
  };
}
