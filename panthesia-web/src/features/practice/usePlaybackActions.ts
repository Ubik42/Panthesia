import { useCallback, useEffect, useMemo, type MutableRefObject } from "react";
import {
  api,
  type EngineCommand,
  type PlaybackAdjustmentCommand,
  type LoadedSong,
} from "../../api";
import { PlaybackAdjustmentQueue } from "./playbackAdjustmentQueue";
import {
  capturePlaybackSource,
  isPlaybackAdjustment,
} from "./playbackCommands";
import type { usePracticeSession } from "./usePracticeSession";
type Session = Pick<
  ReturnType<typeof usePracticeSession>,
  | "playback"
  | "getBoundSong"
  | "setState"
  | "setError"
  | "refreshOpenedSession"
  | "updateCollection"
  | "refreshLibrary"
>;
/** One owner for session commands, realtime coalescing and reserved stop commands. */
export function usePlaybackActions({
  session,
  song,
  binding,
  connected,
  startupReady,
  requestBusy,
  songOpeningActive,
  setBusy,
  setNotice,
  clearLiveNotes,
}: {
  session: Session;
  song: LoadedSong | null;
  binding: boolean;
  connected: boolean;
  startupReady: boolean;
  requestBusy: MutableRefObject<boolean>;
  songOpeningActive: MutableRefObject<boolean>;
  setBusy: (value: boolean) => void;
  setNotice: (value: string) => void;
  clearLiveNotes: () => void;
}) {
  const {
    playback,
    getBoundSong,
    setState,
    setError,
    refreshOpenedSession,
    updateCollection,
    refreshLibrary,
  } = session;
  const run = useCallback(
    async (
      value: EngineCommand,
      changesSong = false,
      requestedAt?: number,
      collectionRefresh: "wait" | "background" = "wait",
    ) => {
      if (requestBusy.current) return false;
      if (
        songOpeningActive.current &&
        !["panic", "pause"].includes(value.type)
      ) {
        setNotice("正在准备曲目，可在打开进度中取消或接续。");
        return false;
      }
      if (
        binding &&
        ![
          "pause",
          "panic",
          "retryStartup",
          "skipStartupSong",
          "retrySave",
        ].includes(value.type)
      ) {
        setError("正在读取当前练习，请等待完成后再操作。");
        return false;
      }
      if (
        changesSong ||
        [
          "pause",
          "panic",
          "restart",
          "seek",
          "seekMeasure",
          "seekBeat",
          "stepBeat",
        ].includes(value.type)
      )
        clearLiveNotes();
      requestBusy.current = true;
      setBusy(true);
      let coreReady = false;
      let commandAccepted = false;
      let readingSavedLists = false;
      try {
        if (
          (value.type === "track" ||
            value.type === "trackSound" ||
            value.type === "resetPartSettings" ||
            value.type === "trackAppearance" ||
            value.type === "setPartHands") &&
          song
        ) {
          const current = getBoundSong();
          if (
            !current ||
            current.contentId !== song.contentId ||
            current.engineId !== song.engineId
          )
            throw new Error("曲目已改变，请重新打开声部设置。");
          await api.editPractice(current, value);
        } else if (
          (value.type === "finger" || value.type === "applyHands") &&
          song
        )
          await api.editPractice(song, value);
        else if (value.type === "panic") await api.command(value);
        else if (isPlaybackAdjustment(value))
          await api.adjustPlayback(
            capturePlaybackSource(playback.getSnapshot()),
            value,
            requestedAt,
          );
        else
          await api.commandForEngine(
            playback.getSnapshot().stateOrder?.engineId,
            value,
          );
        commandAccepted = true;
        if (changesSong) {
          await refreshOpenedSession();
        } else setState(await api.state());
        coreReady = true;
        if (
          [
            "load",
            "loadIndexed",
            "openRecent",
            "favorite",
            "queue",
            "moveQueue",
            "save",
            "generate",
            "recording",
          ].includes(value.type)
        ) {
          if (collectionRefresh === "background")
            void updateCollection().catch(() => {});
          else {
            readingSavedLists = true;
            await updateCollection();
          }
        }
        if (value.type === "recording" && !value.active) {
          readingSavedLists = true;
          await refreshLibrary();
        }
        setError("");
        return true;
      } catch (e) {
        const message = String(e instanceof Error ? e.message : e);
        if (commandAccepted && changesSong && !coreReady) setError("");
        else if (coreReady && readingSavedLists) setError("");
        else
          setError(
            coreReady ? `操作已完成，界面读取尚未结束：${message}` : message,
          );
        return coreReady;
      } finally {
        requestBusy.current = false;
        setBusy(false);
      }
    },
    [
      updateCollection,
      refreshLibrary,
      refreshOpenedSession,
      getBoundSong,
      setState,
      song,
      clearLiveNotes,
      binding,
      playback,
    ],
  );
  const action = (value: EngineCommand) => {
    if (value.type === "pause") {
      clearLiveNotes();
      const origin = playback.getEngineId();
      void api
        .commandForEngine(origin, value)
        .then(() => api.state())
        .then((snapshot) => {
          if (
            snapshot.stateOrder?.engineId === origin &&
            playback.getEngineId() === origin
          )
            setState(snapshot);
        })
        .catch((failure) => {
          if (playback.getEngineId() === origin)
            setError(
              failure instanceof Error ? failure.message : String(failure),
            );
        });
      return;
    }
    if (value.type === "panic") {
      clearLiveNotes();
      void api
        .command(value)
        .then(async () => setState(await api.state()))
        .catch((failure) =>
          setError(
            failure instanceof Error ? failure.message : String(failure),
          ),
        );
      return;
    }
    if (!startupReady || binding || !connected) return;
    if (songOpeningActive.current) {
      setNotice("正在准备曲目，可在打开进度中取消或接续。");
      return;
    }
    if (
      value.type === "speed" ||
      value.type === "volume" ||
      value.type === "seek" ||
      value.type === "mode"
    ) {
      void adjustRealtime(value);
    } else
      void run(
        value,
        [
          "track",
          "trackSound",
          "trackAppearance",
          "hands",
          "finger",
          "pairScore",
        ].includes(value.type),
      );
  };
  const playbackAdjustments = useMemo(
    () =>
      new PlaybackAdjustmentQueue(
        () => playback.getSnapshot(),
        async (source, command, createdAtMs) => {
          await api.adjustPlayback(source, command, createdAtMs);
          return api.state();
        },
      ),
    [playback],
  );
  useEffect(() => {
    if (binding || !connected) playbackAdjustments.cancel();
  }, [binding, connected, playbackAdjustments]);
  useEffect(() => () => playbackAdjustments.cancel(), [playbackAdjustments]);
  const adjustRealtime = async (value: PlaybackAdjustmentCommand) => {
    if (!startupReady || binding || !connected || songOpeningActive.current)
      return false;
    if (value.type === "seek") clearLiveNotes();
    try {
      const snapshot = await playbackAdjustments.enqueue(value);
      if (!snapshot) return false;
      setState(snapshot);
      setError("");
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return false;
    }
  };
  return { run, action, adjustRealtime, playbackAdjustments };
}
