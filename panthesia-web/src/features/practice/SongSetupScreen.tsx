import { useState } from "react";
import { ChevronLeft, Hand, Music2, Play, Settings2 } from "lucide-react";
import type { LoadedSong } from "../../api";
import type { PlaybackStore } from "./playbackStore";
import { usePlaybackFields } from "./PlaybackView";
import { reportDiagnostic } from "../../app/diagnostics";
export function SongSetupScreen({
  song,
  store,
  disabled,
  back,
  menu,
  hands,
  sound,
  scores,
  settings,
  start,
}: {
  song: LoadedSong;
  store: PlaybackStore;
  disabled: boolean;
  back: () => void;
  menu: () => void;
  hands: () => void;
  sound: () => void;
  scores: () => void;
  settings: () => void;
  start: (mode: "listen" | "wait", hands: string) => Promise<void>;
}) {
  const state = usePlaybackFields(store, ["hands"] as const),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const launch = async (mode: "listen" | "wait", hand: string) => {
    if (pending || disabled) return;
    setPending(true);
    try {
      await start(mode, hand);
    } catch (error) {
      reportDiagnostic("开始演奏", error);
      setError("曲目暂时未能开始，详情已记入日志。");
    } finally {
      setPending(false);
    }
  };
  return (
    <main className="synthesia-song-setup">
      <header className="synthesia-library-header">
        <button className="synthesia-back" onClick={back}>
          <ChevronLeft />
          歌曲
        </button>
        <h1>{song.title}</h1>
        <button
          className="synthesia-menu-button"
          aria-label="应用菜单"
          onClick={menu}
        >
          <Settings2 />
          设置
        </button>
      </header>
      <div className="synthesia-setup-body">
        <section className="synthesia-listen-options">
          <button
            className="synthesia-listen-card"
            disabled={disabled || pending}
            onClick={() => void launch("listen", "both")}
          >
            <Play size={38} />
            <strong>观看与连续播放</strong>
            <span>跟随音乐，自由演奏</span>
          </button>
          <button className="synthesia-parts-card" onClick={hands}>
            <Hand size={34} />
            <strong>左右手、声部与音轨</strong>
          </button>
        </section>
        <section className="synthesia-wait-options">
          <h2>跟随练习</h2>
          <p>弹下所需琴键后，音乐继续</p>
          <div className="synthesia-hand-choices">
            {[
              ["left", "左手"],
              ["right", "右手"],
              ["both", "双手"],
            ].map(([value, label]) => (
              <button
                key={value}
                disabled={disabled || pending}
                aria-pressed={state.hands === value}
                className={`synthesia-hand-card ${value}`}
                onClick={() => void launch("wait", value)}
              >
                <Hand size={40} />
                <strong>{label}</strong>
              </button>
            ))}
          </div>
        </section>
      </div>
      {error && (
        <p className="synthesia-setup-error" role="status">
          {error}
        </p>
      )}
      <footer className="synthesia-setup-footer">
        <button onClick={sound}>
          <Music2 size={20} />
          键盘与音源
        </button>
        <button onClick={scores}>谱面管理</button>
        <button onClick={settings}>
          <Settings2 size={20} />
          版本、转调与练习设置
        </button>
      </footer>
    </main>
  );
}
