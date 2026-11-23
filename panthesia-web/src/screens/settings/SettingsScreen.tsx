import { ArrowLeft, Info, Keyboard, KeyRound, LayoutGrid, Music4, Palette, Save, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useApp } from "../../app/AppContext";
import { api } from "../../api";
import { product } from "../../product.generated";
import type { SettingsSection } from "../../features/screens/useProductScreens";
import { DeviceSettingsPanel } from "../../features/devices/DeviceSettingsPanel";
import { DisplaySettingsPanel } from "../../features/settings/DisplaySettingsPanel";
import { DuetRuntimePanel } from "../../features/settings/DuetRuntimePanel";
import { TranscriptionToolSettings } from "./TranscriptionToolSettings";
import { InterfaceSaveStatus } from "../../features/settings/InterfaceStorageNotice";
import { getInterfaceWorkbench } from "../../features/settings/interfaceWorkbenchStore";
import { useSyncExternalStore } from "react";
import "../../ui/controls.css";
import "../../ui/forms.css";
import "./settingsScreen.css";

const SECTIONS: { id: SettingsSection; label: string; hint: string; icon: LucideIcon }[] = [
  { id: "devices", label: "声音与设备", hint: "MIDI 键盘、音源、发声设备与试音", icon: Music4 },
  { id: "appearance", label: "舞台外观", hint: "琴键材质、光效、网格与虚拟双手", icon: Palette },
  { id: "notes", label: "音符与琴键", hint: "标签、配色、音域与预览范围", icon: LayoutGrid },
  { id: "keyboard", label: "电脑键盘", hint: "用电脑键盘弹奏的按键映射", icon: Keyboard },
  { id: "shortcuts", label: "快捷键", hint: "播放、跳转与窗口操作", icon: KeyRound },
  { id: "tools", label: "外部工具", hint: "转录与分离工具、DuET 制谱", icon: Wrench },
  { id: "backup", label: "备份与恢复", hint: "导出、导入界面设置", icon: Save },
  { id: "about", label: "关于", hint: "版本、日志与许可", icon: Info },
];

/** The settings page (interface-design.md §6): every global setting, one section at a time. */
export function SettingsScreen() {
  const app = useApp();
  const { productScreens, display, setDisplay, state, playback, progressEngineId, busy, connected, startupReady, run, refreshSession, setError, setAboutOpen } = app;
  const workbench = getInterfaceWorkbench();
  const workbenchError = useSyncExternalStore(workbench.subscribe, workbench.getSnapshot).storageError;
  const section = productScreens.settingsSection;
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  const unavailable = !connected
    ? "练习室连接中断，当前显示上次读取的设备设置。重新连接后可更改。"
    : !startupReady
      ? "启动恢复尚未完成，当前可以查看设备与原选择。"
      : undefined;
  return (
    <main className="settings-screen ui-screen" aria-label="设置">
      <aside className="settings-nav">
        <button className="ui-button ui-button--ghost settings-back" onClick={productScreens.leaveSettings}>
          <ArrowLeft />
          返回
        </button>
        <h1>设置</h1>
        <nav aria-label="设置分区">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button key={id} className="settings-nav-item" aria-current={id === section ? "page" : undefined} onClick={() => productScreens.setSettingsSection(id)}>
              <Icon aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
      </aside>
      <section className="settings-content" aria-labelledby="settings-title">
        <header className="settings-heading">
          <div>
            <h2 id="settings-title">{current.label}</h2>
            <p>{current.hint}</p>
          </div>
          {["appearance", "notes", "keyboard", "shortcuts", "backup"].includes(section) && (
            <InterfaceSaveStatus openRecovery={() => productScreens.setSettingsSection("backup")} draftError={workbenchError} />
          )}
        </header>
        <div className="settings-body ui-form">
          {section === "devices" && (
            <>
              <DeviceSettingsPanel
                selectedDevice={app.settingsDevice}
                store={playback}
                state={state}
                engineId={progressEngineId}
                unavailable={unavailable}
                busy={busy}
                error={app.health.getMessages().action}
                command={run}
                synchronize={refreshSession}
                reportError={setError}
              />
            </>
          )}
          {(section === "appearance" || section === "notes" || section === "keyboard" || section === "shortcuts" || section === "backup") && (
            <DisplaySettingsPanel section={section} input={state.input} value={display} change={setDisplay} />
          )}
          {section === "tools" && (
            <>
              <TranscriptionToolSettings disabled={!connected} />
              <section aria-labelledby="tools-duet">
                <h3 id="tools-duet">DuET 制谱</h3>
                <DuetRuntimePanel disabled={!!unavailable} />
              </section>
            </>
          )}
          {section === "about" && (
            <div className="settings-about">
              <p>
                <strong>{product.name}</strong> {product.version}
              </p>
              <div className="settings-row-actions">
                <button className="ui-button" onClick={() => void api.openLogs().catch((e) => setError(String(e)))}>
                  打开日志文件夹
                </button>
                <button className="ui-button" onClick={() => setAboutOpen(true)}>
                  版本、来源与许可…
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
