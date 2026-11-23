import { getInterfaceWorkbench } from "./interfaceWorkbenchStore";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isComposingKey, ownsInputLayer } from "../../app/inputOwnership";
import {
  shortcutActions,
  shortcutDefaults,
  eventShortcut,
  shortcutError,
  shortcutLabel,
  type ShortcutAction,
} from "../../app/shortcuts";
import type { DisplayPreferences } from "./displayPreferences";
const shortcutGroups: {
  id: string;
  label: string;
  actions: readonly ShortcutAction[];
}[] = [
  {
    id: "playback",
    label: "播放与练习",
    actions: [
      "playPause",
      "restart",
      "silence",
      "previousMeasure",
      "nextMeasure",
      "slower",
      "faster",
      "metronome",
      "loop",
    ],
  },
  {
    id: "workspace",
    label: "窗口与工作区",
    actions: [
      "view",
      "library",
      "inspector",
      "display",
      "passages",
      "commands",
      "fullscreen",
    ],
  },
  {
    id: "scale",
    label: "界面缩放",
    actions: ["zoomIn", "zoomOut", "zoomReset"],
  },
];
export function ShortcutSettings({
  value,
  change,
  pianoCapture,
  clearPiano,
  reportCapture = () => undefined,
  active = true,
}: {
  value: DisplayPreferences;
  change: (v: DisplayPreferences) => void;
  pianoCapture: number | null;
  clearPiano: () => void;
  reportCapture?: (active: boolean) => void;
  active?: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const workbench = getInterfaceWorkbench();
  const draft = useSyncExternalStore(
    workbench.subscribe,
    workbench.getSnapshot,
  );
  const [capture, setCaptureState] = useState<ShortcutAction | null>(null),
    [error, setError] = useState("");
  const setCapture = (next: ShortcutAction | null) => {
    setCaptureState(next);
    reportCapture(next !== null);
  };
  useEffect(() => () => reportCapture(false), []);
  useEffect(() => {
    if (!active) setCapture(null);
  }, [active]);
  useEffect(() => {
    if (pianoCapture !== null) setCapture(null);
  }, [pianoCapture]);
  useEffect(() => {
    if (!capture || !active) return;
    const down = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isComposingKey(e) || !ownsInputLayer(root.current)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        setCapture(null);
        setError("");
        return;
      }
      if (e.repeat || ["Control", "Alt", "Shift", "Meta"].includes(e.key))
        return;
      const chord = eventShortcut(e);
      const message = chord
        ? shortcutError(chord, value.keyCodes)
        : "请使用 Ctrl、Alt 或 Shift，不使用系统键。";
      if (message) {
        setError(message);
        return;
      }
      const other = shortcutActions.find(
        (a) => a.id !== capture && value.shortcuts[a.id] === chord,
      );
      if (other) {
        setError(
          `这个组合已用于「${other.label}」，请先清除原绑定或选择其他按键。`,
        );
        return;
      }
      change({ ...value, shortcuts: { ...value.shortcuts, [capture]: chord } });
      setCapture(null);
      setError("");
    };
    window.addEventListener("keydown", down, true);
    const cancel = () => setCapture(null);
    const hide = () => { if (document.hidden) cancel(); };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [capture, value, change, active]);
  const query = draft.shortcutQuery.trim().toLocaleLowerCase();
  const visibleActions = shortcutActions.filter(
    (action) =>
      (!query ||
        (
          action.label +
          " " +
          shortcutLabel(value.shortcuts[action.id]) +
          " " +
          shortcutLabel(shortcutDefaults[action.id])
        )
          .toLocaleLowerCase()
          .includes(query)) &&
      (draft.shortcutFilter === "all" ||
        (draft.shortcutFilter === "custom"
          ? value.shortcuts[action.id] !== shortcutDefaults[action.id]
          : !value.shortcuts[action.id])),
  );
  const resetAction = (action: ShortcutAction) => {
    const chord = shortcutDefaults[action];
    const other =
      chord &&
      shortcutActions.find(
        (item) => item.id !== action && value.shortcuts[item.id] === chord,
      );
    const invalid = chord && shortcutError(chord, value.keyCodes);
    if (other || invalid) {
      setError(
        other
          ? `默认按键已用于「${other.label}」，请先修改该操作的按键。`
          : invalid || "",
      );
      return;
    }
    change({ ...value, shortcuts: { ...value.shortcuts, [action]: chord } });
    setCapture(null);
    setError("");
  };
  return (
    <section
      className="shortcut-settings"
      aria-label="操作快捷键"
      data-shortcut-capturing={capture !== null && active}
      ref={root}
    >
      <h3>操作快捷键</h3>
      <p className="parameter-help">
        点击按键录入新组合，Esc 取消。电脑键盘弹奏键单独设置。
      </p>
      <div className="shortcut-toolbar">
        <label>
          查找操作
          <input
            aria-label="查找操作快捷键"
            type="search"
            maxLength={200}
            value={draft.shortcutQuery}
            onFocus={() => setCapture(null)}
            onChange={(event) => {
              setCapture(null);
              workbench.update({ shortcutQuery: event.target.value });
            }}
          />
        </label>
        <label>
          显示
          <select
            aria-label="筛选操作快捷键"
            value={draft.shortcutFilter}
            onChange={(event) => {
              setCapture(null);
              workbench.update({
                shortcutFilter: event.target.value as
                  "all" | "custom" | "unassigned",
              });
            }}
          >
            <option value="all">全部操作</option>
            <option value="custom">已修改</option>
            <option value="unassigned">未分配</option>
          </select>
        </label>
        {(draft.shortcutQuery || draft.shortcutFilter !== "all") && (
          <button
            onClick={() =>
              workbench.update({ shortcutQuery: "", shortcutFilter: "all" })
            }
          >
            显示全部
          </button>
        )}
      </div>
      <p className="parameter-help">
        已分配{" "}
        {shortcutActions.filter((action) => value.shortcuts[action.id]).length}{" "}
        / {shortcutActions.length} 项 · 已修改{" "}
        {
          shortcutActions.filter(
            (action) =>
              value.shortcuts[action.id] !== shortcutDefaults[action.id],
          ).length
        }{" "}
        项 · 当前显示 {visibleActions.length} 项
      </p>
      {shortcutGroups.map((group) => {
        const actions = visibleActions.filter((action) =>
          group.actions.includes(action.id),
        );
        if (!actions.length) return null;
        return (
          <section
            className="shortcut-group"
            key={group.id}
            aria-labelledby={"shortcut-group-" + group.id}
          >
            <h4 id={"shortcut-group-" + group.id}>{group.label}</h4>
            <div className="shortcut-list">
              {actions.map((action) => (
                <div
                  key={action.id}
                  data-custom={
                    value.shortcuts[action.id] !== shortcutDefaults[action.id]
                  }
                >
                  <span>
                    {action.label}
                    <small>
                      默认：{shortcutLabel(shortcutDefaults[action.id])}
                    </small>
                  </span>
                  <button
                    aria-label={`修改快捷键：${action.label}`}
                    aria-pressed={capture === action.id}
                    onClick={() => {
                      clearPiano();
                      setCapture(action.id);
                      setError("");
                    }}
                  >
                    {capture === action.id
                      ? "请按组合键…"
                      : shortcutLabel(value.shortcuts[action.id])}
                  </button>
                  <button
                    aria-label={`清除快捷键：${action.label}`}
                    disabled={!value.shortcuts[action.id]}
                    onClick={() => {
                      change({
                        ...value,
                        shortcuts: { ...value.shortcuts, [action.id]: null },
                      });
                      setCapture(null);
                      setError("");
                    }}
                  >
                    清除
                  </button>
                  <button
                    aria-label={`恢复默认快捷键：${action.label}`}
                    disabled={
                      value.shortcuts[action.id] === shortcutDefaults[action.id]
                    }
                    onClick={() => resetAction(action.id)}
                  >
                    默认
                  </button>
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {!visibleActions.length && (
        <p role="status">没有符合条件的操作，可调整搜索或筛选。</p>
      )}
      <button
        onClick={() => {
          change({ ...value, shortcuts: { ...shortcutDefaults } });
          setCapture(null);
          setError("");
        }}
      >
        恢复操作快捷键默认值
      </button>
      <p role="status">
        {capture
          ? `正在设置「${shortcutActions.find((a) => a.id === capture)?.label}」`
          : "调整立即生效，保存状态见窗口顶部。"}
      </p>
      {error && (
        <p role="alert" className="dialog-error">
          {error}
        </p>
      )}
    </section>
  );
}
