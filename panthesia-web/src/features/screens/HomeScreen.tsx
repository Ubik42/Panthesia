import { useState } from "react";
import { product } from "../../product.generated";

export type RecentFile = { path: string; title: string; openedAt: number; exists: boolean };

/** Start page: open a file, reopen a recent one, play freely or change settings. */
export function HomeScreen({
  recent,
  disabled,
  chooseFile,
  open,
  forget,
  freePlay,
  settings,
}: {
  recent: readonly RecentFile[];
  disabled: boolean;
  chooseFile: () => Promise<unknown>;
  open: (path: string) => Promise<boolean>;
  forget: (path: string) => void;
  freePlay: () => void;
  settings: () => void;
}) {
  const [pending, setPending] = useState(false);
  const busy = disabled || pending;
  const guard = async (work: () => Promise<unknown>) => {
    setPending(true);
    try {
      await work();
    } finally {
      setPending(false);
    }
  };
  return (
    <main className="product-home" aria-label="主页">
      <header className="product-home-brand">
        <img src="/brand.svg" alt="" />
        <h1>{product.name}</h1>
      </header>
      <div className="product-home-body">
        <nav className="product-home-actions" aria-label="主菜单">
          <button disabled={busy} onClick={() => void guard(chooseFile)}>
            打开乐曲…
          </button>
          <button disabled={busy} onClick={freePlay}>
            自由演奏
          </button>
          <button className="product-home-settings" disabled={busy} onClick={settings}>
            设置
          </button>
        </nav>
        <section className="product-home-recent">
          <h2>最近打开</h2>
          <div className="product-recent-list">
            {recent.map((file) => (
              <button
                key={file.path}
                disabled={busy || !file.exists}
                title={file.path}
                onClick={() => void guard(() => open(file.path))}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (window.confirm(`从最近打开中移除“${file.title}”？文件本身不受影响。`)) forget(file.path);
                }}
              >
                <span>{file.title}</span>
                {!file.exists && <small className="song-file-status">文件不存在</small>}
              </button>
            ))}
            {!recent.length && <p>打开 MIDI、MusicXML 或 .panthesia 文件开始练习；也可以在资源管理器或 Keel 中双击乐曲。</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
