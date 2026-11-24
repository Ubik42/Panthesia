import {VirtualHands} from "../features/practice/virtualHands";
import {practiceKeyAt} from "../features/practice/practiceKey";
import { tickAtSeconds } from "../features/practice/practicePresentation";
import {
  isBlackKey,
  keyboardLayout,
  viewportFromRange,
  previewTickSpan,
  type KeyboardViewport,
  type KeyboardRange,
} from "../features/practice/keyboardViewport";
import { useEffect, useMemo, useRef } from "react";
import { usePianoViewportGestures } from "../features/practice/usePianoViewportGestures";
import { PianoKeyboard } from "../features/practice/pianoKeyboard";
import type { PracticeRange } from "../features/practice/usePracticeRange";
import { WaterfallClock } from "../features/practice/waterfallClock";
import { WaterfallLabels } from "../features/practice/waterfallLabels";
import { createWaterfallLayer } from "../features/practice/waterfallLayer";
import { pitchColors, stageAtmospheres, stageBackdrop, stageInk } from "../features/practice/stageTheme";
import { useStageBackground } from "./stageBackground";
import { lyricLines, paintChords, paintLyrics, measureLabels, paintMeasureLabels, sectionColors } from "./songLayers";
import type { PlaybackStore } from "../features/practice/playbackStore";
import { effectPalettes, PianoEffects } from "../features/practice/pianoEffects";
import {
  after,
  FingerActionTimeline,
  NoteTimeline,
} from "../features/practice/noteTimeline";
import type { LoadedSong, Snapshot } from "../engine/sessionTypes";
import {
  displayDefaults,
  productLabel,
  ownsPracticeNote,
  handColor,
  type DisplayPreferences,
} from "../features/settings/displayPreferences";
import "./piano.css";

const sharp = isBlackKey;
/** Room under the keys for the virtual hands' palms: the knuckles sit about 3.3 white keys
 * behind the keys' front edge, the wrist further back. */
const handBay = (display: DisplayPreferences, keyWidth: number, height: number) =>
  display.virtualHands ? Math.round(Math.min(height * 0.22, Math.max(36, keyWidth * 3))) : 0;
/** With the hands shown, keys are drawn in their real proportion (about six key widths long),
 * the same scale the hands use. */
const keyLength = (display: DisplayPreferences, keyWidth: number, height: number) =>
  Math.min(height * 0.4, display.virtualHands ? Math.max(display.keyboardHeight, keyWidth * 6) : display.keyboardHeight);
export function Piano({
  song,
  state,
  store,
  onNote,
  keyboardRange,
  keyboardViewport,
  onViewportChange,
  onPreviewBarsChange,
  previewBars = 4,
  onSelect,
  display = displayDefaults,
  canInteract,
  practiceRange,
}: {
  song: LoadedSong | null;
  state: Snapshot;
  store?: PlaybackStore;
  onNote: (pitch: number, active: boolean) => void;
  keyboardRange: KeyboardRange;
  keyboardViewport?: KeyboardViewport;
  onViewportChange?: (viewport: KeyboardViewport) => void;
  onPreviewBarsChange?: (bars: number) => void;
  previewBars?: number;
  display?: DisplayPreferences;
  onSelect?: (note: LoadedSong["notes"][number]) => void;
  canInteract?: () => boolean;
  practiceRange?: PracticeRange | null;
}) {
  const backgroundImage = useStageBackground();
  const viewport = useMemo(
    () => keyboardViewport ?? viewportFromRange(keyboardRange),
    [keyboardViewport, keyboardRange.low, keyboardRange.high],
  );
  const layout = useMemo(() => keyboardLayout(viewport), [viewport]);
  const white = useMemo(
    () => layout.filter((key) => !key.black).map((key) => key.pitch),
    [layout],
  );
  const black = useMemo(
    () => layout.filter((key) => key.black).map((key) => key.pitch),
    [layout],
  );
  const keyLayout = useMemo(
    () => new Map(layout.map((key) => [key.pitch, key])),
    [layout],
  );
  const geometry = useMemo(
    () => (pitch: number, width: number) => {
      const key = keyLayout.get(pitch)!;
      return { x: key.x * width, w: key.w * width };
    },
    [keyLayout],
  );
  const painted = useRef({white,black,geometry});
  const presentation = useRef({
    display,
    previewBars,
    keyLayout,
    white,
    black,
    geometry,
  });
  presentation.current = {
    display,
    previewBars,
    keyLayout,
    white,
    black,
    geometry,
  };
  const timeline = useMemo(
    () => new NoteTimeline(song?.notes ?? []),
    [song?.notes],
  );
  const actions = useMemo(
    () => new FingerActionTimeline(song?.fingerActions ?? []),
    [song?.fingerActions],
  );
  const trackColors = useMemo(
    () => new Map(song?.tracks.map((track) => [track.id, track.color]) ?? []),
    [song?.tracks],
  );
  const customTracks = useMemo(
    () =>
      new Set(
        song?.tracks
          .filter((track) => track.appearanceCustom)
          .map((track) => track.id) ?? [],
      ),
    [song?.tracks],
  );
  const automaticTracks = useMemo(
    () =>
      new Set(
        song?.tracks
          .filter((track) => track.mode.toLowerCase() === "auto")
          .map((track) => track.id) ?? [],
      ),
    [song?.tracks],
  );
  const labelSources = useMemo(() => {
    const pitches = new Map<number, LoadedSong["notes"][number][]>();
    for (const note of song?.notes ?? []) {
      const list = pitches.get(note.pitch);
      if (!list) pitches.set(note.pitch, [note]);
      else if (!list.some(n=>n.part===note.part && n.playbackMode===note.playbackMode)) list.push(note);
    }
    return pitches;
  }, [song?.notes]);
  const lyrics = useMemo(() => lyricLines(song?.importedLayers.lyrics ?? []), [song?.importedLayers.lyrics]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const waterfallCanvas = useRef<HTMLCanvasElement>(null);
  const effectsCanvas = useRef<HTMLCanvasElement>(null);
  const handCanvas = useRef<HTMLCanvasElement>(null);
  const clock = useRef(new WaterfallClock());
  const latest = useRef({
    song,
    state,
    timeline,
    actions,
    trackColors,
    customTracks,
    automaticTracks,
    labelSources,
    selectable: !!onSelect,
    practiceRange,
    lyrics,
  });
  const requestPaint = useRef<() => void>(() => {});
  const hitSource = useRef<LoadedSong | null>(null);
  const held = useRef(new Map<number, number>());
  const hitNotes = useRef<
    {
      x: number;
      y: number;
      w: number;
      h: number;
      note: LoadedSong["notes"][number];
    }[]
  >([]);
  useEffect(() => {
    let previous: Snapshot | undefined;
    const update = () => {
      const frame = store?.getSnapshot() ?? state;
      if (
        previous &&
        frame.position === previous.position &&
        frame.status === previous.status &&
        frame.mode === previous.mode &&
        frame.hands === previous.hands &&
        frame.pressed === previous.pressed &&
        frame.pressedKeys === previous.pressedKeys &&
        frame.pedal === previous.pedal &&
        frame.required === previous.required &&
        frame.speed === previous.speed &&
        frame.noteEpoch === previous.noteEpoch &&
        frame.contentId === previous.contentId &&
        frame.scoreRevision === previous.scoreRevision &&
        frame.stateOrder?.engineId === previous.stateOrder?.engineId &&
        frame.passage === previous.passage
      )
        return;
      previous = frame;
      const matches = !song || frame.contentId === song.contentId;
      const live =
        matches
            ? frame
            : { ...frame, status: "paused", required: [], pressed: [] };
      latest.current = {
        song: matches ? song : null,
        state: live,
        timeline,
        actions,
        trackColors,
        customTracks,
        automaticTracks,
        labelSources,
        selectable: !!onSelect,
        practiceRange,
        lyrics,
      };
      clock.current.update(
        live,
        `${frame.stateOrder?.engineId}:${frame.contentId}:${frame.scoreRevision}`,
        performance.now(),
      );
      requestPaint.current();
    };
    update();
    return store?.subscribe(update);
  }, [
    store,
    song,
    state,
    timeline,
    actions,
    trackColors,
    customTracks,
    automaticTracks,
    labelSources,
    onSelect,
    practiceRange,
    lyrics,
  ]);
  useEffect(() => {
    const element = canvas.current!;
    element.dataset.renderGeneration = String(
      Number(element.dataset.renderGeneration ?? 0) + 1,
    );
    const effects = new PianoEffects(effectsCanvas.current!,()=>requestPaint.current());
    const virtualHands = new VirtualHands(handCanvas.current!,()=>requestPaint.current());
    const labels = new WaterfallLabels();
    const ctx = element.getContext("2d")!;
    const layer = createWaterfallLayer(waterfallCanvas.current!, ctx, () => requestPaint.current());
    const surface = { width: 0, height: 0, dpr: 1 };
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      surface.width = element.clientWidth;
      surface.height = element.clientHeight;
      surface.dpr =
        (window.devicePixelRatio || 1) *
        (bounds.width / Math.max(1, surface.width));
    };
    measure();
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let suspended = false;
    const keyboard = new PianoKeyboard(
      display,
      white,
      black,
      geometry,
      effectPalettes[display.effectsPalette].right,
    );
    let frame = 0;
    let keyLabelKey="";
    let keyLabelSource: typeof latest.current | undefined;
    let keyLabelDisplay: DisplayPreferences | undefined;
    let keyLabelLayout: typeof keyLayout | undefined;
    let staticKeyLabels = new Map<number, string>();
    const draw = () => {
      frame = 0;
      const { display, previewBars, keyLayout, white, black, geometry } =
        presentation.current;
      const palette = effectPalettes[display.effectsPalette];
      const performanceStyle = display.effectsPreset === "performance";
      keyboard.configure(display, white, black, geometry, palette.right);
      painted.current = {white,black,geometry};
      const { width, height, dpr } = surface;
      if (width <= 0 || height <= 0 || document.hidden) {
        effects.clear();
        return;
      }
      if (
        element.width !== Math.round(width * dpr) ||
        element.height !== Math.round(height * dpr)
      ) {
        element.width = Math.round(width * dpr);
        element.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      hitNotes.current = [];
      const {
        song,
        state,
        timeline,
        actions,
        trackColors,
        customTracks,
        automaticTracks,
        labelSources,
        selectable,
        practiceRange,
        lyrics,
      } = latest.current;
      hitSource.current = song;
      const visualNotes = new Map<number, string>();
      const playedNotes = new Set<number>();
      const playedStrikes = new Map<number,{velocity:number;identity:string}>();
      const reduced = display.reduceMotion || motion.matches;
      const strength = display.effectsIntensity / 100;
      const now = performance.now();
      const keyActions: {
        note: LoadedSong["notes"][number];
        action: NonNullable<LoadedSong["fingerActions"]>[number];
      }[] = [];
      const keyWidth = white.length ? geometry(white[Math.floor(white.length / 2)], width).w : width / 52,
        keyboardHeight = keyLength(display, keyWidth, height),
        bay = handBay(display, keyWidth, height),
        baseline = height - keyboardHeight - bay;
      const position = clock.current.sample(now);
      layer.begin(width, height, baseline, dpr, {
        ...stageBackdrop,
        atmosphere: stageAtmospheres[display.effectsPalette],
        opacity: display.backgroundOpacity / 100,
      });
      for (const pitch of white) {
        const { x } = geometry(pitch, width);
        layer.rect(x - 0.5, 0, 1, baseline, stageInk.keyColumn, pitch % 12 === 0 ? 0.17 : 0.065);
      }
      const tempo = song?.tempo.length
        ? song.tempo
        : [{ tick: 0, seconds: 0, bpm: 120 }];
      const at =
        tempo[Math.max(0, after(tempo, position, (t) => t.seconds) - 1)];
      const tick =
        at.tick +
        (((position - at.seconds) * at.bpm) / 60) * (song?.ppq ?? 480);
      (
        window as Window & {
          __panthesiaWaterfallProbe?: (
            time: number,
            position: number,
            tick: number,
          ) => void;
        }
      ).__panthesiaWaterfallProbe?.(now, position, tick);
      const measures = song?.measures ?? [];
      const index = Math.max(0, after(measures, tick, (m) => m.startTick) - 1);
      const bar = measures[index];
      const span = previewTickSpan(
          measures,
          index,
          previewBars,
          bar ? bar.endTick - bar.startTick : 1920,
        ),
        pixels = baseline / span;
      const loopStart =
        song && state.passage ? tickAtSeconds(song, state.passage.start) : 0;
      const loopEnd =
        song && state.passage
          ? tickAtSeconds(song, state.passage.end)
          : Infinity;
      const showNext =
        !!song &&
        !!state.passage &&
        display.loopPreview &&
        loopEnd > loopStart &&
        loopEnd < tick + span &&
        (!state.rounds || state.repetitions + 1 < state.rounds);
      const windows = [
        {
          start: tick,
          end: Math.min(tick + span, loopEnd),
          offset: 0,
          next: false,
        },
      ];
      if (showNext)
        windows.push({
          start: loopStart,
          end: Math.min(loopEnd, tick + span - (loopEnd - loopStart)),
          offset: loopEnd - loopStart,
          next: true,
        });
      // Sections: a faint band in the section's colour behind the grid, a stronger edge at the left.
      const bands = display.sections && song?.sections?.items.length ? song.sections.items : null;
      if (bands) {
        const colors = sectionColors(bands);
        for (const window of windows)
          bands.forEach((section, i) => {
            const from = Math.max(section.tick, window.start),
              to = Math.min(bands[i + 1]?.tick ?? Infinity, window.end);
            if (to <= from) return;
            const top = baseline - (to + window.offset - tick) * pixels,
              bottom = baseline - (from + window.offset - tick) * pixels;
            layer.rect(0, top, width, bottom - top, colors[i], 0.12);
            layer.rect(0, top, 4, bottom - top, colors[i], 0.75);
          });
      }
      // The next cycle reuses the source grid and an offset, never the following song measures.
      for (let kind = 2; kind >= 0; kind--) {
        const opacity =
          (kind === 0
            ? display.barOpacity
            : kind === 1
              ? display.beatOpacity
              : display.subdivisionOpacity) / 100;
        if (!opacity) continue;
        const thickness = kind === 0 ? 1.5 : kind === 1 ? 0.9 : 0.65;
        const dash = kind === 2 ? ([3, 5] as const) : undefined;
        for (const window of windows) {
          const first = Math.max(
            0,
            after(measures, window.start, (m) => m.startTick) - 1,
          );
          for (let mi = first; mi < measures.length; mi++) {
            const m = measures[mi];
            if (m.startTick > window.end) break;
            if (m.endTick < window.start) continue;
            const beatTicks = (song!.ppq * 4) / m.denominator,
              step = Math.min(
                beatTicks,
                (song!.ppq * 4) / display.gridSubdivision,
              );
            for (
              let line = Math.max(
                0,
                Math.ceil((window.start - m.startTick) / step),
              );
              m.startTick + line * step <
              Math.min(m.endTick, window.end) - 0.01;
              line++
            ) {
              const t = m.startTick + line * step,
                type =
                  line === 0
                    ? 0
                    : Math.abs(
                          (t - m.startTick) / beatTicks -
                            Math.round((t - m.startTick) / beatTicks),
                        ) < 0.001
                      ? 1
                      : 2;
              if (type !== kind) continue;
              const y = baseline - (t + window.offset - tick) * pixels;
              layer.rect(0, y - thickness / 2, width, thickness, stageInk.grid, opacity, dash);
            }
          }
        }
      }
      // Bar labels: numbers inside each section (or the song), section names, the meter only
      // where it changes and only when asked for.
      const sectionItems = song?.sections?.items.length ? song.sections.items : null;
      const barLabels = measureLabels(measures, sectionItems);
      const rows: Parameters<typeof paintMeasureLabels>[1][number][] = [];
      for (const window of windows) {
        const first = Math.max(
          0,
          after(measures, window.start, (m) => m.startTick) - 1,
        );
        for (let mi = first; mi < measures.length; mi++) {
          const m = measures[mi];
          if (m.startTick >= window.end) break;
          if (
            m.startTick < window.start ||
            (window.next && Math.abs(m.startTick - loopStart) < 0.01)
          )
            continue;
          const previous = measures[mi - 1];
          const meterChanged = !previous || previous.numerator !== m.numerator || previous.denominator !== m.denominator;
          rows.push({
            y: baseline - (m.startTick + window.offset - tick) * pixels - 6,
            label: barLabels[mi],
            prefix: window.next ? "下一轮 · " : "",
            meter: display.meterLabels && meterChanged ? `${m.numerator}/${m.denominator}` : null,
          });
        }
      }
      paintMeasureLabels(ctx, rows, display.sections && !!sectionItems, song?.sections?.origin === "generated", width);
      paintChords(ctx, song?.harmony?.chords ?? [], display.chordLabels, tick, Math.min(span, loopEnd - tick), pixels, baseline, width);
      if (display.lyrics) paintLyrics(ctx, lyrics, tick, baseline);
      const colorFor = (note: LoadedSong["notes"][number]) =>
        display.palette === "accessible"
          ? handColor(note.part, display)
          : display.palette === "pitch"
            ? pitchColors[note.pitch % 12]
          : customTracks.has(note.track)
            ? (trackColors.get(note.track) ?? palette.right)
            : note.part === "left"
              ? palette.left
              : palette.right;
      if (song) {
        timeline.visit(tick, Math.min(tick + span, loopEnd), (note) => {
          if (!keyLayout.has(note.pitch)) return;
          if (
            state.passage &&
            (note.tick >= loopEnd || note.endTick <= loopStart)
          )
            return;
          if (note.start + note.duration < position) return;
          if (position >= note.start && position < note.start + note.duration) {
            const action = actions.keyLabel(note, position, state.speed);
            if (action) keyActions.push({ note, action });
          }
          const { x, w } = geometry(note.pitch, width),
            y = baseline - (Math.max(note.tick, loopStart) - tick) * pixels,
            h = Math.max(
              8,
              (Math.min(note.endTick, loopEnd) -
                Math.max(note.tick, loopStart)) *
                pixels,
            );
          const required =
            state.required.includes(note.pitch) &&
            Math.abs(note.start - state.position) < 0.02;
          if (selectable) hitNotes.current.push({ x, y: y - h, w, h, note });
          const noteColor = colorFor(note);
          if (
            (position >= note.start && position < note.start + note.duration) ||
            required
          )
            visualNotes.set(note.pitch, noteColor);
          if (
            state.status === "playing" &&
            position >= note.start &&
            position < note.start + note.duration &&
            (state.mode === "listen" ||
              state.mode === "flow" ||
              note.playbackMode === "Auto" ||
              automaticTracks.has(note.track))
          )
            {playedNotes.add(note.pitch);playedStrikes.set(note.pitch,{velocity:note.velocity,identity:`${note.track}:${note.index}:${note.tick}`});}
          const fill = required ? stageInk.required : noteColor;
          const inRange =
            !practiceRange ||
            (note.start < practiceRange.end &&
              note.start + note.duration > practiceRange.start);
          layer.note(
            x + 2,
            y - h,
            Math.max(2, w - 4),
            h,
            fill,
            required ? 1 : inRange ? 0.88 : 0.24,
            display.effectsEnabled && !reduced && performanceStyle
              ? 10 * strength
              : 0,
          );
          const action = actions.current(note, position, state.speed);
          const label = productLabel(note.pitch, "note", display, {finger: action?.to ?? note.finger, own: state.mode !== "listen" && ownsPracticeNote(note.part, note.playbackMode, state.hands), ...practiceKeyAt(song.practiceVariant,note.start)});
          if (label && w > 10 && h > 16) {
            labels.paintLabel(
              ctx,
              label,
              x + w / 2,
              y - 8,
              w,
              display.fontSize,
              fill,
              dpr,
            );
          }
        });
      }
      // Preview one following cycle in display coordinates only. It never adds hits, key state or audio.
      if (song && showNext) {
        const offset = loopEnd - loopStart;
        const previewEnd = Math.min(loopEnd, tick + span - offset);
        timeline.visit(loopStart, previewEnd, (note) => {
          if (
            !keyLayout.has(note.pitch) ||
            note.tick >= loopEnd ||
            note.endTick <= loopStart
          )
            return;
          const start = Math.max(loopStart, note.tick) + offset,
            end = Math.min(loopEnd, note.endTick) + offset;
          const { x, w } = geometry(note.pitch, width),
            y = baseline - (start - tick) * pixels,
            h = Math.max(8, (end - start) * pixels);
          const fill = colorFor(note);
          layer.note(x + 2, y - h, Math.max(2, w - 4), h, fill, 0.34, 0);
          const label = productLabel(note.pitch, "note", display, {finger: note.finger, own: state.mode !== "listen" && ownsPracticeNote(note.part, note.playbackMode, state.hands), ...practiceKeyAt(song.practiceVariant,note.start)});
          if (label && w > 10 && h > 16)
            labels.paintLabel(
              ctx,
              label,
              x + w / 2,
              y - 8,
              w,
              display.fontSize,
              fill,
              dpr,
            );
        });
        const seam = baseline - (loopEnd - tick) * pixels;
        if (seam >= 0 && seam <= baseline) {
          layer.rect(0, seam - 0.5, width, 1, palette.right, 0.7, [5, 5]);
          ctx.save();
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = palette.right;
          ctx.font = "11px sans-serif";
          ctx.textAlign = "right";
          ctx.fillText("下一轮 · 循环起点", width - 8, seam - 5);
          ctx.restore();
        }
      }
      layer.end();
      ctx.textAlign = "left";
      ctx.fillStyle = palette.right;
      ctx.fillRect(0, baseline - 2, width, 2);
      if (display.effectsEnabled && !suspended) {
        effects.update({
          now,
          position,
          status: state.status,
          epoch: state.noteEpoch,
          source: `${state.stateOrder?.engineId}:${song?.contentId ?? "free"}:${state.scoreRevision}:${state.mode}:${width}:${height}`,
          performance: performanceStyle,
          strength,
          reduced,
          pedal:state.pedal,
          strikes: [...new Set([...state.pressed, ...playedNotes])]
            .filter((pitch) => keyLayout.has(pitch))
            .map((pitch) => ({
              pitch,
              velocity:state.pressed.includes(pitch)?state.pressedKeys?.[pitch]?.velocity??88:playedStrikes.get(pitch)?.velocity,
              identity:state.pressed.includes(pitch)?`input:${state.pressedKeys?.[pitch]?.serial??0}`:playedStrikes.get(pitch)?.identity,
              color:
                visualNotes.get(pitch) ?? palette.right,
            })),
        });
        effects.paint(
          ctx,
          now,
          baseline,
          width,
          (pitch) =>
            keyLayout.has(pitch) ? geometry(pitch, width) : undefined,
          performanceStyle,
          strength,
          reduced,
          display.effectStyle,
          dpr,
        );
      } else effects.clear();
      const source = latest.current;
      const activeKey=practiceKeyAt(song?.practiceVariant,position),keyStamp=`${activeKey.tonic}:${activeKey.fifths}:${activeKey.minor}`;
      if (keyLabelKey!==keyStamp || keyLabelDisplay !== display || keyLabelLayout !== keyLayout ||
          keyLabelSource?.song !== song || keyLabelSource?.state.mode !== state.mode ||
          keyLabelSource?.state.hands !== state.hands) {
        staticKeyLabels = new Map();
        for (const pitch of [...white, ...black]) {
          const candidates = labelSources.get(pitch) ?? [];
          const own = !song || state.mode !== "listen" && candidates.some(n=>ownsPracticeNote(n.part,n.playbackMode,state.hands));
          staticKeyLabels.set(pitch, productLabel(pitch,"key",display,{own,...activeKey}));
        }
        keyLabelKey=keyStamp;
        keyLabelSource = source; keyLabelDisplay = display; keyLabelLayout = keyLayout;
      }
      // Finger labels depend on the current passage; never mutate the static map.
      const keyLabels = display.keyLabelMode === "finger" ? new Map(staticKeyLabels) : staticKeyLabels;
      if (display.keyLabelMode === "finger") {
        timeline.visit(tick, tick + Math.max(1, song?.ppq ?? 480), note => {
          const own = state.mode !== "listen" && ownsPracticeNote(note.part,note.playbackMode,state.hands);
          const label = productLabel(note.pitch,"key",display,{own,finger:actions.current(note,position,state.speed)?.to ?? note.finger});
          if (label && keyLabels.has(note.pitch) && !keyLabels.get(note.pitch)) keyLabels.set(note.pitch,label);
        });
      }
      if (bay) {
        ctx.fillStyle = stageInk.handBay;
        ctx.fillRect(0, height - bay, width, bay);
      }
      keyboard.paint(ctx, {
        width,
        height: height - bay,
        dpr,
        keyboardHeight,
        pressed: state.pressed,
        required: state.required,
        played: playedNotes,
        colors: visualNotes,
        labels: keyLabels,
      });
      // Light strip along the top of the keys, lit in the colours of the sounding notes.
      if (display.ledStrip) {
        ctx.save();
        ctx.fillStyle = stageInk.ledBase;
        ctx.fillRect(0, baseline - 3, width, 3);
        ctx.shadowBlur = reduced ? 6 : 18;
        for (const pitch of new Set([...visualNotes.keys(), ...state.pressed])) {
          if (!keyLayout.has(pitch)) continue;
          const { x, w } = geometry(pitch, width);
          const color = visualNotes.get(pitch) ?? palette.right;
          ctx.shadowColor = color;
          ctx.fillStyle = color;
          ctx.fillRect(x - w * 0.6, baseline - 3, w * 2.2, 3);
        }
        ctx.restore();
      }
      if (song && (display.keyLabelMode === "finger" || (display.keyLabelMode === "legacy" && ["auto", "finger", "both"].includes(display.noteLabels)))) {
        for (const { note: n, action: a } of keyActions) {
          if (display.keyLabelsOwnOnly && !ownsPracticeNote(n.part,n.playbackMode,state.hands)) continue;
          const { x, w } = geometry(n.pitch, width);
          const completed = position >= a.at;
          ctx.font = `bold ${Math.min(13, w - 4)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.fillStyle = sharp(n.pitch) ? stageInk.fingerOnBlack : stageInk.fingerOnWhite;
          ctx.fillText(
            completed ? String(a.to) : `${a.from}→${a.to}`,
            x + w / 2,
            baseline + 22,
          );
        }
      }
      virtualHands.configure(song,state.speed,display.virtualHands);
      const handState=virtualHands.paint(position,baseline,baseline+keyboardHeight,height,width,pitch=>keyLayout.has(pitch)?geometry(pitch,width):undefined,display.virtualHandOpacity/100);
      element.dataset.virtualHands=display.virtualHands?(virtualHands.ready?"ready":"preparing"):"off";
      element.dataset.handPoses=String(handState.hands);
      element.dataset.thumbUnder=String(handState.thumbUnder);
      element.dataset.fingerSubstitutions=String(handState.substitution);
      element.dataset.handsCrossed=String(handState.crossed);
      ctx.textAlign = "left";
      element.dataset.effectParticles = String(effects.particleCount);
      element.dataset.effectRenderer = effects.renderer;
      element.dataset.waterfallRenderer = layer.renderer;
      if (effects.active || clock.current.moving)
        frame = requestAnimationFrame(draw);
    };
    const schedule = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(draw);
    };
    requestPaint.current = schedule;
    const resized = () => {
      measure();
      schedule();
    };
    const resize = new ResizeObserver(resized);
    window.addEventListener("resize", resized);
    resize.observe(element);
    const visibility = () => {
      if (!document.hidden) {
        clock.current.synchronize(performance.now());
        measure();
      }
      schedule();
    };
    document.addEventListener("visibilitychange", visibility);
    const blur = () => {
      suspended = true;
      effects.clear();
      schedule();
    };
    const focus = () => {
      suspended = false;
      effects.clear();
      schedule();
    };
    const motionChanged = () => {
      effects.clear();
      schedule();
    };
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    motion.addEventListener("change", motionChanged);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      effects.dispose();
      layer.dispose();
      virtualHands.dispose();
      resize.disconnect();
      window.removeEventListener("resize", resized);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      motion.removeEventListener("change", motionChanged);
      requestPaint.current = () => {};
    };
  }, []);
  useEffect(() => {
    requestPaint.current();
  }, [previewBars, display, keyLayout, white, black]);
  const release = (pointer?: number) => {
    if (pointer !== undefined) {
      const pitch = held.current.get(pointer);
      held.current.delete(pointer);
      if (
        pitch !== undefined &&
        !Array.from(held.current.values()).includes(pitch)
      )
        onNote(pitch, false);
    } else {
      new Set(held.current.values()).forEach((p) => onNote(p, false));
      held.current.clear();
    }
  };
  useEffect(() => {
    const clear = () => {
      new Set(held.current.values()).forEach((pitch) => onNote(pitch, false));
      held.current.clear();
    };
    const hide = () => {
      if (document.hidden) clear();
    };
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", hide);
      clear();
    };
  }, [onNote]);
  const gestures = usePianoViewportGestures({
    canvas,
    viewport,
    previewBars,
    keyboardHeight: keyLength(display, (canvas.current?.clientWidth ?? 1040) / 52, canvas.current?.clientHeight ?? 600) + handBay(display, (canvas.current?.clientWidth ?? 1040) / 52, canvas.current?.clientHeight ?? 600),
    onViewportChange,
    onPreviewBarsChange,
    canInteract,
    release,
  });
  return (
    <div className="piano-surface">
    {backgroundImage && <div className="piano-backdrop-image" style={{ backgroundImage: `url(${backgroundImage})` }} aria-hidden="true" />}
    <canvas ref={waterfallCanvas} className="piano-waterfall" aria-hidden="true" />
    <canvas
      ref={canvas}
      className="piano-stage-canvas"
      data-key-low={keyboardRange.low}
      data-key-high={keyboardRange.high}
      data-viewport-start={viewport.start}
      data-viewport-span={viewport.span}
      data-preview-bars={previewBars}
      style={{ touchAction: "none" }}
      tabIndex={0}
      aria-label="按小节排列的音符与可演奏键盘"
      onPointerDown={(e) => {
        if (canInteract?.() === false) return;
        e.currentTarget.focus({ preventScroll: true });
        if (gestures.down(e)) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const bounds = e.currentTarget.getBoundingClientRect(),
          x =
            ((e.clientX - bounds.left) * e.currentTarget.clientWidth) /
            Math.max(1, bounds.width),
          y =
            ((e.clientY - bounds.top) * e.currentTarget.clientHeight) /
            Math.max(1, bounds.height);
        const keys = painted.current;
        const keyWidth = keys.white.length ? keys.geometry(keys.white[Math.floor(keys.white.length / 2)], e.currentTarget.clientWidth).w : e.currentTarget.clientWidth / 52;
        const keyboardHeight = keyLength(display, keyWidth, e.currentTarget.clientHeight);
        const bay = handBay(display, keyWidth, e.currentTarget.clientHeight);
        if (y > e.currentTarget.clientHeight - bay) return;
        if (y < e.currentTarget.clientHeight - bay - keyboardHeight) {
          if (hitSource.current !== song) return;
          const hit = [...hitNotes.current]
            .reverse()
            .find(
              (n) => x >= n.x && x < n.x + n.w && y >= n.y && y < n.y + n.h,
            );
          if (hit) {
            const select = () => {
              if (hitSource.current === song) onSelect?.(hit.note);
            };
            if (e.pointerType === "touch") gestures.deferSelection(e, select);
            else select();
          }
          return;
        }
        release(e.pointerId);
        const {white,black,geometry} = painted.current;
        const candidates =
          y < e.currentTarget.clientHeight - bay - keyboardHeight * 0.38
            ? [...black, ...white]
            : white;
        const pitch = candidates.find((p) => {
          const g = geometry(p, e.currentTarget.clientWidth);
          return x >= g.x && x < g.x + g.w;
        });
        if (pitch !== undefined) {
          const already = Array.from(held.current.values()).includes(pitch);
          held.current.set(e.pointerId, pitch);
          if (!already) onNote(pitch, true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      }}
      onPointerMove={gestures.move}
      onPointerUp={(e) => {
        gestures.up(e);
        release(e.pointerId);
      }}
      onPointerCancel={(e) => {
        gestures.cancel(e);
        release(e.pointerId);
      }}
      onLostPointerCapture={(e) => {
        gestures.cancel(e);
        release(e.pointerId);
      }}
    />
    <canvas ref={effectsCanvas} className="piano-gpu-effects" aria-hidden="true" />
    <canvas ref={handCanvas} className="piano-hands" aria-hidden="true" />
    </div>
  );
}
