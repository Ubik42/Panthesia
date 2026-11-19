import { getInterfaceSettings } from "./interfaceSettingsStore";
import { getInterfaceWorkbench } from "./interfaceWorkbenchStore";
import {
  canonicalSetting,
  decodeLayouts,
  extractLayout,
  type SavedLayout,
} from "./layoutModel";
export {
  layoutKeys,
  layoutStorage,
  extractLayout,
  type Layout,
  type SavedLayout,
} from "./layoutModel";
export function readLayouts(): SavedLayout[] {
  return getInterfaceSettings().getSnapshot().layouts;
}
import { useState, useSyncExternalStore } from "react";
import {
  displayDefaults,
  type DisplayPreferences,
} from "../../displayPreferences";
export function LayoutSettings({
  value,
  change,
}: {
  value: DisplayPreferences;
  change: (v: DisplayPreferences) => void;
}) {
  const store = getInterfaceSettings(),
    workbench = getInterfaceWorkbench();
  const saved = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
  ).layouts;
  const draft = useSyncExternalStore(
    workbench.subscribe,
    workbench.getSnapshot,
  );
  const { selected, name } = draft;
  const setSelected = (selected: string) =>
    workbench.update({
      selected,
      selectedBaseline: canonicalSetting(
        store.getSnapshot().layouts.find((row) => row.id === selected) ?? null,
      ),
    });
  const nameKey = (id: string) => (id ? "layout:" + id : "new");
  const keepNames = (names: Record<string, string>) =>
    Object.fromEntries(Object.entries(names).slice(-25));
  const setName = (name: string) => {
    const current = workbench.getSnapshot();
    workbench.update({
      name,
      layoutNames: keepNames({
        ...current.layoutNames,
        [nameKey(current.selected)]: name,
      }),
    });
  };
  const chooseSelected = (selected: string) => {
    const current = workbench.getSnapshot(),
      row = store.getSnapshot().layouts.find((item) => item.id === selected);
    const names = keepNames({
      ...current.layoutNames,
      [nameKey(current.selected)]: current.name,
    });
    workbench.update({
      selected,
      selectedBaseline: canonicalSetting(row ?? null),
      name: names[nameKey(selected)] ?? row?.name ?? "",
      layoutNames: names,
    });
  };
  const [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const deleted = draft.deletedLayout;
  const setDeleted = (deletedLayout: typeof deleted) =>
    workbench.update({ deletedLayout });
  const selectedChanged =
    !!selected &&
    draft.selectedBaseline !==
      canonicalSetting(saved.find((row) => row.id === selected) ?? null);
  const update = (patch: Partial<DisplayPreferences>) =>
    change({ ...value, ...patch });
  const commit = (
    rows: SavedLayout[],
    message: string,
    selectedRequired = false,
  ) => {
    try {
      if (
        selectedRequired &&
        (!selected ||
          selectedChanged ||
          !saved.some((row) => row.id === selected))
      )
        throw new Error(
          "所选布局已更新或删除。名称输入继续保留，请重新选取方案后核对。",
        );
      store.setLayouts(rows, canonicalSetting(saved));
      if (selected)
        workbench.update({
          selectedBaseline: canonicalSetting(
            rows.find((row) => row.id === selected) ?? null,
          ),
        });
      setStatus(message);
      setError("");
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    }
  };
  const validName = () => {
    if (!name.trim() || Array.from(name.trim()).length > 40) {
      setError("布局名称需要 1～40 个字。");
      return false;
    }
    if (saved.some((s) => s.name === name.trim() && s.id !== selected)) {
      setError("已有同名布局，请使用不同名称。");
      return false;
    }
    return true;
  };
  return (
    <section className="layout-settings" aria-label="练习室布局">
      <h3>练习室布局</h3>
      {selectedChanged && (
        <p role="alert" className="dialog-error">
          所选方案有新的保存结果，名称输入继续保留。
          <button
            onClick={() =>
              setSelected(
                saved.some((row) => row.id === selected) ? selected : "",
              )
            }
          >
            {saved.some((row) => row.id === selected)
              ? "采用当前方案作为编辑起点"
              : "保留名称并另存为新布局"}
          </button>
        </p>
      )}
      <div className="display-settings-checks">
        <label><input type="checkbox" checked={value.practiceFocus} onChange={event=>update({practiceFocus:event.target.checked})} />专注演奏布局</label>
        <label>
          <input
            type="checkbox"
            checked={value.libraryOpen}
            onChange={(e) => update({ libraryOpen: e.target.checked })}
          />
          显示左侧曲库
        </label>
        <label>
          <input
            type="checkbox"
            checked={value.inspector}
            onChange={(e) => update({ inspector: e.target.checked })}
          />
          显示练习参数
        </label>
      </div>
      <div className="interface-scale-controls">
        <label>
          整体缩放
          <select
            aria-label="整体界面缩放"
            value={value.uiScale}
            onChange={(e) => update({ uiScale: Number(e.target.value) })}
          >
            {Array.from(new Set([80, 90, 100, 110, 125, 150, value.uiScale]))
              .sort((a, b) => a - b)
              .map((n) => (
                <option key={n} value={n}>
                  {n}%
                </option>
              ))}
          </select>
        </label>
        <button onClick={() => update({ uiScale: 100 })}>恢复 100% 缩放</button>
        <button onClick={() => update(extractLayout(displayDefaults))}>
          恢复布局默认值
        </button>
        <button
          onClick={() =>
            update({
              uiScale: Math.min(
                100,
                Math.max(
                  80,
                  Math.round(
                    (Math.min(
                      window.innerWidth / 1100,
                      window.innerHeight / 800,
                    ) *
                      100) /
                      5,
                  ) * 5,
                ),
              ),
            })
          }
        >
          适应当前窗口
        </button>
      </div>
      <div className="layout-builtins">
        {[
          {
            name: "读谱",
            patch: {
              practiceFocus: false,
              libraryOpen: false,
              inspector: true,
              keyboardHeight: 80,
              paperPreviewHeight: 110,
            },
          },
          {
            name: "选曲",
            patch: { practiceFocus: false, libraryOpen: true, inspector: false, libraryWidth: 360 },
          },
          {
            name: "专注练习",
            patch: {
              practiceFocus: true,
              libraryOpen: false,
              inspector: false,
              keyboardHeight: 150,
            },
          },
        ].map((p) => (
          <button
            key={p.name}
            aria-pressed={Object.entries(p.patch).every(
              ([key, expected]) =>
                value[key as keyof DisplayPreferences] === expected,
            )}
            onClick={() => {
              update(p.patch);
              setStatus(`已应用${p.name}布局`);
            }}
          >
            {p.name}
          </button>
        ))}
      </div>
      <div className="layout-dimensions">
        {[
          { key: "libraryWidth", label: "曲库宽度", min: 180, max: 440 },
          { key: "inspectorWidth", label: "练习参数宽度", min: 180, max: 360 },
          { key: "keyboardHeight", label: "琴键高度", min: 60, max: 220 },
          {
            key: "paperPreviewHeight",
            label: "纸谱上方键盘区域",
            min: 100,
            max: 360,
          },
        ].map((d) => (
          <label key={d.key}>
            {d.label}
            <input
              aria-label={d.label}
              type="range"
              min={d.min}
              max={d.max}
              step={10}
              value={value[d.key as keyof DisplayPreferences] as number}
              onChange={(e) => update({ [d.key]: Number(e.target.value) })}
            />
            <output>
              {value[d.key as keyof DisplayPreferences] as number} 像素
            </output>
          </label>
        ))}
      </div>
      <p className="parameter-help">
        尺寸立即生效。侧栏边缘可拖动；聚焦边缘后用方向键调整，Shift
        加快。窄窗口会自动限制面板尺寸，保留练习区域。
      </p>
      {selected && saved.some((row) => row.id === selected) && (
        <p className="parameter-help">
          {canonicalSetting(extractLayout(value)) ===
          canonicalSetting(
            extractLayout(saved.find((row) => row.id === selected)!.layout),
          )
            ? "当前布局与所选方案一致。"
            : "当前布局有调整，可更新所选方案或另存。"}
        </p>
      )}
      <div className="layout-saved">
        <label>
          已保存布局
          <select
            aria-label="已保存布局"
            value={selected}
            onChange={(e) => {
              chooseSelected(e.target.value);
              setError("");
            }}
          >
            <option value="">新布局</option>
            {selected && !saved.some((row) => row.id === selected) && (
              <option value={selected}>原方案已删除</option>
            )}
            {saved.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          名称
          <input
            aria-label="布局名称"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="dialog-actions">
          <button
            disabled={!selected || !saved.some((row) => row.id === selected)}
            onClick={() => {
              const s = saved.find((s) => s.id === selected);
              if (s) {
                update(extractLayout(s.layout));
                setStatus(`已应用「${s.name}」`);
              }
            }}
          >
            应用布局
          </button>
          <button
            onClick={() => {
              if (!validName()) return;
              if (saved.length >= 24) {
                setError("最多保存 24 个布局，请先删除不需要的方案。");
                return;
              }
              if (saved.some((s) => s.name === name.trim())) {
                setError("已有同名布局，可更新当前方案或修改名称。");
                return;
              }
              const id = crypto.randomUUID();
              if (
                commit(
                  [
                    ...saved,
                    { id, name: name.trim(), layout: extractLayout(value) },
                  ],
                  "当前布局已加入保存队列",
                )
              )
                setSelected(id);
            }}
          >
            另存当前布局
          </button>
          <button
            disabled={!selected || !saved.some((row) => row.id === selected)}
            onClick={() => {
              if (validName())
                commit(
                  saved.map((s) =>
                    s.id === selected
                      ? {
                          ...s,
                          name: name.trim(),
                          layout: extractLayout(value),
                        }
                      : s,
                  ),
                  "方案的名称和尺寸已加入保存队列",
                  true,
                );
            }}
          >
            更新当前布局
          </button>
          <button
            disabled={!selected || !saved.some((row) => row.id === selected)}
            onClick={() => {
              if (!validName()) return;
              commit(
                saved.map((s) =>
                  s.id === selected ? { ...s, name: name.trim() } : s,
                ),
                "布局改名已加入保存队列",
                true,
              );
            }}
          >
            仅改名
          </button>
          <button
            disabled={!selected || !saved.some((row) => row.id === selected)}
            onClick={() => {
              try {
                const row = saved.find((item) => item.id === selected);
                if (!row) throw new Error("所选方案已变化，请重新选取。");
                const raw = JSON.stringify(
                  store
                    .exportValues()
                    .layouts.find((item) => item.id === selected) ?? row,
                );
                const recovery = {
                  row: decodeLayouts("[" + raw + "]")[0],
                  raw,
                  deletedAt: Date.now(),
                };
                if (
                  commit(
                    saved.filter((item) => item.id !== selected),
                    "布局删除已加入保存队列，当前显示保持不变",
                    true,
                  )
                ) {
                  setDeleted(recovery);
                  chooseSelected("");
                }
              } catch (failure) {
                setError(
                  failure instanceof Error ? failure.message : String(failure),
                );
              }
            }}
          >
            删除布局
          </button>
        </div>
      </div>
      {deleted && (
        <button
          onClick={() => {
            try {
              const current = store.getSnapshot().layouts;
              if (
                current.length >= 24 ||
                current.some(
                  (row) =>
                    row.id === deleted.row.id || row.name === deleted.row.name,
                )
              )
                throw new Error(
                  "当前列表已有同名方案或已满，删除方案的输入继续保留。",
                );
              store.setLayouts(
                [...current, JSON.parse(deleted.raw) as SavedLayout],
                canonicalSetting(current),
              );
              setSelected(deleted.row.id);
              setName(deleted.row.name);
              setDeleted(null);
              setStatus("删除的布局已加入恢复队列");
              setError("");
            } catch (failure) {
              setError(
                failure instanceof Error ? failure.message : String(failure),
              );
            }
          }}
        >
          撤销删除「{deleted.row.name}」
        </button>
      )}
      <p role="status">{status}</p>
      {error && (
        <p role="alert" className="dialog-error">
          {error}
        </p>
      )}
    </section>
  );
}
