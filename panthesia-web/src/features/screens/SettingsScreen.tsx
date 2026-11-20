import { useState } from "react";
import { ScreenHeader } from "./ScreenHeader";
const sections = ["音乐设备", "歌曲目录", "外观与操作", "其他"] as const;
export function SettingsScreen({
  back,
  devices,
  duet,
  folders,
  display,
  logs,
  about,
  disabled,
}: {
  back: () => void;
  devices: () => void;
  duet: () => void;
  folders: () => void;
  display: () => void;
  logs: () => void;
  about: () => void;
  disabled: boolean;
}) {
  const [section, setSection] = useState<(typeof sections)[number]>("音乐设备");
  return (
    <main className="product-settings product-page">
      <ScreenHeader title="设置" back={back} backLabel="主页" />
      <div className="product-settings-body">
        <nav aria-label="设置分类">
          {sections.map((s) => (
            <button
              key={s}
              aria-current={s === section ? "page" : undefined}
              onClick={() => setSection(s)}
            >
              {s}
            </button>
          ))}
        </nav>
        <section aria-label={section}>
          {section === "音乐设备" && (
            <>
              <h2>音乐设备</h2>
              <button disabled={disabled} onClick={devices}>
                输入键盘与音源<span>选择 MIDI 键盘、扬声器及钢琴音源</span>
              </button>
            </>
          )}
          {section === "歌曲目录" && (
            <>
              <h2>歌曲目录</h2>
              <button disabled={disabled} onClick={folders}>
                歌曲文件夹<span>查看已登记目录，添加或移除扫描位置</span>
              </button>
            </>
          )}
          {section === "外观与操作" && (
            <>
              <h2>外观与操作</h2>
              <button onClick={display}>
                显示与快捷键<span>琴键、音符、网格、特效与界面</span>
              </button>
            </>
          )}
          {section === "其他" && (
            <>
              <h2>其他</h2>
              <button disabled={disabled} onClick={duet}>
                后台制谱设置<span>DuET 运行环境与模型</span>
              </button>
              <button onClick={logs}>打开日志文件夹</button>
              <button onClick={about}>关于 Panthesia</button>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
