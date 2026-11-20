import { isBlackKey, panKeyboardRange, zoomKeyboardRange, type KeyboardRange } from "./features/practice/keyboardViewport";
import { useEffect, useMemo, useRef } from "react";
import { PianoKeyboard } from "./features/practice/pianoKeyboard";
import type { PracticeRange } from "./features/practice/usePracticeRange";
import { WaterfallClock } from "./features/practice/waterfallClock";
import { WaterfallSprites } from "./features/practice/waterfallSprites";
import type { PlaybackStore } from "./features/practice/playbackStore";
import { effectPalettes, PianoEffects } from "./features/practice/pianoEffects";
import {
  after,
  FingerActionTimeline,
  NoteTimeline,
} from "./features/practice/noteTimeline";
import type { LoadedSong, Snapshot } from "./engine/sessionTypes";
import {
  displayDefaults,
  noteLabel,
  handColor,
  type DisplayPreferences,
} from "./displayPreferences";

const sharp = isBlackKey;
function keyGeometry(pitch: number, width: number, white: number[]) {
  const w = width / white.length;
  const index = white.filter((p) => p < pitch).length;
  return sharp(pitch)
    ? { x: index * w - w * 0.31, w: w * 0.62 }
    : { x: index * w, w };
}
export function Piano({
  song,
  state,
  store,
  onNote,
  keyboardRange,
  onViewportChange,
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
  onViewportChange?: (range: KeyboardRange) => void;
  previewBars?: number;
  display?: DisplayPreferences;
  onSelect?: (note: LoadedSong["notes"][number]) => void;
  canInteract?: () => boolean;
  practiceRange?: PracticeRange|null;
}) {
  const pitches = useMemo(() => Array.from({ length: keyboardRange.high - keyboardRange.low + 1 }, (_, i) => keyboardRange.low + i), [keyboardRange.low, keyboardRange.high]);
  const white = useMemo(() => pitches.filter((p) => !sharp(p)), [pitches]);
  const black = useMemo(() => pitches.filter(sharp), [pitches]);
  const keyLayout = useMemo(
    () =>
      new Map(pitches.map((pitch) => [pitch, keyGeometry(pitch, 1, white)])),
    [pitches, white],
  );
  const geometry = (pitch: number, width: number) => {
    const key = keyLayout.get(pitch)!;
    return { x: key.x * width, w: key.w * width };
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
  const canvas = useRef<HTMLCanvasElement>(null);
  const clock = useRef(new WaterfallClock());
  const latest = useRef({
    song,
    state,
    timeline,
    actions,
    trackColors,
    customTracks,
    automaticTracks,
    selectable: !!onSelect,
    practiceRange,
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
        frame.pressed === previous.pressed &&
        frame.required === previous.required &&
        frame.speed === previous.speed &&
        frame.noteEpoch === previous.noteEpoch &&
        frame.score.wrong_notes === previous.score.wrong_notes &&
        frame.contentId === previous.contentId &&
        frame.scoreRevision === previous.scoreRevision &&
        frame.stateOrder?.engineId === previous.stateOrder?.engineId &&
        frame.passage === previous.passage
      )
        return;
      previous = frame;
      const matches = !song || frame.contentId === song.contentId;
      const live =
        frame.mode === "memory"
          ? { ...frame, required: [] }
          : matches
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
        selectable: !!onSelect,
        practiceRange,
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
    onSelect,
    practiceRange,
  ]);
  useEffect(() => {
    const element = canvas.current!;
    const effects = new PianoEffects();
    const sprites = new WaterfallSprites();
    const ctx = element.getContext("2d", { alpha: false })!;
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
    let previousWrong = 0;
    const palette = effectPalettes[display.effectsPalette];
    const performanceStyle = display.effectsPreset === "performance";
    const keyboard = new PianoKeyboard(
      display,
      white,
      black,
      geometry,
      palette.right,
    );
    let frame = 0;
    const draw = () => {
      frame = 0;
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
        selectable,
        practiceRange,
      } = latest.current;
      hitSource.current = song;
      const visualNotes = new Map<number, string>();
      const playedNotes = new Set<number>();
      const reduced = display.reduceMotion || motion.matches;
      const strength = display.effectsIntensity / 100;
      const now = performance.now();
      const keyActions: {
        note: LoadedSong["notes"][number];
        action: NonNullable<LoadedSong["fingerActions"]>[number];
      }[] = [];
      const keyboardHeight = Math.min(display.keyboardHeight, height * 0.45),
        baseline = height - keyboardHeight;
      const position = clock.current.sample(now);
      sprites.backdrop(
        ctx,
        `${width}:${baseline}:${dpr}`,
        width,
        baseline,
        dpr,
        (ctx) => {
          const gradient = ctx.createLinearGradient(0, 0, 0, baseline);
          gradient.addColorStop(
            0,
            display.skin === "rosewood"
              ? "#211811"
              : display.skin === "midnight"
                ? "#100e20"
                : "#0a111e",
          );
          gradient.addColorStop(
            0.6,
            display.skin === "rosewood"
              ? "#30261d"
              : display.skin === "midnight"
                ? "#1e1839"
                : "#101d2a",
          );
          gradient.addColorStop(
            1,
            display.skin === "rosewood"
              ? "#413328"
              : display.skin === "midnight"
                ? "#31264d"
                : "#162d36",
          );
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, width, baseline);
          const atmosphere = ctx.createRadialGradient(
            width * 0.5,
            baseline,
            0,
            width * 0.5,
            baseline,
            Math.max(width * 0.6, baseline),
          );
          atmosphere.addColorStop(
            0,
            display.effectsPalette === "ember"
              ? "#58372755"
              : display.effectsPalette === "violet"
                ? "#44336055"
                : "#245a6150",
          );
          atmosphere.addColorStop(1, "transparent");
          ctx.fillStyle = atmosphere;
          ctx.fillRect(0, 0, width, baseline);
          for (const pitch of white) {
            const { x } = geometry(pitch, width);
            ctx.strokeStyle =
              pitch % 12 === 0
                ? "rgba(166,185,210,.17)"
                : "rgba(166,185,210,.065)";
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, baseline);
            ctx.stroke();
          }
        },
      );
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
      const end =
        song?.measures[Math.max(0, index) + previewBars]?.startTick ??
        (bar?.startTick ?? tick) +
          (bar ? bar.endTick - bar.startTick : 1920) * previewBars;
      const span = Math.max(1, end - (bar?.startTick ?? tick)),
        pixels = baseline / span;
      // Batch each grid style into one path instead of one draw call per line.
      for (let kind = 2; kind >= 0; kind--) {
        const opacity =
          (kind === 0
            ? display.barOpacity
            : kind === 1
              ? display.beatOpacity
              : display.subdivisionOpacity) / 100;
        if (opacity === 0) continue;
        ctx.strokeStyle = `rgba(204,215,234,${opacity})`;
        ctx.lineWidth = kind === 0 ? 1.5 : kind === 1 ? 0.9 : 0.65;
        ctx.setLineDash(kind === 2 ? [3, 5] : []);
        ctx.beginPath();
        for (let mi = index; mi < measures.length; mi++) {
          const m = measures[mi];
          if (m.startTick > tick + span) break;
          if (m.endTick < tick) continue;
          const beatTicks = (song!.ppq * 4) / m.denominator,
            step = Math.min(
              beatTicks,
              (song!.ppq * 4) / display.gridSubdivision,
            );
          for (
            let line = Math.max(0, Math.ceil((tick - m.startTick) / step));
            m.startTick + line * step < m.endTick - 0.01;
            line++
          ) {
            const t = m.startTick + line * step;
            const type =
              line === 0
                ? 0
                : Math.abs(
                      (t - m.startTick) / beatTicks -
                        Math.round((t - m.startTick) / beatTicks),
                    ) < 0.001
                  ? 1
                  : 2;
            if (type !== kind) continue;
            const y = baseline - (t - tick) * pixels;
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
          }
        }
        ctx.stroke();
      }
      ctx.fillStyle = "#aab8cc";
      ctx.font = "11px sans-serif";
      for (let mi = index; mi < measures.length; mi++) {
        const m = measures[mi];
        if (m.startTick > tick + span) break;
        if (m.startTick < tick) continue;
        ctx.fillText(
          `第 ${m.number} 小节${m.displayNumber != null && m.displayNumber !== m.number ? ` · 谱面 ${m.displayNumber}` : ""}${m.partial ? " · 不完整" : ""}  ${m.numerator}/${m.denominator}${m.explicit ? "" : "*"}`,
          8,
          baseline - (m.startTick - tick) * pixels - 6,
        );
      }
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      if (song) {
        timeline.visit(tick, tick + span, (note) => {
          if (!keyLayout.has(note.pitch)) return;
          if (note.start + note.duration < position) return;
          if (position >= note.start && position < note.start + note.duration) {
            const action = actions.keyLabel(note, position, state.speed);
            if (action) keyActions.push({ note, action });
          }
          const { x, w } = geometry(note.pitch, width),
            y = baseline - (note.tick - tick) * pixels,
            h = Math.max(8, (note.endTick - note.tick) * pixels);
          const required =
            state.required.includes(note.pitch) &&
            Math.abs(note.start - state.position) < 0.02;
          if (selectable) hitNotes.current.push({ x, y: y - h, w, h, note });
          const customColor = customTracks.has(note.track);
          const noteColor =
            display.palette === "accessible"
              ? handColor(note.part, display)
              : customColor
                ? (trackColors.get(note.track) ?? palette.right)
                : note.part === "left"
                  ? palette.left
                  : palette.right;
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
            playedNotes.add(note.pitch);
          const fill = required ? "#efd484" : noteColor;
          const inRange=!practiceRange||note.start<practiceRange.end&&note.start+note.duration>practiceRange.start;
          sprites.note(
            ctx,
            x + 2,
            y,
            Math.max(2, w - 4),
            h,
            fill,
            display.effectsEnabled && !reduced && performanceStyle
              ? 10 * strength
              : 0,
            dpr,
            required ? 1 : inRange ? 0.88 : 0.24,
          );
          const action = actions.current(note, position, state.speed);
          const label = noteLabel(
            note.pitch,
            action?.to ?? note.finger,
            display,
          );
          if (label && w > 10 && h > 16) {
            sprites.paintLabel(
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
      ctx.textAlign = "left";
      ctx.fillStyle = palette.right;
      ctx.fillRect(0, baseline - 2, width, 2);
      const wrong = state.score.wrong_notes > previousWrong;
      previousWrong = state.score.wrong_notes;
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
          strikes: [...new Set([...state.pressed, ...playedNotes])]
            .filter((pitch) => keyLayout.has(pitch))
            .map((pitch) => ({
              pitch,
              color:
                wrong && state.pressed.includes(pitch)
                  ? "#ff718b"
                  : (visualNotes.get(pitch) ?? palette.right),
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
      keyboard.paint(ctx, {
        width,
        height,
        dpr,
        keyboardHeight,
        pressed: state.pressed,
        required: state.required,
        played: playedNotes,
        colors: visualNotes,
      });
      if (song && ["auto", "finger", "both"].includes(display.noteLabels)) {
        for (const { note: n, action: a } of keyActions) {
          const { x, w } = geometry(n.pitch, width);
          const completed = position >= a.at;
          ctx.font = `bold ${Math.min(13, w - 4)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.fillStyle = sharp(n.pitch) ? "#f2d694" : "#294432";
          ctx.fillText(
            completed ? String(a.to) : `${a.from}→${a.to}`,
            x + w / 2,
            baseline + 22,
          );
        }
      }
      ctx.textAlign = "left";
      element.dataset.effectParticles = String(effects.particleCount);
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
      resize.disconnect();
      window.removeEventListener("resize", resized);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      motion.removeEventListener("change", motionChanged);
      requestPaint.current = () => {};
    };
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
  }, [onNote, keyboardRange.low, keyboardRange.high]);
  const viewportActions = useRef({ keyboardRange, onViewportChange, canInteract });
  viewportActions.current = { keyboardRange, onViewportChange, canInteract };
  useEffect(() => {
    const element = canvas.current!;
    let accumulated = 0;
    let gesture = "";
    const wheel = (event: WheelEvent) => {
      const { keyboardRange: range, onViewportChange: change, canInteract: allowed } = viewportActions.current;
      if ((!event.ctrlKey && !event.shiftKey) || !change || allowed?.() === false) return;
      event.preventDefault(); event.stopPropagation();
      const kind = event.ctrlKey ? "zoom" : "pan";
      if (kind !== gesture) accumulated = 0;
      gesture = kind;
      const delta = (event.deltaY || event.deltaX) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      accumulated += delta;
      if (Math.abs(accumulated) < 35) return;
      const steps = Math.max(-4, Math.min(4, Math.trunc(accumulated / 35)));
      accumulated = 0;
      const bounds = element.getBoundingClientRect();
      let next = range;
      if (kind === "zoom") for (let i = 0; i < Math.abs(steps); i++) next = zoomKeyboardRange(next, -Math.sign(steps), (event.clientX - bounds.left) / Math.max(1, bounds.width));
      else next = panKeyboardRange(range, steps);
      change(next);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  return (
    <canvas
      ref={canvas}
      data-key-low={keyboardRange.low}
      data-key-high={keyboardRange.high}
      tabIndex={0}
      aria-label="按小节排列的音符与可演奏键盘"
      onPointerDown={(e) => {
        if (
          canInteract?.() === false ||
          (e.pointerType === "mouse" && e.button !== 0)
        )
          return;
        e.currentTarget.focus({ preventScroll: true });
        const bounds = e.currentTarget.getBoundingClientRect(),
          x =
            ((e.clientX - bounds.left) * e.currentTarget.clientWidth) /
            Math.max(1, bounds.width),
          y =
            ((e.clientY - bounds.top) * e.currentTarget.clientHeight) /
            Math.max(1, bounds.height);
        const keyboardHeight = Math.min(
          display.keyboardHeight,
          e.currentTarget.clientHeight * 0.45,
        );
        if (y < e.currentTarget.clientHeight - keyboardHeight) {
          if (hitSource.current !== song) return;
          const hit = [...hitNotes.current]
            .reverse()
            .find(
              (n) => x >= n.x && x < n.x + n.w && y >= n.y && y < n.y + n.h,
            );
          if (hit) onSelect?.(hit.note);
          return;
        }
        release(e.pointerId);
        const candidates =
          y < e.currentTarget.clientHeight - keyboardHeight * 0.38
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
      onPointerUp={(e) => release(e.pointerId)}
      onPointerCancel={(e) => release(e.pointerId)}
      onLostPointerCapture={(e) => release(e.pointerId)}
    />
  );
}
