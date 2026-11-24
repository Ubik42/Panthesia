import { applyStageInk, stageInk } from "../practice/stageTheme";
import { productLabel } from "./displayPreferences";
import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import type { DisplayPreferences } from "./displayPreferences";
import { PianoKeyboard } from "../practice/pianoKeyboard";
import { PianoEffects, effectPalettes } from "../practice/pianoEffects";
import "./pianoAppearance.css";

const whites = [60, 62, 64, 65, 67, 69, 71, 72];
const blacks = [61, 63, 66, 68, 70];
const sequence = [60, 64, 67, 72, 67, 64, 60];
const whiteIndex = (pitch: number) => whites.filter(p => p < pitch).length;
const geometry = (pitch: number, width: number) => {
  const white = whites.indexOf(pitch), unit = width / whites.length;
  return white >= 0 ? { x: white * unit, w: unit } : { x: whiteIndex(pitch) * unit - unit * .3, w: unit * .6 };
};

/** Preview uses the same materials and strike renderer as the practice keyboard. */
export function PianoAppearancePreview({ value }: { value: DisplayPreferences }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const effectsCanvas=useRef<HTMLCanvasElement>(null);
  const [demo, setDemo] = useState(0);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const palette = effectPalettes[value.effectsPalette];
    const keyboard = new PianoKeyboard(value, whites, blacks, geometry, palette.right);
    const effects = new PianoEffects(effectsCanvas.current!);
    const reduced = value.reduceMotion || matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let frame = 0, stopped = false;
    setRunning(demo > 0);
    const paint = (now: number) => {
      const width = el.clientWidth, height = el.clientHeight, ratio = Math.min(2, devicePixelRatio || 1);
      if (!width || !height) return;
      if (el.width !== Math.ceil(width * ratio) || el.height !== Math.ceil(height * ratio)) {
        el.width = Math.ceil(width * ratio); el.height = Math.ceil(height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      // The chosen stage background, with grid ink that reads on it (as on the stage).
      const background = value.stageColor;
      applyStageInk(background);
      ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
      const baseline = height - 78;
      for (let index = 0; index < value.gridSubdivision; index++) {
        const beat = index % (value.gridSubdivision / 4) === 0;
        ctx.globalAlpha = (index === 0 ? value.barOpacity : beat ? value.beatOpacity : value.subdivisionOpacity) / 100;
        ctx.strokeStyle = stageInk.grid; ctx.lineWidth = index === 0 ? 1.5 : .7;
        ctx.setLineDash(beat ? [] : [3, 5]);
        const y = index * (baseline - 10) / value.gridSubdivision;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      const elapsed = now - start, step = Math.floor(elapsed / 420);
      const pitch = demo > 0 && step < sequence.length && elapsed % 420 < 260 ? sequence[step] : null;
      const pressed = pitch === null ? [] : [pitch];
      const colors = new Map(pressed.map(p => [p, p < 64 ? palette.left : palette.right]));
      for (const [index, p] of [60, 64, 67].entries()) {
        const key = geometry(p, width), y = baseline - 35 - index * 28;
        ctx.fillStyle = p < 64 ? palette.left : palette.right;
        ctx.globalAlpha = .85;
        ctx.beginPath(); ctx.roundRect(key.x + 3, y - 30, key.w - 6, 40, 4); ctx.fill();
      }
      ctx.globalAlpha = 1;
      effects.update({ now, position: elapsed / 1000, status: "playing", source: "preview", strikes: value.effectsEnabled ? pressed.map(p => ({ pitch: p, color: colors.get(p)! })) : [], performance: value.effectsPreset === "performance", strength: value.effectsIntensity / 100, reduced });
      if (value.effectsEnabled) effects.paint(ctx, now, baseline, width, p => geometry(p, width), value.effectsPreset === "performance", value.effectsIntensity / 100, reduced, value.effectStyle, ratio);
      keyboard.paint(ctx, { width, height, dpr: ratio, keyboardHeight: 78, pressed, required: [], played: new Set(), colors, labels:new Map([...whites,...blacks].map(p=>[p,productLabel(p,"key",value,{own:true})])) });
      if (demo && elapsed < 4400 && !stopped && !document.hidden) frame = requestAnimationFrame(paint);
      else setRunning(false);
    };
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); paint(performance.now()); });
    observer.observe(el);
    const hide = () => { if (document.hidden) { stopped = true; cancelAnimationFrame(frame); setRunning(false); } };
    document.addEventListener("visibilitychange", hide);
    paint(start);
    return () => { stopped = true; cancelAnimationFrame(frame); effects.dispose(); observer.disconnect(); document.removeEventListener("visibilitychange", hide); };
  }, [value, demo]);
  return <figure className="piano-appearance-preview">
    <figcaption>
      <button type="button" onClick={() => setDemo(n => n + 1)}><Play size={13} />{running ? "重新演示" : "演示落键"}</button>
    </figcaption>
    <div className="piano-preview-surface"><canvas ref={canvas} aria-label="钢琴外观与落键光效预览" role="img" /><canvas ref={effectsCanvas} className="piano-gpu-effects" aria-hidden="true" /></div>
  </figure>;
}
