import { memo } from "react";
import { pitchName } from "../../api";
import { paperAnnotationBox } from "./PaperAnnotations";
import type { NoteAnchor, PageAnchor } from "../../engine/commands.generated";

export const PaperMeasureRegions = memo(function PaperMeasureRegions({
  anchors,
  rotation,
  activeMeasure,
  disabled,
  measures,
  locate,
}: {
  anchors: PageAnchor[];
  rotation: number;
  activeMeasure?: number;
  disabled: boolean;
  measures: number;
  locate: (anchor: PageAnchor) => void;
}) {
  return anchors.map((anchor) => {
    const region = paperAnnotationBox(anchor.region!, rotation);
    return (
      <button
        key={`anchor-${anchor.measure}`}
        type="button"
        className={`paper-measure-region ${anchor.measure === activeMeasure ? "active" : ""}`}
        style={{
          left: `${region.x * 100}%`,
          top: `${region.y * 100}%`,
          width: `${region.width * 100}%`,
          height: `${region.height * 100}%`,
        }}
        aria-label={`谱页第 ${anchor.measure} 小节位置`}
        title={`定位第 ${anchor.measure} 小节`}
        disabled={disabled || anchor.measure > measures}
        onClick={(event) => {
          event.stopPropagation();
          locate(anchor);
        }}
      >
        <span>{anchor.measure}</span>
      </button>
    );
  });
});
export const PaperNoteRegions = memo(function PaperNoteRegions({
  anchors,
  rotation,
  disabled,
  select,
}: {
  anchors: NoteAnchor[];
  rotation: number;
  disabled: boolean;
  select: (anchor: NoteAnchor) => void;
}) {
  return anchors.map((anchor) => {
    const region = paperAnnotationBox(anchor.region, rotation);
    return (
      <button
        key={`note-${anchor.track}-${anchor.index}`}
        type="button"
        className="paper-note-region"
        style={{
          left: `${region.x * 100}%`,
          top: `${region.y * 100}%`,
          width: `${region.width * 100}%`,
          height: `${region.height * 100}%`,
        }}
        aria-label={`${pitchName(anchor.pitch)} 在第 ${anchor.measure} 小节的纸谱位置`}
        title={`${pitchName(anchor.pitch)} · 第 ${anchor.measure} 小节 · 音轨 ${anchor.track}`}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          select(anchor);
        }}
      >
        <span>{pitchName(anchor.pitch)}</span>
      </button>
    );
  });
});
