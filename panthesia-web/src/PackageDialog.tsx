import { PersistentSessionRecovery } from "./app/PersistentSessionRecovery";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { X, Package, FolderOpen, RefreshCw } from "lucide-react";
import { api, type LoadedSong } from "./api";
import { MediaExportDialog } from "./features/exports/MediaExportDialog";
import { MediaExportButton } from "./features/exports/MediaExportButton";
import type { MediaExportSource } from "./features/exports/mediaExportStore";
import { TaskActivity } from "./engine/TaskActivity";
import { taskInterruption } from "./engine/taskErrors";
import {
  CancelledMusicImport,
  musicImportMessage,
  PendingMusicImport,
  reconcileMusicRequeue,
} from "./features/imports/musicImportClient";
import { importPreparedPackage } from "./features/imports/packageImportClient";
import {
  createPackageSessionStore,
  type PackageSessionStore,
} from "./features/imports/packageSessionStore";
import type { ImportedSong, PackagePolicy } from "./engine/commands.generated";
export function PackageDialog({
  song,
  close,
  changed,
  initialFile,
  session,
  openSong,
}: {
  song: LoadedSong | null;
  close: () => void;
  changed: () => Promise<void>;
  initialFile?: File;
  session?: PackageSessionStore;
  openSong?: (song: ImportedSong) => Promise<boolean>;
}) {
  const [exportSource, setExportSource] = useState<MediaExportSource | null>(
    null,
  );
  const [local] = useState(() => session ?? createPackageSessionStore());
  const store = session ?? local;
  const {
    summary,
    busy,
    error,
    message,
    policy,
    fileName,
    phase,
    receipt,
    result,
    refreshPending,
    storageError,
  } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const input = useRef<HTMLInputElement>(null),
    started = useRef(false),
    waiting = useRef<AbortController | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [stopping, setStopping] = useState(false);
  const cancellingRequest = useRef<string | null>(null);
  const setError = (error: string) => store.update({ error });
  const inspect = async (file: File) => {
    if (store.getSnapshot().phase === "review") {
      setError("请先核对原导入结果，再选择新的曲目包。");
      return;
    }
    if (!store.claim()) return;
    const controller = new AbortController();
    waiting.current = controller;
    setReceiving(true);
    setStopping(false);
    let reported = -5;
    try {
      store.update({ message: "正在传输曲目包…" });
      const value = await api.stagePackage(file, {
        signal: controller.signal,
        progress: (percent) => {
          if (controller.signal.aborted) return;
          if (percent - reported >= 5 || percent === 100) {
            reported = percent;
            store.update({
              message:
                percent === 100
                  ? "文件已传输，正在读取曲目包内容…"
                  : `正在传输曲目包 ${percent}%`,
            });
          }
        },
      });
      store.install(value, file.name);
    } catch (failure) {
      if (controller.signal.aborted)
        store.update({ error: "", message: "已停止读取曲目包，原文件保留。" });
      else
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (waiting.current === controller) waiting.current = null;
      setReceiving(false);
      setStopping(false);
      store.update({ busy: false });
    }
  };
  const pick = async () => {
    if (!api.desktop) {
      input.current?.click();
      return;
    }
    if (store.getSnapshot().phase === "review" || !store.claim()) return;
    try {
      const value = await api.pickPackage();
      if (value) store.install(value, value.fileName || "曲目包");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      store.update({ busy: false });
    }
  };
  useEffect(() => {
    if (initialFile && !started.current) {
      started.current = true;
      void inspect(initialFile);
    }
  }, [initialFile]);
  useEffect(
    () => () => {
      waiting.current?.abort();
    },
    [],
  );
  const refreshPreview = async () => {
    const current = store.getSnapshot();
    if (!current.summary || current.phase === "review" || !store.claim())
      return;
    try {
      const state = await api.state();
      if (!state.stateOrder?.engineId || !state.packageImportVersion)
        throw new Error("当前引擎版本需要重新选择原曲目包，才能更新预览。");
      const value = await api.refreshPackagePreview({
        engineId: state.stateOrder.engineId,
        token: current.summary.token,
      });
      store.update({
        summary: value,
        message: "已重新读取本机曲目与缓存，请核对导入策略。",
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      store.update({ busy: false });
    }
  };
  const openResult = async (value: ImportedSong, signal?: AbortSignal) => {
    if (signal?.aborted) return;
    if (openSong) {
      if (!(await openSong(value)))
        throw new Error("当前练习尚未保存完成，曲目包结果继续保留。");
      return;
    }
    const before = await api.state();
    if (signal?.aborted) return;
    if (before.contentId !== value.contentId)
      await api.commandForEngine(before.stateOrder?.engineId, {
        type: "openRecent",
        content_id: value.contentId,
      });
    if (signal?.aborted) return;
    await changed();
    const latest = await api.state();
    if (
      latest.contentId !== value.contentId ||
      latest.stateOrder?.engineId !== before.stateOrder?.engineId
    )
      throw new Error("曲目或连接已再次切换，请重新打开已导入曲目。");
    store.update({
      refreshPending: false,
      message: "曲目包已导入，可以关闭窗口开始练习。",
    });
  };
  const importPackage = async () => {
    if (cancellingRequest.current) return;
    const saved = store.getSnapshot(),
      reusable =
        saved.receipt && !["error", "cancelled"].includes(saved.receipt.phase);
    if (store.getRecoverySnapshot().protected && !saved.result && !reusable) {
      store.retrySave();
      return;
    }
    if (!store.claim()) return;
    const controller = new AbortController();
    waiting.current = controller;
    try {
      const current = store.getSnapshot();
      if (current.result) {
        if (current.refreshPending) {
          await changed();
          store.update({
            refreshPending: false,
            message: "已读取导入结果，可以打开练习。",
          });
          return;
        }
        await openResult(current.result, controller.signal);
        return;
      }
      if (!current.summary) throw new Error("请先选择并预览曲目包。");
      if (current.phase === "review" && !current.receipt)
        throw new Error("原导入结果待确认，请先核对曲库，再重新导入。");
      store.update({
        phase: "working",
        message: current.receipt ? "正在读取原导入结果…" : "正在准备曲目包…",
      });
      const previous =
        current.receipt &&
        !["cancelled", "error"].includes(current.receipt.phase)
          ? current.receipt
          : undefined;
      const value = await importPreparedPackage(
        current.summary.token,
        current.policy,
        {
          receipt: previous,
          previewEngineId: current.summary.engineId,
          signal: controller.signal,
          changed: (receipt) =>
            store.update({ receipt, message: musicImportMessage(receipt) }),
        },
      );
      store.update({
        result: value,
        phase: "ready",
        error: "",
        refreshPending: true,
        message: "曲目包已保存，正在更新曲库…",
      });
      await changed();
      store.update({
        refreshPending: false,
        message: "曲目包已导入，可以打开练习，也可关闭窗口稍后继续。",
      });
    } catch (failure) {
      const current = store.getSnapshot();
      if (current.result)
        store.update({
          phase: "ready",
          error: `曲目包已保存，读取未完成：${failure instanceof Error ? failure.message : String(failure)}`,
          refreshPending: true,
        });
      else if (failure instanceof PendingMusicImport)
        store.update({
          phase: "review",
          receipt: failure.receipt,
          error: failure.message,
          message: "保留原请求，请继续读取结果。",
        });
      else if (
        failure instanceof CancelledMusicImport ||
        taskInterruption(failure) === "cancelled"
      )
        store.update({
          phase: "preview",
          receipt: undefined,
          error: "",
          message: "已取消，原曲目包与导入策略保留。",
        });
      else if (
        taskInterruption(failure) === "pending" ||
        current.phase === "review" ||
        [
          "uploading",
          "queued",
          "running",
          "committing",
          "unconfirmed",
        ].includes(current.receipt?.phase ?? "")
      )
        store.update({
          phase: "review",
          error: failure instanceof Error ? failure.message : String(failure),
          message: "原导入结果待确认。",
        });
      else
        store.update({
          phase: "error",
          error: failure instanceof Error ? failure.message : String(failure),
          message: "原预览保留，可以重新读取或选择文件。",
        });
    } finally {
      if (waiting.current === controller) waiting.current = null;
      store.update({ busy: false });
    }
  };
  const cancelImport = async () => {
    const current = store.getSnapshot();
    if (!current.receipt?.cancellable || cancellingRequest.current) return;
    cancellingRequest.current = current.receipt.id;
    setCancelling(true);
    try {
      const value = await api.cancelMusicImport(
        current.receipt.id,
        current.receipt.kind,
      );
      if (store.getSnapshot().receipt?.id !== current.receipt.id) return;
      if (store.getSnapshot().result && value.phase === "done") return;
      store.update({ receipt: value, message: musicImportMessage(value) });
      if (value.phase === "done" && value.song)
        store.update({
          result: value.song,
          phase: "ready",
          error: "",
          refreshPending: true,
        });
      else if (value.phase === "cancelled" && !current.busy)
        store.update({ receipt: undefined, phase: "preview", error: "" });
    } catch (failure) {
      if (
        store.getSnapshot().receipt?.id === current.receipt.id &&
        !store.getSnapshot().result
      )
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      cancellingRequest.current = null;
      setCancelling(false);
    }
  };
  const requeue = async () => {
    if (cancellingRequest.current) return;
    if (store.getRecoverySnapshot().protected) {
      store.retrySave();
      return;
    }
    if (!store.claim()) return;
    try {
      const value = await reconcileMusicRequeue(store.getSnapshot().receipt);
      if (value)
        store.update({
          result: value,
          phase: "ready",
          refreshPending: true,
          message: "已采用原请求保存的结果，可以重新读取练习室。",
        });
      else
        store.update({
          receipt: undefined,
          phase: "preview",
          message: "已核对原结果，请重新读取预览，再确认导入。",
        });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      store.update({ busy: false });
    }
  };
  return (
    <>
      <div
        className="modal-backdrop"
        onClick={() => {
          if (!busy) close();
        }}
      >
        <section
          className="settings-dialog fingering-dialog package-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="package-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="dialog-heading">
            <div>
              <h2 id="package-title">曲目包</h2>
              <p>MIDI、谱页、教学标注与练习规则一起保存</p>
            </div>
            <button
              autoFocus
              data-dialog-close
              aria-label="关闭曲目包"
              disabled={busy}
              onClick={close}
            >
              <X size={18} />
            </button>
          </div>
          <div className="package-export">
            <Package size={22} />
            <div>
              <strong>{song?.title || "尚未打开曲目"}</strong>
              <p>
                包含全部谱面版本、元数据、指法、分手、拍号修正、分组评级、手型设置、命名练习段落、演奏书签、速度阶梯及音轨名称、颜色与声音设置。PDF
                与图片包含页序及阅读设置。个人成绩、阶梯进度及设备设置保留在本机。导出成品采用开始制作时的资料快照。
              </p>
            </div>
            <MediaExportButton
              source={song}
              kind="package"
              disabled={!song || busy}
              open={() => {
                if (song)
                  setExportSource({
                    contentId: song.contentId,
                    title: song.title,
                    engineId: song.engineId,
                  });
              }}
            />
          </div>
          <div
            className="import-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!busy && phase !== "review" && e.dataTransfer.files[0])
                void inspect(e.dataTransfer.files[0]);
            }}
          >
            <FolderOpen size={24} />
            <span>拖入一个 .neopiece 曲目包，先查看内容</span>
            <button
              disabled={busy || phase === "review" || cancelling}
              onClick={() => void pick()}
            >
              选择曲目包
            </button>
            <input
              hidden
              ref={input}
              type="file"
              accept=".neopiece"
              aria-label="导入曲目包文件"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void inspect(f);
                e.target.value = "";
              }}
            />
          </div>
          <TaskActivity
            label={["预览曲目包", "重新读取曲目包预览", "导出曲目包"]}
          />
          <TaskActivity
            label="导入曲目包"
            taskId={receipt?.taskId ?? "no-current-package"}
            cancelLabel="取消当前导入"
          />
          {busy && (
            <p role="status">
              {message || "正在处理曲目包…"}
              {receiving && (
                <button
                  disabled={stopping}
                  onClick={() => {
                    waiting.current?.abort();
                    setStopping(true);
                    store.update({
                      message: "已请求停止读取，正在结束当前处理；原文件保留。",
                    });
                  }}
                >
                  {stopping ? "正在停止…" : "停止读取"}
                </button>
              )}
            </p>
          )}
          {phase === "review" && (
            <div className="package-recovery-note" role="status">
              <strong>原导入结果待确认</strong>
              <p>继续读取会沿用原请求。核对曲库后，也可以重新准备导入。</p>
              <button
                disabled={busy || cancelling}
                onClick={() => void requeue()}
              >
                已核对曲库，重新准备
              </button>
            </div>
          )}
          <PersistentSessionRecovery
            store={store}
            error={storageError}
            busy={busy}
            label="曲目包工作进度"
          />
          {summary && (
            <div className="package-preview">
              <h3>{summary.title}</h3>
              {!!summary.fingerActions && (
                <p>
                  持音换指 {summary.fingerActions}{" "}
                  次；合并时保留已有整套换指动作，重新核对当前指法后提示。
                </p>
              )}
              <p className="parameter-help">
                {fileName} ·{" "}
                {summary.existing ? "本地已有同一内容" : "新增曲目"}
              </p>
              <div className="package-preview-actions">
                <button
                  disabled={busy || phase === "review" || cancelling}
                  onClick={() => void refreshPreview()}
                >
                  <RefreshCw size={14} />
                  重新读取预览
                </button>
                <span>关闭窗口后保留预览、导入策略与原请求。</span>
              </div>
              <dl>
                <dt>作曲家</dt>
                <dd>{summary.metadata.composer || "未填写"}</dd>
                <dt>谱面版本</dt>
                <dd>
                  {summary.scores.length ? summary.scores.join("、") : "无"}
                </dd>
                <dt>PDF 与图片谱页</dt>
                <dd>
                  {summary.papers
                    ?.map(
                      (p) =>
                        `${p.name}（${p.format === "pdf" ? "PDF" : `${p.pages} 页图片`}${p.mappingPoints ? ` · ${p.mappingPoints} 处小节对应${p.autoTurn ? " · 自动翻页" : ""}` : ""}${p.annotations ? ` · ${p.annotations} 条批注` : ""}）`,
                    )
                    .join("、") || "无"}
                </dd>
                <dt>演奏书签</dt><dd>{summary.bookmarks?.join("、") || "无"}</dd>
                <dt>速度阶梯</dt>
                <dd>{summary.ladders?.join("、") || "无"}</dd>
                <dt>指法与分手</dt>
                <dd>
                  {summary.fingerings} 个指法 · {summary.hands} 个逐音分手
                  {summary.notePlayback > 0 && ` · ${summary.notePlayback} 个逐音播放规则`}
                </dd>
                <dt>音轨设置</dt>
                <dd className="package-track-settings">
                  {summary.trackSounds
                    ? `${summary.trackSounds} 个声音设置`
                    : "无自选声音"}
                  {summary.trackAppearances?.map((t) => (
                    <span key={t.id}>
                      <i
                        className="track-color-dot"
                        style={{ background: t.color ?? "#8591a3" }}
                      />
                      {t.name}
                    </span>
                  ))}
                </dd>
                <dt>练习段落</dt>
                <dd>
                  {summary.passages.length ? summary.passages.join("、") : "无"}
                </dd>
                <dt>分组与评级</dt>
                <dd>
                  {summary.groups.map((g) => g.join(" / ")).join("、") ||
                    "未分组"}{" "}
                  · {summary.rating} 星
                </dd>
                <dt>来源与许可</dt>
                <dd>
                  {[summary.provenance?.source, summary.provenance?.license]
                    .filter(Boolean)
                    .join(" · ") || "未提供"}
                </dd>
                {summary.metadata.notes && (
                  <>
                    <dt>备注</dt>
                    <dd>{summary.metadata.notes}</dd>
                  </>
                )}
              </dl>
              <label>
                遇到已有曲目
                <select
                  aria-label="曲目包导入策略"
                  value={policy}
                  disabled={
                    busy ||
                    phase === "review" ||
                    phase === "ready" ||
                    cancelling
                  }
                  onChange={(e) =>
                    store.update({ policy: e.target.value as PackagePolicy })
                  }
                >
                  <option value="merge">合并，保留本地冲突项</option>
                  <option value="keep">保留本地标注与练习设置</option>
                  <option value="replace">使用包内标注与练习设置</option>
                </select>
              </label>
              <p className="parameter-help">
                {policy === "merge"
                  ? "补充本地缺少的标注、谱页、练习段落和速度阶梯；已有指法、分手和备注优先保留。"
                  : policy === "keep"
                    ? "已有标注与段落保持不变，补充包内谱面版本与谱页，保留本地阅读位置。"
                    : "替换当前曲目的标注、分组评级和练习设置；已有成绩与谱面文件保留；谱页目录、阅读设置和速度阶梯采用包内内容，阶梯进度重新开始。"}
              </p>
              <div className="package-import-actions">
                <button
                  className="primary-button"
                  disabled={
                    busy ||
                    cancelling ||
                    !summary.token ||
                    (phase === "review" && !receipt)
                  }
                  onClick={() => void importPackage()}
                >
                  {result
                    ? refreshPending
                      ? "重读已保存结果"
                      : "打开已导入曲目"
                    : phase === "review"
                      ? "继续读取原请求"
                      : "确认导入曲目包"}
                </button>
                {receipt?.cancellable && (
                  <button
                    disabled={cancelling}
                    onClick={() => void cancelImport()}
                  >
                    {cancelling ? "正在取消…" : "取消当前导入"}
                  </button>
                )}
              </div>
            </div>
          )}
          {error && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
          {!!result?.importWarnings.length && (
            <div className="package-recovery-note" role="status">
              <strong>曲目包已保存，附带以下提示</strong>
              <ul>
                {result.importWarnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          {message && (
            <p className="package-message" role="status">
              {message}
            </p>
          )}
        </section>
      </div>
      {exportSource && (
        <MediaExportDialog
          source={exportSource}
          kind="package"
          close={() => setExportSource(null)}
        />
      )}
    </>
  );
}
