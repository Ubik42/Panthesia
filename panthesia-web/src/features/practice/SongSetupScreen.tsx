import { ChevronLeft,Hand,Play,Settings2 } from "lucide-react";
import { useState } from "react";
import type { LoadedSong } from "../../api";
import { ToolbarMore } from "../../app/ToolbarMore";
import { reportDiagnostic } from "../../app/diagnostics";
import type { PlaybackStore } from "./playbackStore";
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
  start: (mode: "listen" | "wait", hands: string) => Promise<boolean>;
}) {
  const [choice,setChoice]=useState(()=>({mode:(store.getSnapshot().mode==="listen"?"listen":"wait") as "listen"|"wait",hand:store.getSnapshot().hands}));
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const launch = async (mode: "listen" | "wait", hand: string) => {
    if (pending || disabled) return;
    setPending(true);
    try {
      if(!(await start(mode, hand)))setError("曲目暂时未能开始，请稍后重试。");
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
        <button className="synthesia-back" data-workspace-close onClick={back}>
          <ChevronLeft />
          歌曲
        </button>
        <h1>{song.title}</h1>
        <ToolbarMore label="更多" icon={<Settings2 size={23}/>} disabled={disabled||pending}><button onClick={sound}>键盘与音源…</button><button onClick={scores}>谱面…</button><button onClick={settings}>转调、量化与练习设置…</button><button onClick={menu}>其他操作…</button></ToolbarMore>
      </header>
      <div className="synthesia-setup-body">
        <section className="synthesia-listen-options">
          <button
            className="synthesia-listen-card"
            disabled={disabled || pending}
            aria-pressed={choice.mode==="listen"}
            onClick={() => setChoice({mode:"listen",hand:"both"})}
          >
            <Play size={38} />
            <strong>观看与连续播放</strong>
            <span>跟随音乐，自由演奏</span>
          </button>
          <button className="synthesia-parts-card" onClick={hands}>
            <Hand size={34} />
            <strong>手别、颜色与乐器</strong>
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
                aria-pressed={choice.mode==="wait"&&choice.hand===value}
                className={`synthesia-hand-card ${value}`}
                onClick={() => setChoice({mode:"wait",hand:value})}
              >
                <Hand size={40} />
                <strong>{label}</strong>
              </button>
            ))}
          </div>
        </section>
      </div>
      <footer className="product-setup-start"><button disabled={disabled||pending} onClick={()=>void launch(choice.mode,choice.hand)}>{pending?"正在准备…":choice.mode==="listen"?"开始连续播放":`开始${choice.hand==="left"?"左手":choice.hand==="right"?"右手":"双手"}练习`}<Play size={24}/></button></footer>
      {error && (
        <p className="synthesia-setup-error" role="status">
          {error}
        </p>
      )}

    </main>
  );
}
