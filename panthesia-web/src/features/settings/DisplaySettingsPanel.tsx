import { LabelSettings } from "../screens/LabelSettings";
import { PreviewBarsControl } from "../practice/PreviewBarsControl";
import { KeyboardRangeSettings } from "./KeyboardRangeSettings";
import { InterfaceDisplayPreview } from "./InterfaceDisplayPreview";
import { PianoEffectsSettings } from "./PianoEffectsSettings";
import { PianoAppearancePreview } from "./PianoAppearancePreview";
import { PersistentSessionRecovery } from "../../app/PersistentSessionRecovery";
import { getInterfaceWorkbench } from "./interfaceWorkbenchStore";
import { InterfaceStorageNotice } from "./InterfaceStorageNotice";
import "./interfaceSettings.css";
import { InterfaceBackupSettings } from "./InterfaceBackupSettings";
import { ShortcutSettings } from "./ShortcutSettings";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isComposingKey, ownsInputLayer } from "../../app/inputOwnership";
import { pitchName } from "../../api";
import {
  asdfCodes,
  zxcvCodes,
  allowedCode,
  codeLabel,
  displayDefaults,
  type DisplayPreferences,
} from "./displayPreferences";
/** Interface settings shown on the settings page, one section at a time: note display,
 * stage appearance, computer keyboard, shortcuts, backup. */
export type DisplaySettingsSection = "notes" | "appearance" | "keyboard" | "shortcuts" | "backup";
export function DisplaySettingsPanel({
  value,
  input = null,
  section,
  change,
}: {
  value: DisplayPreferences;
  input?: string | null;
  section: DisplaySettingsSection;
  change: (value: DisplayPreferences) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const workbench = getInterfaceWorkbench();
  const draft = useSyncExternalStore(
    workbench.subscribe,
    workbench.getSnapshot,
  );
  const [capture, setCapture] = useState<number | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (section !== "keyboard") setCapture(null);
  }, [section]);
  const update = (patch: Partial<DisplayPreferences>) => {
    if (
      patch.keyCodes &&
      Object.values(value.shortcuts).some(
        (chord) => chord && patch.keyCodes!.includes(chord),
      )
    ) {
      setError("这些弹奏键与操作快捷键重复，请先修改对应操作快捷键。");
      return;
    }
    change({ ...value, ...patch });
    setError("");
  };
  useEffect(() => {
    if (capture === null || section !== "keyboard") return;
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isComposingKey(event) || !ownsInputLayer(root.current)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setCapture(null);
        return;
      }
      if (capture === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (
        event.repeat ||
        event.isComposing ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        !allowedCode(event.code)
      ) {
        setError("请按一个字母、数字或逗号/句号/分号键。");
        return;
      }
      if (
        value.keyCodes.some(
          (code, index) => index !== capture && code === event.code,
        )
      ) {
        setError("这个键已经分配给另一个音，请选择未使用的键。");
        return;
      }
      if (Object.values(value.shortcuts).includes(event.code)) {
        setError("这个键已用于操作快捷键，请先修改或清除对应快捷键。");
        return;
      }
      const keyCodes = [...value.keyCodes];
      keyCodes[capture] = event.code;
      update({ keyCodes });
      setCapture(null);
      setError("");
    };
    window.addEventListener("keydown", key, true);
    const cancel = () => setCapture(null);
    const hide = () => { if (document.hidden) cancel(); };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [value, capture, section]);
  const content: Record<DisplaySettingsSection, React.ReactNode> = {
    notes: (
      <>
        <InterfaceDisplayPreview value={value} />
        <section aria-labelledby="notes-labels">
          <h3 id="notes-labels">标签</h3>
          <LabelSettings value={value} change={update} />
          <p className="parameter-help">首调唱名与音阶级数跟随当前练习调性；指法显示已保存的标记。</p>
        </section>
        <section aria-labelledby="notes-colors">
          <h3 id="notes-colors">配色与预览</h3>
          <label>
            <span>声部配色</span>
            <select
              aria-label="键盘声部配色"
              value={value.palette}
              onChange={(event) => update({ palette: event.target.value as DisplayPreferences["palette"] })}
            >
              <option value="standard">曲目颜色</option>
              <option value="accessible">左右手蓝橙配色</option>
              <option value="pitch">按音高（12 色）</option>
            </select>
          </label>
          <PreviewBarsControl value={value.previewBars} change={previewBars=>update({previewBars})} label="前方预览" ariaLabel="键盘音符预览小节数"/>
        </section>
        <KeyboardRangeSettings value={value} change={update} input={input} />
      </>
    ),
    appearance: <div className="appearance-workspace"><PianoAppearancePreview value={value} /><PianoEffectsSettings value={value} change={update} /></div>,
    keyboard: (
<section className="computer-key-settings">
                    <h3>电脑键盘映射</h3>
                    <p className="parameter-help">
                      可用 13
                      个电脑按键弹奏一个八度。点击下方按键，直接按新键完成修改。
                    </p>
                    <label className="keyboard-enabled">
                      <input
                        type="checkbox"
                        checked={value.keyboardEnabled}
                        onChange={(event) =>
                          update({ keyboardEnabled: event.target.checked })
                        }
                      />
                      启用电脑键盘演奏
                    </label>
                    <div className="dialog-actions">
                      <label>
                        起始音区
                        <select
                          aria-label="电脑键盘起始音区"
                          value={value.keyboardOctave}
                          onChange={(event) =>
                            update({
                              keyboardOctave: Number(event.target.value),
                            })
                          }
                        >
                          {[2, 3, 4, 5, 6].map((octave) => (
                            <option value={octave} key={octave}>
                              C{octave}–C{octave + 1}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        onClick={() => {
                          update({ keyCodes: [...asdfCodes] });
                          setCapture(null);
                        }}
                      >
                        A S D 行
                      </button>
                      <button
                        onClick={() => {
                          update({ keyCodes: [...zxcvCodes] });
                          setCapture(null);
                        }}
                      >
                        Z X C 行
                      </button>
                    </div>
                    <div className="computer-key-grid">
                      {value.keyCodes.map((code, index) => (
                        <button
                          key={index}
                          data-accidental={[1, 3, 6, 8, 10].includes(index)}
                          aria-label={`修改 ${pitchName(12 * (value.keyboardOctave + 1) + index)} 的电脑按键`}
                          aria-pressed={capture === index}
                          onClick={() => {
                            setCapture(index);
                            setError("");
                          }}
                        >
                          <strong>{codeLabel(code)}</strong>
                          <small>
                            {pitchName(12 * (value.keyboardOctave + 1) + index)}
                          </small>
                        </button>
                      ))}
                    </div>
                    <p role="status">
                      {capture !== null
                        ? `请按要分配给 ${pitchName(12 * (value.keyboardOctave + 1) + capture)} 的键；Esc 取消。`
                        : "点击一个按键修改。使用键盘物理位置，支持同时按多个键；输入框、对话框内和组合快捷键不会演奏。"}
                    </p>
                    {error && (
                      <p role="alert" className="dialog-error">
                        {error}
                      </p>
                    )}
                    <button
                      onClick={() => {
                        update({
                          keyboardEnabled: displayDefaults.keyboardEnabled,
                          keyboardOctave: displayDefaults.keyboardOctave,
                          keyCodes: [...asdfCodes],
                        });
                        setCapture(null);
                      }}
                    >
                      恢复电脑键盘默认值
                    </button>
                  </section>
    ),
    shortcuts: (
      <ShortcutSettings
        value={value}
        change={change}
        active={section === "shortcuts"}
        pianoCapture={capture}
        clearPiano={() => setCapture(null)}
      />
    ),
    backup: (
      <>
        <InterfaceStorageNotice />
        <PersistentSessionRecovery
          store={workbench}
          error={draft.storageError}
          busy={draft.busy}
          label="设置窗口输入"
        />
        <InterfaceBackupSettings />
      </>
    ),
  };
  return (
    <div className="display-settings-panel" ref={root} data-keyboard-capturing={capture !== null}>
      {content[section]}
      {section === "notes" && (
        <div className="settings-reset">
          <button
            onClick={() => {
              change({
                ...value,
                notation: displayDefaults.notation,
                noteLabels: displayDefaults.noteLabels,
                keyLabels: displayDefaults.keyLabels,
                keyLabelMode: displayDefaults.keyLabelMode, noteLabelMode: displayDefaults.noteLabelMode,
                keyLabelsOwnOnly: false, noteLabelsOwnOnly: false,
                tonic: displayDefaults.tonic,
                octave: displayDefaults.octave,
                fontSize: displayDefaults.fontSize,
                palette: displayDefaults.palette,
                range: displayDefaults.range,
                keyboardViewport: null, keyboardLow: displayDefaults.keyboardLow, keyboardHigh: displayDefaults.keyboardHigh,
                previewBars: displayDefaults.previewBars,
              });
              setError("");
            }}
          >
            恢复音符显示默认值
          </button>
        </div>
      )}
      {section === "appearance" && <div className="settings-reset"><button type="button" onClick={()=>update({
        pianoMaterial:displayDefaults.pianoMaterial,effectStyle:displayDefaults.effectStyle,
        virtualHands:displayDefaults.virtualHands,virtualHandOpacity:displayDefaults.virtualHandOpacity,
        effectsEnabled:displayDefaults.effectsEnabled,effectsPreset:displayDefaults.effectsPreset,
        effectsPalette:displayDefaults.effectsPalette,effectsIntensity:displayDefaults.effectsIntensity,reduceMotion:displayDefaults.reduceMotion,
        gridSubdivision:displayDefaults.gridSubdivision,barOpacity:displayDefaults.barOpacity,beatOpacity:displayDefaults.beatOpacity,subdivisionOpacity:displayDefaults.subdivisionOpacity,
      })}>恢复外观默认值</button></div>}
    </div>
  );
}
