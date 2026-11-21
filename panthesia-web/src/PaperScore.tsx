import { useEffect, useMemo, useRef, useState } from "react";
import { useExternalProgram } from "./features/scores/useExternalProgram";
import { ExternalProgramControls } from "./features/scores/ExternalProgramControls";
import {
  settlePaperView,
  acceptPaperPageChange,
  capturePaperViewReads,
} from "./features/scores/paperViewStore";
import { api, type LoadedSong } from "./api";
import { PaperSources } from "./PaperSources";
import { PaperTransferReview } from "./PaperTransferReview";
import { PaperReader } from "./features/scores/PaperReader";
import {
  paperNoteAnchor,
  historyMappingIssue,
} from "./features/scores/paperHistoryLocation";
import type {
  PaperAttachment,
  PracticeContext,
  Papers,
  HistoryPaperFocus,
} from "./features/scores/paperTypes";
export type {
  PaperAttachment,
  PaperView,
  PaperNoteAnchor,
} from "./features/scores/paperTypes";
export { PaperReader, verifyPdfRenderer } from "./features/scores/PaperReader";

export function PaperScore({
  contentId,
  manage = false,
  revision = 0,
  onBusy,
  onRecognize,
  libraryPath,
  previewBook,
  onViewSaved,
  playback,
  contextKey,
  historyFocus,
  engineId,
}: {
  contentId: string;
  engineId?: string;
  libraryPath?: string;
  previewBook?: string;
  onViewSaved?: () => void;
  manage?: boolean;
  revision?: number;
  onBusy?: (busy: boolean) => void;
  onRecognize?: (
    attachment: PaperAttachment,
    report: (message: string) => void,
  ) => Promise<void>;
  playback?: { measure: number };
  contextKey?: string;
  historyFocus?: HistoryPaperFocus | null;
}) {
  const [sourceBusy, setSourceBusy] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [recognitionMessage, setRecognitionMessage] = useState("");
  const audiveris = useExternalProgram("audiveris", manage && !!onRecognize);
  const [practice, setPractice] = useState<PracticeContext | null>(null);
  const [song, setSong] = useState<LoadedSong | null>(null);
  const [practiceLoaded, setPracticeLoaded] = useState(false);
  const [practiceError, setPracticeError] = useState("");
  const practiceGeneration = useRef(0);
  const [focusBook, setFocusBook] = useState<string | null>(null);
  const [data, setData] = useState<Papers | null>(null),
    [operationOwner, setOperationOwner] = useState<string | null>(null),
    [refreshPending, setRefreshPending] = useState(false),
    [error, setError] = useState(""),
    [results, setResults] = useState<string[]>([]),
    [names, setNames] = useState<Record<string, string>>({});
  const input = useRef<HTMLInputElement>(null),
    append = useRef<string | undefined>(undefined),
    alive = useRef(true),
    working = useRef<string | null>(null),
    needsRefresh = useRef(false),
    readGeneration = useRef(0),
    currentContent = useRef(contentId);
  const owner = JSON.stringify([
    contentId,
    revision,
    libraryPath,
    previewBook,
    contextKey,
    engineId,
  ]);
  const busy = operationOwner === owner || audiveris.changing;
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  currentContent.current = contentId;
  useEffect(() => {
    onBusy?.(busy || sourceBusy || transferBusy);
    return () => onBusy?.(false);
  }, [busy, sourceBusy, transferBusy, onBusy]);
  const focus = historyFocus?.contentId === contentId ? historyFocus : null;
  const eligible = useMemo(
    () =>
      focus && practice
        ? (data?.attachments.filter(
            (item) => !historyMappingIssue(item, practice, focus),
          ) ?? [])
        : [],
    [focus, practice, data?.attachments],
  );
  const preferred =
    focus && eligible.length
      ? (eligible.find((item) => item.id === focusBook) ??
        eligible.find(
          (item) => practice && paperNoteAnchor(item, practice, focus),
        ) ??
        eligible.find((item) => item.id === data?.active) ??
        (eligible.length === 1 ? eligible[0] : null))
      : null;
  const current = focus
    ? (preferred ??
      data?.attachments.find((item) => item.id === data.active) ??
      data?.attachments[0])
    : (data?.attachments.find((item) => item.id === data.active) ??
      data?.attachments[0]);
  const locating = !!focus && !!current && preferred?.id === current.id;
  useEffect(() => setFocusBook(null), [focus?.request]);
  const command = <T = { ok: boolean },>(
    request: Parameters<typeof api.command>[0],
  ) => api.commandForEngine<T>(engineId, request);
  const refresh = async () => {
    if (owner !== currentOwner.current) return;
    const ticket = ++readGeneration.current;
    const readingTickets = capturePaperViewReads(contentId);
    const v = await command<Papers>({
      type: "scoreAttachments",
      content_id: contentId,
    });
    if (v.contentId !== contentId || !Array.isArray(v.attachments))
      throw new Error("谱页回复与当前曲目不一致，请重新读取。");
    if (previewBook) v.active = previewBook;
    for (const book of v.attachments)
      book.readingTicket = readingTickets.get(book.id);
    if (
      alive.current &&
      owner === currentOwner.current &&
      ticket === readGeneration.current
    ) {
      setData(v);
      needsRefresh.current = false;
      setRefreshPending(false);
    }
  };
  const readPractice = async () => {
    if (owner !== currentOwner.current) return;
    const ticket = ++practiceGeneration.current;
    setPracticeLoaded(false);
    setPracticeError("");
    try {
      const [context, source] = await Promise.all([
        command<PracticeContext>({ type: "paperPracticeContext" }),
        libraryPath
          ? Promise.resolve(null)
          : command<LoadedSong | null>({ type: "currentSong" }),
      ]);
      if (
        !alive.current ||
        owner !== currentOwner.current ||
        ticket !== practiceGeneration.current
      )
        return;
      if (
        !context ||
        typeof context.grid !== "string" ||
        !Number.isSafeInteger(context.scoreRevision) ||
        !Number.isSafeInteger(context.measures) ||
        !Number.isSafeInteger(context.measure)
      )
        throw new Error("练习范围回复不完整，请重新读取。");
      if (context.contentId !== contentId) {
        setPractice(null);
        setSong(null);
        return;
      }
      if (
        !libraryPath &&
        (!source ||
          source.contentId !== contentId ||
          source.scoreRevision !== context.scoreRevision)
      ) {
        throw new Error("曲目范围已更新，请重新读取练习范围。");
      }
      setPractice(context);
      setSong(source);
    } catch (error) {
      if (
        alive.current &&
        owner === currentOwner.current &&
        ticket === practiceGeneration.current
      ) {
        setPractice(null);
        setSong(null);
        setPracticeError(
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      if (
        alive.current &&
        owner === currentOwner.current &&
        ticket === practiceGeneration.current
      )
        setPracticeLoaded(true);
    }
  };
  useEffect(() => {
    let contextAlive = true;
    alive.current = true;
    needsRefresh.current = false;
    setRefreshPending(false);
    setData(null);
    setError("");
    setPractice(null);
    setSong(null);
    setPracticeLoaded(false);
    void readPractice();
    void refresh().catch(
      (e) =>
        contextAlive &&
        alive.current &&
        setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      contextAlive = false;
      alive.current = false;
      readGeneration.current++;
      practiceGeneration.current++;
    };
  }, [contentId, revision, libraryPath, previewBook, contextKey, engineId]);
  const work = async (job: () => Promise<void>) => {
    if (
      working.current === owner ||
      needsRefresh.current ||
      owner !== currentOwner.current
    )
      return false;
    working.current = owner;
    setOperationOwner(owner);
    setError("");
    let completed = false;
    try {
      await job();
      completed = true;
      if (!alive.current || owner !== currentOwner.current) return false;
      needsRefresh.current = true;
      if (alive.current && currentContent.current === contentId)
        setRefreshPending(true);
      await refresh();
    } catch (e) {
      if (alive.current && owner === currentOwner.current)
        setError(
          `${completed ? "操作已结束，谱页列表尚未更新。请重新读取列表：" : ""}${e instanceof Error ? e.message : String(e)}`,
        );
    } finally {
      if (working.current === owner) working.current = null;
      if (alive.current)
        setOperationOwner((current) => (current === owner ? null : current));
    }
    return completed && alive.current && owner === currentOwner.current;
  };
  const reload = async () => {
    if (working.current === owner || owner !== currentOwner.current) return;
    working.current = owner;
    setOperationOwner(owner);
    try {
      await refresh();
      await readPractice();
      if (alive.current && owner === currentOwner.current) setError("");
    } catch (error) {
      if (alive.current && owner === currentOwner.current)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (working.current === owner) working.current = null;
      if (alive.current)
        setOperationOwner((current) => (current === owner ? null : current));
    }
  };
  const update = async (
    id: string | null,
    action: string,
    extra: Record<string, unknown> = {},
  ) => {
    const pagesChanged = !!id && ["movePage", "removePage"].includes(action);
    if (pagesChanged) await settlePaperView(contentId, id!);
    if (!alive.current || owner !== currentOwner.current)
      throw new Error("谱页上下文已切换，请在当前窗口继续。");
    const saved = await command<Papers>({
      type: "updateScoreAttachment",
      content_id: contentId,
      id,
      action,
      expected_pages: pagesChanged
        ? data?.attachments
            .find((item) => item.id === id)
            ?.pages.map((page) => page.id)
        : undefined,
      ...extra,
    });
    if (pagesChanged) {
      const book = saved.attachments?.find((item) => item.id === id);
      if (saved.contentId === contentId && book)
        acceptPaperPageChange(contentId, id!, book.view);
    }
  };
  const importFiles = async (files: File[], into?: string) => {
    let target = into;
    const report: string[] = [];
    for (const f of files) {
      if (!alive.current || owner !== currentOwner.current) break;
      try {
        const image = /\.(png|jpe?g|webp)$/i.test(f.name);
        const v = await api.addScoreAttachment(
          contentId,
          f,
          into ? into : image ? target : undefined,
        );
        if (image && !target) target = v.active;
        report.push(`${f.name}：已添加`);
      } catch (e) {
        report.push(`${f.name}：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (alive.current && owner === currentOwner.current) setResults(report);
  };
  const pick = (into?: string) => {
    append.current = into;
    if (api.desktop) {
      void work(async () => {
        const r = await api.importScoreAttachments(contentId, into);
        if (r && alive.current && owner === currentOwner.current)
          setResults(
            r.results.map((v) => `${v.name}：${v.ok ? "已添加" : v.error}`),
          );
      });
    } else input.current?.click();
  };
  return (
    <section
      className={`paper-score ${manage ? "paper-manage" : ""}`}
      aria-label={manage ? "PDF 与图片谱面管理" : "谱页浏览"}
    >
      <input
        type="file"
        hidden
        multiple
        ref={input}
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        aria-label="添加 PDF 或图片谱面"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void work(() => importFiles(files, append.current));
        }}
      />
      <div className="paper-selector">
        {(refreshPending || !!error) && (
          <button
            type="button"
            disabled={busy || sourceBusy || transferBusy}
            onClick={() => void reload()}
          >
            重新读取谱页列表
          </button>
        )}
        <label>
          谱面版本{" "}
          <select
            aria-label="PDF 与图片谱面版本"
            disabled={
              busy ||
              sourceBusy ||
              transferBusy ||
              refreshPending ||
              !!previewBook ||
              !data?.attachments.length
            }
            value={current?.id ?? ""}
            onChange={(e) => {
              if (focus) setFocusBook(e.target.value);
              else void work(() => update(e.target.value, "select"));
            }}
          >
            <option value="" disabled>
              选择谱面
            </option>
            {data?.attachments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ·{" "}
                {a.format === "pdf" ? "PDF" : `${a.pages.length} 页图片`}
              </option>
            ))}
          </select>
        </label>
        {manage && (
          <>
            <button
              disabled={busy || sourceBusy || transferBusy || refreshPending}
              onClick={() => pick()}
            >
              添加 PDF / 图片
            </button>
            <button
              disabled={
                busy ||
                sourceBusy ||
                transferBusy ||
                refreshPending ||
                current?.format !== "images"
              }
              onClick={() => pick(current?.id)}
            >
              追加图片谱页
            </button>
          </>
        )}
      </div>
      {practiceError && (
        <p className="parameter-help" role="status">
          练习范围暂未读齐：{practiceError}{" "}
          <button
            type="button"
            disabled={!practiceLoaded}
            onClick={() => void readPractice()}
          >
            重新读取练习范围
          </button>
        </p>
      )}
      {focus && (
        <div className="paper-history-location" role="status">
          {!data
            ? "正在读取这首曲目的纸谱…"
            : !data.attachments.length
              ? "练习段已准备好。这首曲目还没有纸谱，请先在谱面管理中添加 PDF 或图片。"
              : !practiceLoaded
                ? "正在核对练习小节与纸谱位置…"
                : !practice || practice.contentId !== contentId
                  ? "练习段已准备好，但当前曲目小节资料无法读取，纸谱没有自动定位。"
                  : !Number.isSafeInteger(focus.measure) ||
                      focus.measure < 1 ||
                      focus.measure > practice.measures
                    ? "练习段已准备好，但目标小节超出当前曲目范围，纸谱没有自动定位。"
                    : eligible.length > 1 && !preferred
                      ? "多份纸谱都能定位这一小节，请选择要使用的纸谱。"
                      : preferred
                        ? `目标音在第 ${focus.measure} 小节；本次重练第 ${focus.startMeasure}–${focus.endMeasure} 小节。${preferred.name} 将定位到目标小节对应的谱页。`
                        : "练习段已准备好，但还没有可定位这一小节的纸谱。请在谱面管理中核对对应点。"}
          {practice && !preferred && !!data?.attachments.length && (
            <ul>
              {data.attachments.map((item) => (
                <li key={item.id}>
                  {item.name}：
                  {historyMappingIssue(item, practice, focus) ??
                    "可定位，请选择"}
                </li>
              ))}
            </ul>
          )}
          {practice && eligible.length > 1 && (
            <label>
              选择纸谱{" "}
              <select
                aria-label="选择重练纸谱"
                value={preferred?.id ?? ""}
                onChange={(event) => setFocusBook(event.target.value)}
              >
                <option value="">选择一份纸谱</option>
                {eligible.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="dialog-error">
          {error}
        </p>
      )}
      {refreshPending && (
        <p className="parameter-help" role="status">
          操作后的谱页列表仍待读取。可以重读列表，或关闭后再打开谱面。
        </p>
      )}
      {manage && (
        <>
          <p className="parameter-help">
            谱页副本与曲目一起保存在本机。多张图片按导入顺序组成一份谱面；PDF
            独立保存。可设置小节与谱页对应，练习时自动翻页；反复按实际演奏小节分别设置。
          </p>
          {results.length > 0 && (
            <div className="paper-import-results" role="status">
              {results.map((r, i) => (
                <p key={i}>{r}</p>
              ))}
            </div>
          )}
          {current && (
            <div className="paper-version-actions">
              <input
                aria-label="附件谱面名称"
                value={names[current.id] ?? current.name}
                disabled={busy || sourceBusy || transferBusy || refreshPending}
                onChange={(e) =>
                  setNames({ ...names, [current.id]: e.target.value })
                }
              />
              <button
                disabled={
                  busy ||
                  !names[current.id]?.trim() ||
                  names[current.id] === current.name
                }
                onClick={() =>
                  void work(() =>
                    update(current.id, "rename", { name: names[current.id] }),
                  )
                }
              >
                保存名称
              </button>
              <button
                disabled={busy || sourceBusy || transferBusy || refreshPending}
                onClick={() => void work(() => update(current.id, "remove"))}
              >
                移除登记
              </button>
              {onRecognize && (
                <button
                  disabled={
                    busy ||
                    sourceBusy ||
                    transferBusy ||
                    refreshPending ||
                    !audiveris.status?.available ||
                    current.pages.some(
                      (page) =>
                        !page.available ||
                        !["pdf", "png", "jpeg", "webp"].includes(page.kind),
                    )
                  }
                  title="按当前页序识别；WebP 图片会临时转换，结果将先进入演奏乐谱预览"
                  onClick={() =>
                    void work(async () => {
                      setRecognizing(true);
                      setRecognitionMessage("正在准备纸谱…");
                      try {
                        await onRecognize(current, (message) => {
                          if (alive.current) setRecognitionMessage(message);
                        });
                      } finally {
                        setRecognizing(false);
                        setRecognitionMessage("");
                      }
                    })
                  }
                >
                  {recognizing ? "正在识别纸谱…" : "识别为演奏乐谱"}
                </button>
              )}
              <span>保留导入副本和原文件</span>
            </div>
          )}
          {onRecognize && (
            <ExternalProgramControls
              program={audiveris}
              disabled={busy || sourceBusy || transferBusy || refreshPending}
            />
          )}
          {onRecognize &&
            current?.format === "images" &&
            current.pages.length > 1 && (
              <p className="parameter-help">
                识别将按上方页序合成一份临时
                PDF。原图片和页序继续保留；请在预览中逐小节核对识别结果。
              </p>
            )}
          {recognizing && (
            <p role="status" className="parameter-help">
              {recognitionMessage} 识别完成后，请逐小节核对结果。
            </p>
          )}
          {current && (
            <PaperSources
              key={`source:${contentId}:${current.id}`}
              contentId={contentId}
              attachment={current}
              disabled={busy || sourceBusy || transferBusy || refreshPending}
              changed={refresh}
              onBusy={setSourceBusy}
            />
          )}
          {current && data && (
            <PaperTransferReview
              key={`transfer:${contentId}:${current.id}`}
              contentId={contentId}
              target={current}
              books={data.attachments}
              disabled={busy || sourceBusy || transferBusy || refreshPending}
              changed={refresh}
              onBusy={setTransferBusy}
            />
          )}
        </>
      )}
      {current ? (
        <PaperReader
          key={`${contentId}|${current.id}`}
          contentId={contentId}
          attachment={current}
          engineId={engineId}
          practice={practice}
          song={song}
          playback={playback}
          historyFocus={locating ? focus : null}
          saveMapping={(mapping) =>
            work(async () => {
              await command({
                type: "setPaperMapping",
                score_revision: practice?.scoreRevision,
                content_id: contentId,
                id: current.id,
                mapping,
                expected: {
                  mapping: current.mapping ?? null,
                  pages: current.pages.map((page) => page.id),
                },
              });
            })
          }
          saveNoteAnchor={(track, index, draft, expected) =>
            work(async () => {
              await command({
                type: "editPaperNoteAnchor",
                score_revision: practice?.scoreRevision,
                content_id: contentId,
                book: current.id,
                track,
                index,
                draft,
                expected,
              });
            })
          }
          saveInk={async (assetId, page, expected, strokes) => {
            let ok = false;
            await work(async () => {
              await command({
                type: "editPaperInk",
                content_id: contentId,
                book: current.id,
                asset_id: assetId,
                page,
                expected,
                strokes,
              });
              ok = true;
            });
            if (!ok) await refresh().catch(() => {});
            else onViewSaved?.();
            return ok;
          }}
          saveAnnotation={async (id, draft, expected) => {
            let ok = false;
            await work(async () => {
              await command({
                type: "editPaperAnnotation",
                content_id: contentId,
                book: current.id,
                id,
                draft,
                expected,
              });
              ok = true;
            });
            if (!ok) await refresh().catch(() => {});
            else onViewSaved?.();
            return ok;
          }}
          onViewSaved={onViewSaved}
          disabled={busy || sourceBusy || transferBusy || refreshPending}
          manage={manage}
          update={async (action, extra) => {
            let saved = false;
            await work(async () => {
              await update(current.id, action, extra);
              saved = true;
            });
            return saved;
          }}
        />
      ) : (
        <div className="paper-empty">
          {data
            ? "尚无 PDF 或图片谱面。请在“谱面管理”添加。"
            : "正在读取谱面目录…"}
        </div>
      )}
    </section>
  );
}
