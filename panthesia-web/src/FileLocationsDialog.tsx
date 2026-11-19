import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { api } from "./api";
import type {
  EngineCommand,
  FileLocationKind,
  FileLocationListing,
} from "./engine/commands.generated";
import { TaskActivity } from "./engine/TaskActivity";
export function FileLocationsDialog({ close }: { close: () => void }) {
  const [kinds, setKinds] = useState<FileLocationKind[]>([]),
    [kind, setKind] = useState("music"),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const working = useRef(false),
    generation = useRef(0);
  const load = async (
    command: Extract<
      EngineCommand,
      { type: "fileLocationsFor" | "updateFileLocation" }
    >,
  ) => {
    if (working.current) return;
    const ticket = ++generation.current;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await api.command<FileLocationListing>(command);
      if (ticket !== generation.current) return;
      if (
        !value ||
        !Array.isArray(value.kinds) ||
        value.kinds.length > 40 ||
        value.kinds.some(
          (kind) =>
            !kind ||
            typeof kind !== "object" ||
            typeof kind.id !== "string" ||
            typeof kind.label !== "string" ||
            typeof kind.checked !== "boolean" ||
            !/^[a-f\d]{64}$/i.test(kind.revision) ||
            !Array.isArray(kind.paths) ||
            kind.paths.length > 20 ||
            kind.paths.some(
              (path) =>
                !path ||
                typeof path.path !== "string" ||
                typeof path.available !== "boolean",
            ),
        ) ||
        new Set(value.kinds.map((kind) => kind.id)).size !== value.kinds.length
      ) {
        throw new Error("文件位置回复不完整，请重新读取。");
      }
      setKinds(value.kinds);
      if (value.conflict)
        setError(
          "这类位置记录已改变，已读取最新记录。请重新选择要处理的位置。",
        );
    } catch (e) {
      if (ticket === generation.current)
        setError(
          `${e instanceof Error ? e.message : String(e)}${command.type === "updateFileLocation" ? " 请刷新位置核对原结果。" : ""}`,
        );
    } finally {
      if (ticket === generation.current) {
        working.current = false;
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    void load({ type: "fileLocationsFor", kind: "music" });
    return () => {
      generation.current++;
      working.current = false;
    };
  }, []);
  const selected = kinds.find((k) => k.id === kind);
  const update = (path: string | null, clear: boolean) =>
    void load({
      type: "updateFileLocation",
      kind,
      path,
      clear,
      expected: selected?.revision,
    });
  return (
    <div
      className="modal-backdrop file-locations-backdrop"
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="settings-dialog file-locations-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-locations-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="file-locations-title">最近文件位置</h2>
            <p>文件选择窗口按用途记住最近使用的文件夹。</p>
          </div>
          <button autoFocus aria-label="关闭最近文件位置" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <div className="file-locations-toolbar">
          <label>
            文件用途
            <select
              aria-label="文件位置用途"
              value={kind}
              disabled={busy}
              onChange={(e) => {
                setKind(e.target.value);
                void load({ type: "fileLocationsFor", kind: e.target.value });
              }}
            >
              {kinds.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !selected?.paths.length}
            onClick={() => update(null, true)}
          >
            清除此类记录
          </button>
          <button
            disabled={busy}
            onClick={() => void load({ type: "fileLocationsFor", kind })}
          >
            刷新位置
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        <TaskActivity
          label={["读取最近文件位置", "保存最近文件位置"]}
          cancelLabel="停止当前处理"
        />
        {busy && (
          <p role="status" className="parameter-help">
            正在读取或保存位置记录，可关闭此窗口。
          </p>
        )}
        <div className="file-locations-list" aria-busy={busy}>
          {selected?.paths.map((p, i) => (
            <div className="file-location-row" key={p.path}>
              <div>
                <strong>{i === 0 ? "首选位置" : "最近使用"}</strong>
                <small>
                  {!selected.checked
                    ? "尚未检查"
                    : p.available
                      ? "可用"
                      : "当前不可用"}
                </small>
                <p title={p.path}>{p.path}</p>
              </div>
              <button
                disabled={busy || !p.available || i === 0}
                onClick={() => update(p.path, false)}
              >
                用于下次选择
              </button>
              <button
                disabled={busy}
                aria-label={`移除位置记录 ${p.path}`}
                onClick={() => update(p.path, true)}
              >
                移除记录
              </button>
            </div>
          ))}
          {!busy && !selected?.paths.length && (
            <p className="parameter-help">
              此类文件还没有位置记录。下次选择文件后会自动记住所在文件夹。
            </p>
          )}
        </div>
        <p className="parameter-help">
          每类保留最近 20
          个位置。文件夹断开或被移动时，选择窗口会打开仍可用的上级位置。移除记录只清理位置记忆，文件和曲库登记继续保留。
        </p>
      </section>
    </div>
  );
}
