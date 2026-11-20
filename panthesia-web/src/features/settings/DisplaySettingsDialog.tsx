import { KeyboardRangeSettings } from "./KeyboardRangeSettings";
import { InterfaceDisplayPreview } from "./InterfaceDisplayPreview";
import { PianoEffectsSettings } from "./PianoEffectsSettings";
import { PianoAppearancePreview } from "./PianoAppearancePreview";
import { BrowseDetailWorkspace } from "../../app/BrowseDetailWorkspace";
import { PersistentSessionRecovery } from "../../app/PersistentSessionRecovery";
import {
  getInterfaceWorkbench,
  type SettingsSection,
} from "./interfaceWorkbenchStore";
import {
  InterfaceStorageNotice,
  InterfaceSaveStatus,
} from "./InterfaceStorageNotice";
import "./interfaceSettings.css";
import { InterfaceBackupSettings } from "./InterfaceBackupSettings";
import { ShortcutSettings } from "./ShortcutSettings";
import { LayoutSettings } from "./LayoutSettings";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isComposingKey, ownsInputLayer } from "../../app/inputOwnership";
import { X } from "lucide-react";
import { pitchName } from "../../api";
import {
  asdfCodes,
  zxcvCodes,
  allowedCode,
  codeLabel,
  displayDefaults,
  type DisplayPreferences,
} from "../../displayPreferences";
export function DisplaySettingsDialog({
  value,
  input = null,
  change,
  close,
}: {
  value: DisplayPreferences;
  input?: string | null;
  change: (value: DisplayPreferences) => void;
  close: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const workbench = getInterfaceWorkbench();
  const draft = useSyncExternalStore(
    workbench.subscribe,
    workbench.getSnapshot,
  );
  const section = draft.section;
  const changeSection = (section: SettingsSection) => {
    setCapture(null);
    workbench.update({ section });
  };
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
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        className="settings-dialog display-settings-dialog"
        data-keyboard-capturing={capture !== null}
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby="display-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <BrowseDetailWorkspace<SettingsSection>
          label="界面与按键设置分区"
          value={section}
          change={changeSection}
          header={
            <>
              <div className="dialog-heading">
                <div>
                  <h2 id="display-settings-title">界面与按键</h2>
                  <p>调整显示、练习室布局和按键，管理界面设置备份。</p>
                </div>
                <button
                  autoFocus
                  aria-label="关闭界面与按键设置"
                  onClick={close}
                >
                  <X size={18} />
                </button>
              </div>
              <InterfaceSaveStatus
                openRecovery={() => changeSection("backup")}
                draftError={draft.storageError}
              />
            </>
          }
          sections={[
            {
              id: "display",
              label: "音符显示",
              content: (
                <>
                  <InterfaceDisplayPreview value={value} />
                  <div className="display-settings-fields">
                    <label>
                      音符名称
                      <select
                        aria-label="音符名称格式"
                        value={value.notation}
                        onChange={(event) =>
                          update({
                            notation: event.target
                              .value as DisplayPreferences["notation"],
                          })
                        }
                      >
                        <option value="pitch">音名 · C</option>
                        <option value="solfege">固定唱名 · Do</option>
                        <option value="degree">首调大调级数 · 1</option>
                      </select>
                    </label>
                    <label>
                      音符提示
                      <select
                        aria-label="音符提示内容"
                        value={value.noteLabels}
                        onChange={(event) =>
                          update({
                            noteLabels: event.target
                              .value as DisplayPreferences["noteLabels"],
                          })
                        }
                      >
                        <option value="auto">指法优先，未标指法显示名称</option>
                        <option value="name">仅名称</option>
                        <option value="finger">仅指法</option>
                        <option value="both">指法与名称</option>
                        <option value="none">不显示文字</option>
                      </select>
                    </label>
                    <label>
                      键上名称
                      <select
                        aria-label="键上名称范围"
                        value={value.keyLabels}
                        onChange={(event) =>
                          update({
                            keyLabels: event.target
                              .value as DisplayPreferences["keyLabels"],
                          })
                        }
                      >
                        <option value="c">仅 C 键</option>
                        <option value="white">全部白键</option>
                        <option value="all">全部键</option>
                        <option value="none">不显示</option>
                      </select>
                    </label>
                    <label>
                      级数主音
                      <select
                        aria-label="级数主音"
                        disabled={value.notation !== "degree"}
                        value={value.tonic}
                        onChange={(event) =>
                          update({ tonic: Number(event.target.value) })
                        }
                      >
                        {Array.from({ length: 12 }, (_, index) => (
                          <option value={index} key={index}>
                            {pitchName(60 + index).slice(0, -1)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      提示字号
                      <select
                        aria-label="键盘提示字号"
                        value={value.fontSize}
                        onChange={(event) =>
                          update({ fontSize: Number(event.target.value) })
                        }
                      >
                        {[10, 12, 14, 16].map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      声部配色
                      <select
                        aria-label="键盘声部配色"
                        value={value.palette}
                        onChange={(event) =>
                          update({
                            palette: event.target
                              .value as DisplayPreferences["palette"],
                          })
                        }
                      >
                        <option value="standard">曲目颜色</option>
                        <option value="accessible">左右手蓝橙配色</option>
                      </select>
                    </label>
                    <label>
                      前方预览
                      <select
                        aria-label="键盘音符预览小节数"
                        value={value.previewBars}
                        onChange={(event) =>
                          update({ previewBars: Number(event.target.value) })
                        }
                      >
                        {[2, 4, 8, 12].map((bars) => (
                          <option key={bars} value={bars}>
                            {bars} 小节
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <KeyboardRangeSettings value={value} change={update} input={input} />
                  <div className="display-settings-checks">
                    {[["octave", "显示音区数字"]].map(([key, label]) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked={Boolean(
                            value[key as keyof DisplayPreferences],
                          )}
                          onChange={(event) =>
                            update({ [key]: event.target.checked })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <p className="parameter-help">
                    固定唱名以 C 为 Do；级数按大调排列，以所选主音为
                    1，右下数字表示音区，只改变提示，不移调演奏。窄键上的文字会缩小，放不下时隐藏；指法显示已有标记。
                  </p>
                </>
              ),
            },
            {
              id: "appearance",
              label: "外观与光效",
              content: <div className="appearance-workspace">{section === "appearance" && <PianoAppearancePreview value={value} />}<PianoEffectsSettings value={value} change={update} /></div>,
            },
            {
              id: "layout",
              label: "练习室布局",
              content: <LayoutSettings value={value} change={change} />,
            },
            {
              id: "keyboard",
              label: "电脑键盘",
              content: (
                <>
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
                  </section>{" "}
                </>
              ),
            },
            {
              id: "shortcuts",
              label: "操作快捷键",
              content: (
                <ShortcutSettings
                  value={value}
                  change={change}
                  active={section === "shortcuts"}
                  pianoCapture={capture}
                  clearPiano={() => setCapture(null)}
                />
              ),
            },
            {
              id: "backup",
              label: "备份与恢复",
              count:
                (draft.preview ? 1 : 0) +
                  (draft.preparedExport &&
                  !["saved", "requested"].includes(draft.preparedExport.phase)
                    ? 1
                    : 0) || undefined,
              content: (
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
            },
          ]}
        />
        <div className="dialog-actions interface-settings-footer">
          {section === "display" && (
            <button
              onClick={() => {
                change({
                  ...value,
                  notation: displayDefaults.notation,
                  noteLabels: displayDefaults.noteLabels,
                  keyLabels: displayDefaults.keyLabels,
                  tonic: displayDefaults.tonic,
                  octave: displayDefaults.octave,
                  fontSize: displayDefaults.fontSize,
                  palette: displayDefaults.palette,
                  range: displayDefaults.range,
                  keyboardLow: displayDefaults.keyboardLow, keyboardHigh: displayDefaults.keyboardHigh,
                  previewBars: displayDefaults.previewBars,
                });
                setError("");
              }}
            >
              恢复音符显示默认值
            </button>
          )}
          {section === "appearance" && <button type="button" onClick={()=>update({
            skin:displayDefaults.skin,pianoMaterial:displayDefaults.pianoMaterial,effectStyle:displayDefaults.effectStyle,
            effectsEnabled:displayDefaults.effectsEnabled,effectsPreset:displayDefaults.effectsPreset,
            effectsPalette:displayDefaults.effectsPalette,effectsIntensity:displayDefaults.effectsIntensity,reduceMotion:displayDefaults.reduceMotion,
            gridSubdivision:displayDefaults.gridSubdivision,barOpacity:displayDefaults.barOpacity,beatOpacity:displayDefaults.beatOpacity,subdivisionOpacity:displayDefaults.subdivisionOpacity,
          })}>恢复外观默认值</button>}
          {section !== "display" && section !== "appearance" && (
            <span className="interface-footer-note">
              {section === "backup"
                ? "导入预览与已准备的备份会在关闭后保留。"
                : "调整立即生效，保存状态见窗口顶部。"}
            </span>
          )}
          <button className="primary-button" onClick={close}>
            完成
          </button>
        </div>
      </section>
    </div>
  );
}
