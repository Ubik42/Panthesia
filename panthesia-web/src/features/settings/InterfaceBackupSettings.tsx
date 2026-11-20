import { viewportRange, type KeyboardViewport } from "../practice/keyboardViewport";
import { pitchName } from "../../engine/musicFormatting";
import {
  loadInterfaceBackup,
  exportCurrentInterface,
  savePreparedInterface,
  applyInterfaceBackup,
} from "./interfaceBackupJobs";
import { useMemo, useRef, useSyncExternalStore } from "react";
import { getInterfaceSettings } from "./interfaceSettingsStore";
import { getInterfaceWorkbench } from "./interfaceWorkbenchStore";
import {
  interfaceBaseline,
  planInterfaceRestore,
  settingsGroups,
  groupNames,
  canonical,
  type Group,
} from "./interfaceBackupModel";
import { codeLabel } from "../../displayPreferences";
import { shortcutActions, shortcutLabel } from "../../shortcuts";
const labels: Record<string, string> = {
  practiceFocus: "专注演奏布局",
  practiceView: "练习视图", practiceSplitAxis: "组合排列", practiceSplitRatio: "组合谱面比例",
  uiScale: "整体界面缩放",
  keyLabelMode:"琴键标签内容",noteLabelMode:"音符标签内容",keyLabelsOwnOnly:"仅自己声部琴键标签",noteLabelsOwnOnly:"仅自己声部音符标签",
  notation: "音符名称",
  noteLabels: "音符提示",
  keyLabels: "键上名称",
  tonic: "级数主音",
  octave: "音区数字",
  fontSize: "提示字号",
  palette: "声部配色",
  range: "键盘范围",
  keyboardViewport: "连续取景位置",
  keyboardLow: "自定义最低音", keyboardHigh: "自定义最高音", keyboardDeviceRanges: "MIDI 设备音域",
  previewBars: "预览小节",
  libraryOpen: "显示曲库",
  inspector: "显示练习参数",
  libraryWidth: "曲库宽度",
  inspectorWidth: "参数宽度",
  keyboardHeight: "琴键高度",
  paperPreviewHeight: "纸谱键盘区域",
  keyboardEnabled: "电脑键盘演奏",
  keyboardOctave: "电脑键盘音区",
  keyCodes: "弹奏按键",
};
const describe = (v: unknown) =>
  typeof v === "boolean"
    ? v
      ? "开启"
      : "关闭"
    : Array.isArray(v)
      ? v.map((k) => String(k).replace(/^(Key|Digit)/, "")).join(" ")
      : ((
          {
            keyboard: "瀑布与琴键", score: "五线谱", paper: "谱页", combined: "谱面与瀑布", rows: "上下排列", columns: "左右并排",
            octaves:"八度编号",mapping:"电脑键盘映射",english:"字母音名",fixed:"固定唱名",movable:"首调唱名",simple:"简单音名",legacy:"沿用已有设置",
            pitch: "音名",
            solfege: "固定唱名",
            degree: "大调级数",
            auto: "指法优先",
            name: "名称",
            finger: "指法",
            both: "指法与名称",
            none: "隐藏",
            c: "C 键",
            white: "白键",
            all: "全部",
            standard: "曲目颜色",
            accessible: "左右手蓝橙",
          } as Record<string, string>
        )[String(v)] ?? String(v));
const settingText = (key: string, v: unknown) =>
  key === "keyboardViewport" ? v ? (()=>{const range=viewportRange(v as KeyboardViewport);return `${pitchName(range.low)}–${pitchName(range.high)} · 连续取景`;})() : "按显示范围取景"
    : key === "practiceSplitRatio" ? `${v}%`
    : key === "practiceSplitAxis" && v === "auto" ? "自动排列"
    : key === "keyboardDeviceRanges"
    ? Object.entries(v as Record<string, {low:number; high:number}>).map(([name, range]) => `${name}：${pitchName(range.low)}–${pitchName(range.high)}`).join("；") || "未设置"
    : key === "keyboardLow" || key === "keyboardHigh" ? pitchName(Number(v))
    : key === "uiScale"
    ? `${v}%`
    : key === "tonic"
      ? ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][
          Number(v)
        ]
      : [
            "libraryWidth",
            "inspectorWidth",
            "keyboardHeight",
            "paperPreviewHeight",
            "fontSize",
          ].includes(key)
        ? `${v} 像素`
        : key === "range"
          ? (({song:"按歌曲音域",device:"按 MIDI 键盘",custom:"自定义音域"} as Record<string,string>)[String(v)] ?? `${v} 键`)
          : key === "previewBars"
            ? `${v} 小节`
            : key === "keyboardOctave"
              ? `C${v}–C${Number(v) + 1}`
              : key === "keyCodes"
                ? (v as string[]).map(codeLabel).join(" ")
                : describe(v);
export function InterfaceBackupSettings() {
  const workbench = getInterfaceWorkbench(),
    settings = getInterfaceSettings();
  const draft = useSyncExternalStore(
    workbench.subscribe,
    workbench.getSnapshot,
  );
  const saved = useSyncExternalStore(settings.subscribe, settings.getSnapshot);
  const { preview, groups, policies, error, status, busy } = draft;
  const setGroups = (groups: Record<Group, boolean>) =>
    workbench.update({ groups });
  const setPolicies = (policies: Record<string, "keep" | "replace" | "skip">) =>
    workbench.update({ policies });
  const stale =
    !!preview && preview.baseline !== interfaceBaseline(saved.preferences);
  const plan = useMemo(() => {
    if (!preview) return null;
    try {
      return {
        result: planInterfaceRestore(
          preview.backup,
          preview.current,
          preview.layouts,
          groups,
          policies,
        ),
        error: "",
      };
    } catch (failure) {
      return {
        result: null,
        error: failure instanceof Error ? failure.message : String(failure),
      };
    }
  }, [preview, groups, policies]);
  const groupChanges = (group: Group) =>
    !preview
      ? 0
      : group === "shortcuts"
        ? shortcutActions.filter(
            (action) =>
              preview.current.shortcuts[action.id] !==
              preview.backup.preferences.shortcuts[action.id],
          ).length
        : settingsGroups[group].filter(
            (key) =>
              canonical(preview.current[key]) !==
              canonical(preview.backup.preferences[key]),
          ).length;
  const input = useRef<HTMLInputElement>(null);
  return (
    <section className="interface-backup-settings" aria-label="界面设置备份">
      <h3>界面设置备份</h3>
      <p className="parameter-help">
        导出显示、电脑键盘、操作快捷键和命名布局。导入后先核对，再选择恢复；练习成绩与曲目资料使用练习资料备份。
      </p>
      <div className="dialog-actions">
        <button
          disabled={
            busy ||
            (!!draft.preparedExport &&
              !["saved", "requested"].includes(draft.preparedExport.phase))
          }
          onClick={() => void exportCurrentInterface()}
        >
          导出当前窗口设置
        </button>
        <button disabled={busy} onClick={() => input.current?.click()}>
          读取界面设置备份
        </button>
      </div>
      {draft.preparedExport && (
        <div className="interface-prepared-export">
          <p>
            <strong>已准备的界面备份</strong> ·{" "}
            {new Date(draft.preparedExport.createdAt).toLocaleString("zh-CN")}
          </p>
          <p>
            {draft.preparedExport.phase === "saved"
              ? `已保存：${draft.preparedExport.path}`
              : draft.preparedExport.phase === "saving"
                ? "正在选择位置或写入文件…"
                : draft.preparedExport.phase === "unknown"
                  ? "上次导出回复尚未确认，这份备份原文继续保留。请先核对导出位置，再决定是否另存。"
                  : draft.preparedExport.phase === "requested"
                    ? "浏览器已收到下载请求，可到下载位置查看。"
                    : "已准备完成，可继续另存这份备份。"}
          </p>
          <div className="dialog-actions">
            <button
              disabled={busy}
              onClick={() => void savePreparedInterface()}
            >
              重新另存这份备份
            </button>
            <button
              disabled={busy}
              onClick={() =>
                workbench.update({
                  preparedExport: null,
                  exportPath: "",
                  status: "已清除导出记录。",
                  error: "",
                })
              }
            >
              清除此导出记录
            </button>
          </div>
        </div>
      )}
      <input
        ref={input}
        aria-label="界面设置备份文件"
        type="file"
        accept=".neosettings,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void loadInterfaceBackup(file);
        }}
      />
      {preview && (
        <div className="interface-backup-preview">
          <p>已读取：{preview.filename}</p>
          {stale && (
            <p role="alert" className="dialog-error">
              本机设置已变化。恢复选择继续保留，请重新核对差异。
            </p>
          )}
          <p>
            备份时间：
            {Number.isFinite(Date.parse(preview.backup.createdAt))
              ? new Date(preview.backup.createdAt).toLocaleString("zh-CN")
              : "未知"}{" "}
            · {preview.backup.layouts.length} 个命名布局
          </p>
          <label className="interface-difference-filter">
            <input
              type="checkbox"
              checked={draft.onlyDifferences}
              disabled={busy}
              onChange={(event) =>
                workbench.update({ onlyDifferences: event.target.checked })
              }
            />
            只显示不同的设置
          </label>
          {(Object.keys(settingsGroups) as Group[]).map((group) => (
            <div key={group}>
              <label>
                <input
                  disabled={busy}
                  type="checkbox"
                  aria-label={`恢复${groupNames[group]}`}
                  checked={groups[group]}
                  onChange={(e) =>
                    setGroups({ ...groups, [group]: e.target.checked })
                  }
                />
                {groupNames[group]}
              </label>
              <details>
                <summary>
                  核对{groupNames[group]} · {groupChanges(group)} 项差异
                </summary>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">设置</th>
                      <th scope="col">本机</th>
                      <th scope="col">备份</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group === "shortcuts"
                      ? shortcutActions
                          .filter(
                            (action) =>
                              !draft.onlyDifferences ||
                              preview.current.shortcuts[action.id] !==
                                preview.backup.preferences.shortcuts[action.id],
                          )
                          .map((a) => (
                            <tr
                              key={a.id}
                              className={
                                preview.current.shortcuts[a.id] !==
                                preview.backup.preferences.shortcuts[a.id]
                                  ? "settings-difference"
                                  : ""
                              }
                            >
                              <td>{a.label}</td>
                              <td>
                                {shortcutLabel(preview.current.shortcuts[a.id])}
                              </td>
                              <td>
                                {shortcutLabel(
                                  preview.backup.preferences.shortcuts[a.id],
                                )}
                              </td>
                            </tr>
                          ))
                      : settingsGroups[group]
                          .filter(
                            (key) =>
                              !draft.onlyDifferences ||
                              canonical(preview.current[key]) !==
                                canonical(preview.backup.preferences[key]),
                          )
                          .map((key) => (
                            <tr
                              key={key}
                              className={
                                canonical(preview.current[key]) !==
                                canonical(preview.backup.preferences[key])
                                  ? "settings-difference"
                                  : ""
                              }
                            >
                              <td>{labels[key]}</td>
                              <td>{settingText(key, preview.current[key])}</td>
                              <td>
                                {settingText(
                                  key,
                                  preview.backup.preferences[key],
                                )}
                              </td>
                            </tr>
                          ))}
                    {draft.onlyDifferences && !groupChanges(group) && (
                      <tr>
                        <td colSpan={3}>此分组与本机设置一致。</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </details>
            </div>
          ))}
          {preview.backup.layouts.map((source) => {
            const existing = preview.layouts.find(
              (v) => v.name === source.name,
            );
            return (
              <div className="interface-layout-row" key={source.id}>
                <div>
                  <strong>{source.name}</strong>
                  <small>
                    {existing ? "本机已有同名方案" : "新方案"} · 曲库{" "}
                    {source.layout.libraryWidth} / 参数{" "}
                    {source.layout.inspectorWidth} / 琴键{" "}
                    {source.layout.keyboardHeight} 像素
                  </small>
                </div>
                <select
                  disabled={busy}
                  aria-label={`恢复布局：${source.name}`}
                  value={policies[source.id] ?? "skip"}
                  onChange={(e) =>
                    setPolicies({
                      ...policies,
                      [source.id]: e.target.value as
                        "keep" | "replace" | "skip",
                    })
                  }
                >
                  <option value="keep">
                    {existing ? "保留本机方案" : "加入新方案"}
                  </option>
                  {existing && <option value="replace">使用备份方案</option>}
                  <option value="skip">不恢复</option>
                </select>
              </div>
            );
          })}
          {plan?.result && (
            <p className="interface-restore-summary" role="status">
              将修改 {plan.result.changedSettings} 项设置，新增{" "}
              {plan.result.addedLayouts} 个布局，替换{" "}
              {plan.result.changedLayouts} 个布局。
            </p>
          )}
          {plan?.result &&
            !plan.result.changedSettings &&
            !plan.result.addedLayouts &&
            !plan.result.changedLayouts && (
              <p className="parameter-help">所选内容已与本机一致。</p>
            )}
          {plan?.error && (
            <p className="dialog-error" role="alert">
              {plan.error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              disabled={busy}
              onClick={() => {
                workbench.update({
                  preview: {
                    ...preview,
                    baseline: interfaceBaseline(
                      settings.getSnapshot().preferences,
                    ),
                    current: settings.getSnapshot().preferences,
                    layouts: settings.getSnapshot().layouts,
                  },
                  error: "",
                  status: "已重新读取本机设置，请核对差异",
                });
              }}
            >
              重新核对本机设置
            </button>
            <button
              disabled={
                busy ||
                stale ||
                saved.protected ||
                saved.maintenance ||
                !!plan?.error ||
                (!!plan?.result &&
                  !plan.result.changedFields.length &&
                  !plan.result.addedLayouts &&
                  !plan.result.changedLayouts) ||
                (!Object.values(groups).some(Boolean) &&
                  Object.values(policies).every((v) => v === "skip"))
              }
              onClick={() => void applyInterfaceBackup()}
            >
              恢复所选设置
            </button>
            <button
              disabled={busy}
              onClick={() => {
                workbench.update({
                  preview: null,
                  error: "",
                  status: "已取消恢复",
                });
              }}
            >
              取消恢复
            </button>
          </div>
        </div>
      )}
      <p role="status">{status}</p>
      {error && (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
