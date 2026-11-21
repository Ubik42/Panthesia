import { memo,useMemo,useEffect,useRef,useState } from "react";
import { clock,type LoadedSong } from "../../api";
import { usePlaybackFields } from "./PlaybackView";
import { rangeTime } from "./PracticeRangeControls";
import type { PlaybackStore } from "./playbackStore";
import { usePlaybackSlider } from "./usePlaybackSlider";
import type { PracticeRangeController } from "./usePracticeRange";
const fields = [
  "practiceMs",
  "beat",
  "position",
  "measure",
  "passage",
  "contentId",
  "scoreRevision",
] as const;
const TimelineMarks = memo(function TimelineMarks({
  song,
  start,
  end,
}: {
  song: LoadedSong | null;
  start: number;
  end: number;
}) {
  const root=useRef<SVGSVGElement>(null),[width,setWidth]=useState(1000);
  useEffect(()=>{
    const element=root.current;if(!element)return;
    const resize=()=>{const width=element.getBoundingClientRect().width;if(width>0)setWidth(width);};
    const observer=new ResizeObserver(resize);observer.observe(element);resize();
    return ()=>observer.disconnect();
  },[]);
  const marks = useMemo(() => {
    const rows = (song?.measures ?? []).filter(
      (m) => m.start >= start && m.start <= end,
    );
    const every = Math.max(1, Math.ceil(rows.length / 80));
    let labelEnd=-Infinity;
    return rows.filter((_, i) => i % every === 0).map(m=>{
      const x=((m.start-start)/Math.max(0.01,end-start))*width;
      const text=String(m.displayNumber??m.number),textWidth=Math.max(14,text.length*7);
      const label=m.number%4===1&&x+3>=labelEnd+10&&x+3+textWidth<=width;
      if(label)labelEnd=x+3+textWidth;
      return {measure:m,x,label,text};
    });
  }, [song?.measures, start, end,width]);
  return (
    <svg ref={root} viewBox={`0 0 ${width} 20`} preserveAspectRatio="none" aria-hidden="true">
      {marks.map(({measure:m,x,label,text}) => {
        return (
          <g key={m.number}>
            <line x1={x} x2={x} y1={0} y2={m.number % 4 === 1 ? 11 : 5} />
            {label && (
              <text x={x + 3} y={19}>
                {text}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
});
export function PracticeTimeline({
  store,
  song,
  disabled,
  busy,
  seek,
  range,
}: {
  store: PlaybackStore;
  song: LoadedSong | null;
  disabled: boolean;
  busy: boolean;
  seek: (position: number) => Promise<boolean>;
  range: PracticeRangeController;
}) {
  const state = usePlaybackFields(store, fields);
  const start = state.passage?.start ?? 0,
    end = state.passage?.end ?? song?.duration ?? 0;
  const unavailable =
    !song ||
    end <= start ||
    disabled ||
    state.contentId !== song.contentId ||
    state.scoreRevision !== song.scoreRevision;
  const slider = usePlaybackSlider({
    store,
    value: state.position,
    disabled: unavailable || busy,
    commit: (position) =>
      seek(state.passage ? Math.min(position, end - 0.000001) : position),
  });
  const full = song?.duration ?? 1;
  const formatTime = end - start < 10 ? rangeTime : clock;
  return (
    <div className="practice-timeline time-ruler">
      <div className="time-ruler-labels">
        <span>
          第 {state.measure} 小节{" "}
          <small>第 {Math.floor(state.beat ?? 1)} 拍</small>
        </span>
        <strong>
          {formatTime(slider.value)}{" "}
          <small>/ {formatTime(song?.duration ?? 0)}</small>
        </strong>
        <span>{state.passage ? "循环段时间线" : "全曲时间线"}</span>
      </div>
      {(range.range || state.passage) && (
        <div
          className="practice-range-overview"
          aria-label="选段在全曲中的位置"
        >
          {state.passage && (
            <i
              style={{
                left: `${(state.passage.start / full) * 100}%`,
                width: `${((state.passage.end - state.passage.start) / full) * 100}%`,
              }}
            />
          )}
          {range.dirty && range.range && (
            <i
              className="draft"
              style={{
                left: `${(range.range.start / full) * 100}%`,
                width: `${((range.range.end - range.range.start) / full) * 100}%`,
              }}
            />
          )}
          <b
            style={{ left: `${Math.min(100, (state.position / full) * 100)}%` }}
          />
        </div>
      )}
      <div className="time-ruler-track">
        <TimelineMarks song={song} start={start} end={end} />
        <input
          type="range"
          aria-label="曲目时间线"
          aria-valuetext={`${formatTime(slider.value)}，第 ${state.measure} 小节`}
          min={start}
          max={end || 1}
          step={0.01}
          value={Math.max(start, Math.min(end, slider.value))}
          disabled={unavailable || (busy && !slider.pending)}
          onChange={(e) => slider.stage(Number(e.target.value))}
          onPointerDown={slider.begin}
          onPointerUp={slider.apply}
          onPointerCancel={slider.cancel}
          onBlur={slider.apply}
          onKeyDown={(e) => slider.keyDown(e.key, e.repeat)}
          onKeyUp={(e) => slider.keyUp(e.key)}
        />
      </div>
      <div className="time-ruler-seconds">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <span key={f}>{formatTime(start + (end - start) * f)}</span>
        ))}
      </div>

    </div>
  );
}
