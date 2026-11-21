import { MusicDeviceList, type DeviceObject } from "./MusicDeviceList";
import type { Snapshot } from "../../api";
import { useState } from "react";
import { ScreenHeader } from "./ScreenHeader";
const sections = ["音乐设备", "外观与操作", "其他"] as const;
export function SettingsScreen({
  back,
  devices,
  duet,
  display,
  logs,
  about,
  disabled,
  state,
  engineId,
  visible,
}: {
  back: () => void;
  devices: (device?: DeviceObject) => void;
  state: Pick<Snapshot, "input" | "inputConnected" | "output" | "outputId">;
  engineId?: string;
  visible: boolean;
  duet: () => void;
  display: (
    section?: "display" | "appearance" | "keyboard" | "shortcuts" | "backup",
  ) => void;
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
          {section === "音乐设备" && visible && (
            <MusicDeviceList
              state={state}
              engineId={engineId}
              disabled={disabled}
              open={devices}
            />
          )}
          {section === "外观与操作" && (
            <>
              <h2>外观与操作</h2>
              <button onClick={() => display("appearance")}>
                外观<span>琴键材质、网格、配色和特效</span>
              </button>
              <button onClick={() => display("display")}>
                音符与琴键<span>标签、音域和预览范围</span>
              </button>
              <button onClick={() => display("keyboard")}>
                电脑键盘<span>配置电脑键盘的弹奏映射</span>
              </button>
              <button onClick={() => display("shortcuts")}>
                快捷键<span>播放、跳转和窗口操作</span>
              </button>
            </>
          )}
          {section === "其他" && (
            <>
              <h2>其他</h2>
              <button disabled={disabled} onClick={duet}>
                后台制谱设置<span>DuET 运行环境与模型</span>
              </button>
              <button onClick={() => display("backup")}>设置备份</button>
              <button onClick={logs}>打开日志文件夹</button>
              <button onClick={about}>关于 Panthesia</button>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
