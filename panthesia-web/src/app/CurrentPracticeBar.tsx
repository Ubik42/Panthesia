import { ArrowRight, History, Library, Music2 } from "lucide-react";
import { clock, type LoadedSong } from "../api";
import type { ControlSnapshot } from "../features/practice/playbackStore";
import type { BrowseWorkspace } from "./useWorkspaceNavigation";
import "./currentPracticeBar.css";
import {
  activeMeasures,
  handLabel,
  practiceMode,
} from "../features/practice/practicePresentation";

export function CurrentPracticeBar({
  workspace,
  song,
  state,
  sourceReady,
  unavailable,
  sourceUnavailable,
  resume,
  locate,
  review,
  choose,
}: {
  workspace: BrowseWorkspace;
  song: LoadedSong | null;
  state: ControlSnapshot;
  sourceReady: boolean;
  unavailable: string | null;
  sourceUnavailable: string | null;
  resume: () => void;
  locate: () => void;
  review: () => void;
  choose: () => void;
}) {
  const mode = practiceMode(state.mode)?.label ?? "练习";
  const hands = handLabel(state.hands.toLowerCase());
  const measures = activeMeasures(song, state.passage);
  const range = state.passage
    ? measures
      ? `选段 ${measures.first}–${measures.last} 小节`
      : `选段 ${clock(state.passage.start)}–${clock(state.passage.end)}`
    : "全曲";
  const details = song
    ? [mode, hands, `${Math.round(state.speed * 100)}%`, range]
        .filter(Boolean)
        .join(" · ")
    : "选好曲目后，可以在这里返回练习。";
  return (
    <aside className="current-practice-bar" aria-label="当前练习">
      <span className="current-practice-symbol">
        <Music2 size={20} aria-hidden="true" />
      </span>
      <div className="current-practice-summary">
        <span>
          {sourceReady
            ? "当前练习 · 位置与设置已保留"
            : song
              ? "上次读取的练习"
              : "当前练习"}
        </span>
        <strong title={song?.title}>
          {song?.title || "选择一首曲目开始练习"}
        </strong>
        <small>{details}</small>
      </div>
      <div className="current-practice-actions">
        {song ? (
          <>
            {workspace === "review" && (
              <button
                disabled={!!sourceUnavailable}
                title={sourceUnavailable ?? undefined}
                onClick={locate}
              >
                <Library size={15} />
                在曲库定位
              </button>
            )}
            {workspace === "library" && (
              <button
                disabled={!!sourceUnavailable}
                title={sourceUnavailable ?? undefined}
                onClick={review}
              >
                <History size={15} />
                本曲练习记录
              </button>
            )}
            <button
              className="primary"
              disabled={!!unavailable}
              title={unavailable ?? undefined}
              onClick={resume}
            >
              返回当前练习
              <ArrowRight size={15} />
            </button>
          </>
        ) : (
          workspace === "review" && (
            <button
              disabled={!!unavailable}
              title={unavailable ?? undefined}
              onClick={choose}
            >
              <Library size={15} />
              去曲库选曲
            </button>
          )
        )}
      </div>
      {(unavailable || sourceUnavailable) && (
        <p className="current-practice-unavailable" role="status">
          {unavailable || sourceUnavailable}
        </p>
      )}
    </aside>
  );
}
