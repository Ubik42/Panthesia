import {
useCallback,
useEffect,
useRef,
type Dispatch,
type SetStateAction,
type MutableRefObject,
type RefObject,
} from "react";
import {
api,
type Snapshot,
type EngineCommand,
type LoadedSong,
} from "../../api";
import type { DisplayPreferences } from "../settings/displayPreferences";
import { keyboardMap } from "../settings/displayPreferences";
import { eventShortcut,shortcutActions } from "../../app/shortcuts";
import {
isCapturingKeys,
isComposingKey,
isTextEntry,
visibleDialogs,
topInputScope,
topPopup,
} from "../../app/inputOwnership";
import { capturePlaybackSource,samePlaybackSource } from "./playbackCommands";
import {
normalizePreviewBars,
resolveKeyboardViewport,
zoomKeyboardViewport,
panKeyboardViewport,
viewportRange,
} from "./keyboardViewport";
import { seekableMeasures,activeMeasures } from "./practicePresentation";
import type { PlaybackStore } from "./playbackStore";
import type { BookmarkNavigation } from "./SongBookmarks";
/** Musical keys and operation shortcuts share one input owner and cancellation generation. */
export function usePerformanceKeyboard({
  display,
  setDisplay,
  song,
  playback,
  getBoundSong,
  keyboardPaused,
  shortcutScope,
  ownershipRevision,
  songOpeningActive,
  run,
  action,
  setState,
  setError,
  onNote,
  clearLiveNotes,
  loopStart,
  loopEnd,
  bookmarkNavigation,
  ui,
}: {
  display: DisplayPreferences;
  setDisplay: Dispatch<SetStateAction<DisplayPreferences>>;
  song: LoadedSong | null;
  playback: PlaybackStore;
  getBoundSong: () => LoadedSong | null;
  keyboardPaused: boolean;
  shortcutScope: string;
  ownershipRevision: number;
  songOpeningActive: MutableRefObject<boolean>;
  run: (
    command: EngineCommand,
    changesSong?: boolean,
    requestedAt?: number,
  ) => Promise<boolean>;
  action: (command: EngineCommand) => void;
  setState: (state: Snapshot) => void;
  setError: (value: string) => void;
  onNote: (pitch: number, active: boolean) => void;
  clearLiveNotes: () => void;
  loopStart: number;
  loopEnd: number;
  bookmarkNavigation: RefObject<BookmarkNavigation | null>;
  ui: {
    commands: () => void;
    browse: () => void;
    options: () => void;
    display: () => void;
    passages: () => void;
    fullscreen: () => void;
  };
}) {
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const setView = (next: string | ((previous: string) => string)) =>
    setDisplay((previous) => ({
      ...previous,
      practiceView: (typeof next === "function"
        ? next(previous.practiceView)
        : next) as DisplayPreferences["practiceView"],
    }));
  const shortcutQueue = useRef<Promise<unknown>>(Promise.resolve());
  const shortcutGeneration = useRef(0);
  const invalidateKeyboardActions = useCallback(() => {
    shortcutGeneration.current++;
    shortcutQueue.current = Promise.resolve();
  }, []);
  useEffect(() => {
    const silence = (event: KeyboardEvent) => {
      if (
        !display.shortcuts.silence ||
        event.repeat ||
        isComposingKey(event) ||
        eventShortcut(event) !== display.shortcuts.silence
      )
        return;
      if (isCapturingKeys()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      invalidateKeyboardActions();
      clearLiveNotes();
      void api
        .command({ type: "panic" })
        .then(async () => setState(await api.state()))
        .catch((failure) =>
          setError(
            failure instanceof Error ? failure.message : String(failure),
          ),
        );
    };
    window.addEventListener("keydown", silence, true);
    return () => window.removeEventListener("keydown", silence, true);
  }, [
    display.shortcuts.silence,
    setState,
    clearLiveNotes,
    invalidateKeyboardActions,
  ]);
  const keyboardContext = useRef({
    paused: keyboardPaused,
    scope: shortcutScope,
  });
  keyboardContext.current = { paused: keyboardPaused, scope: shortcutScope };
  useEffect(() => {
    invalidateKeyboardActions();
  }, [
    shortcutScope,
    keyboardPaused,
    display.shortcuts,
    ownershipRevision,
    invalidateKeyboardActions,
  ]);
  useEffect(() => {
    const keys = keyboardMap(display);
    const held = new Set<number>();
    const clear = () => {
      held.forEach((p) => onNote(p, false));
      held.clear();
      invalidateKeyboardActions();
      clearLiveNotes();
    };
    const down = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isComposingKey(e) || isCapturingKeys()) return;
      const editableTarget = isTextEntry(e.target);
      const zoomChord = eventShortcut(e),
        zoomAction = zoomChord
          ? shortcutActions.find(
              (a) =>
                display.shortcuts[a.id] === zoomChord &&
                ["zoomIn", "zoomOut", "zoomReset"].includes(a.id),
            )
          : undefined;
      if (
        zoomAction &&
        !editableTarget &&
        !e.repeat &&
        !e.isComposing &&
        !e.defaultPrevented
      ) {
        e.preventDefault();
        setDisplay((p) => ({
          ...p,
          uiScale:
            zoomAction.id === "zoomReset"
              ? 100
              : Math.max(
                  80,
                  Math.min(
                    150,
                    p.uiScale + (zoomAction.id === "zoomIn" ? 10 : -10),
                  ),
                ),
        }));
        return;
      }

      if (
        zoomChord &&
        zoomChord === display.shortcuts.commands &&
        !e.defaultPrevented &&
        !e.repeat &&
        !e.isComposing
      ) {
        if (visibleDialogs().length > 0) return;
        e.preventDefault();
        clear();
        uiRef.current.commands();
        return;
      }
      // Full screen works on every page, like the command palette.
      if (zoomChord && zoomChord === display.shortcuts.fullscreen && !e.defaultPrevented && !e.repeat && !e.isComposing) {
        e.preventDefault();
        uiRef.current.fullscreen();
        return;
      }
      if (
        songOpeningActive.current &&
        !editableTarget &&
        !e.defaultPrevented &&
        !e.isComposing &&
        !e.repeat &&
        zoomChord === display.shortcuts.playPause &&
        ["playing", "countIn"].includes(playback.getSnapshot().status)
      ) {
        e.preventDefault();
        clear();
        action({ type: "pause" });
        return;
      }
      if (
        keyboardPaused ||
        topInputScope() ||
        topPopup(null) ||
        songOpeningActive.current ||
        editableTarget ||
        e.repeat
      )
        return;
      if (e.target instanceof Element) {
        if (
          !e.ctrlKey &&
          !e.altKey &&
          !e.shiftKey &&
          ["Space", "Enter"].includes(e.code) &&
          e.target.closest(
            'button,summary,a[href],[role="button"],[role="checkbox"],[role="switch"],[role="radio"]',
          )
        )
          return;
      }
      const chord = eventShortcut(e),
        shortcut = chord
          ? shortcutActions.find((a) => display.shortcuts[a.id] === chord)
          : undefined;
      if (shortcut) {
        e.preventDefault();
        const current = playback.getSnapshot();
        const execute = (build: (latest: Snapshot) => EngineCommand) => {
          const generation = shortcutGeneration.current;
          const scope = keyboardContext.current.scope;
          const currentOwner = () =>
            generation === shortcutGeneration.current &&
            !keyboardContext.current.paused &&
            keyboardContext.current.scope === scope &&
            !document.hidden &&
            !topInputScope() &&
            !topPopup(null);
          const origin = capturePlaybackSource(playback.getSnapshot());
          const createdAt = Date.now();
          shortcutQueue.current = shortcutQueue.current
            .then(async () => {
              if (!currentOwner()) return;
              const latest = await api.state();
              if (!currentOwner()) return;
              if (!samePlaybackSource(origin, latest))
                throw new Error("曲目已改变，已取消上一首曲目的快捷键操作。");
              if (Date.now() - createdAt > 2000)
                throw new Error("快捷键请求已过期，请在当前练习中重新按键。");
              const ready = await run(build(latest), false, createdAt);
              if (!ready && generation === shortcutGeneration.current)
                shortcutGeneration.current++;
            })
            .catch((failure) => {
              if (generation !== shortcutGeneration.current) return;
              shortcutGeneration.current++;
              setError(
                failure instanceof Error ? failure.message : String(failure),
              );
            });
        };
        if (shortcut.id.startsWith("bookmark")) {
          bookmarkNavigation.current?.jump(Number(shortcut.id.slice(8)) - 1);
          return;
        }
        switch (shortcut.id) {
          case "previewMore":
          case "previewLess":
            setDisplay((previous) => ({
              ...previous,
              previewBars: normalizePreviewBars(
                previous.previewBars + (shortcut.id === "previewMore" ? 1 : -1),
              ),
            }));
            break;
          case "keyboardZoomIn":
          case "keyboardZoomOut":
          case "keyboardPanLow":
          case "keyboardPanHigh":
            setDisplay((previous) => {
              const view = resolveKeyboardViewport(
                previous,
                getBoundSong()?.notes ?? [],
                playback.getSnapshot().input,
              );
              const next =
                shortcut.id === "keyboardZoomIn"
                  ? zoomKeyboardViewport(view, 1 / 1.2)
                  : shortcut.id === "keyboardZoomOut"
                    ? zoomKeyboardViewport(view, 1.2)
                    : panKeyboardViewport(
                        view,
                        shortcut.id === "keyboardPanLow" ? -3.5 : 3.5,
                      );
              const range = viewportRange(next);
              return {
                ...previous,
                range: "custom",
                keyboardViewport: next,
                keyboardLow: range.low,
                keyboardHigh: range.high,
              };
            });
            break;
          case "playPause":
            execute((c) => ({
              type: ["playing", "countIn"].includes(c.status)
                ? "pause"
                : "play",
            }));
            break;
          case "restart":
            execute(() => ({ type: "restart" }));
            break;
          case "silence":
            clear();
            execute(() => ({ type: "pause" }));
            break;
          case "previousMeasure":
          case "nextMeasure":
            execute((c) => {
              const range = seekableMeasures(song, c.passage);
              if (!range)
                throw new Error(
                  "当前选段内没有可跳转的小节起点，请用逐拍导航。",
                );
              return {
                type: "seekMeasure",
                measure: Math.max(
                  range.first,
                  Math.min(
                    range.last,
                    c.measure + (shortcut.id === "nextMeasure" ? 1 : -1),
                  ),
                ),
              };
            });
            break;
          case "slower":
          case "faster":
            execute((c) => ({
              type: "speed",
              value: Math.max(
                0.25,
                Math.min(
                  2,
                  (Math.round(c.bpm * c.speed) +
                    (shortcut.id === "faster" ? 5 : -5)) /
                    Math.max(1, c.bpm),
                ),
              ),
            }));
            break;
          case "loop":
            execute((c) => {
              const range = activeMeasures(song, c.passage);
              return {
                type: "measureLoop",
                enabled: !c.passage,
                start: c.passage ? (range?.first ?? 1) : loopStart,
                end: c.passage ? (range?.last ?? 1) : loopEnd,
              };
            });
            break;
          case "metronome":
            execute((c) => ({ type: "metronome", enabled: !c.metronome }));
            break;
          case "view":
            setView((v) =>
              v === "keyboard"
                ? "score"
                : v === "score"
                  ? "combined"
                  : v === "combined"
                    ? "paper"
                    : "keyboard",
            );
            break;
          case "library":
            uiRef.current.browse();
            break;
          case "inspector":
            uiRef.current.options();
            break;
          case "display":
            uiRef.current.display();
            break;
          case "passages":
            uiRef.current.passages();
            break;
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const pitch = display.keyboardEnabled ? keys[e.code] : undefined;
      if (pitch !== undefined) {
        e.preventDefault();
        held.add(pitch);
        onNote(pitch, true);
      }
    };
    const up = (e: KeyboardEvent) => {
      const p = keys[e.code];
      if (p !== undefined && held.delete(p)) onNote(p, false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    const hide = () => {
      if (document.hidden) clear();
    };
    document.addEventListener("visibilitychange", hide);
    document.addEventListener("compositionstart", clear);
    return () => {
      clear();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", hide);
      document.removeEventListener("compositionstart", clear);
    };
  }, [
    keyboardPaused,
    display.keyCodes,
    display.shortcuts,
    loopStart,
    loopEnd,
    song,
    display.keyboardOctave,
    display.keyboardEnabled,
    onNote,
    clearLiveNotes,
    invalidateKeyboardActions,
    run,
    playback,
    setDisplay,
    setError,
  ]);
  return { keyboardContext, invalidateKeyboardActions };
}
