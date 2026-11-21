import { ScoreDocumentPreview, type ScorePreviewDocument } from "./ScoreDocumentPreview";
import { useExternalProgram } from "./useExternalProgram";
import { ExternalProgramControls } from "./ExternalProgramControls";
import { ScoreTaskActivity } from "../../engine/ScoreTaskActivity";
import { ScoreSourcesDialog } from "./ScoreSourcesDialog";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createScoreWorkspaceStore,
  retainScorePreview,
  type ScoreWorkspaceStore,
  type ScorePreview,
} from "./scoreWorkspaceStore";
import { useScoreConversion } from "./useScoreConversion";
import { ScoreConversionPanel } from "./ScoreConversionPanel";
import { usePdfConversion } from "./usePdfConversion";
import { PdfConversionPanel } from "./PdfConversionPanel";
import { recognitionPdf } from "./recognitionPdf";
import { X } from "lucide-react";
import { readScoreCatalog } from "./scoreCatalog";
import { BrowseDetailWorkspace } from "../../app/BrowseDetailWorkspace";
import {
  scoreManagerDraftSession,
  type ScoreNameDraft,
  type ScoreVersionRow,
} from "./scoreManagerDraftStore";
import {
  ScoreVersionBrowser,
  type ScoreVersionPreview,
} from "./ScoreVersionBrowser";
import "./scoreManagerWorkspace.css";
import { api, type LoadedSong } from "../../api";
import { PaperScore, type PaperAttachment } from "./PaperScore";
import {
  ScoreRoutePreview,
  type ScoreRouteEvidence,
} from "./ScoreRoutePreview";
type Version = ScoreVersionRow;

export function ScoresDialog({
  song,
  close,
  changed,
  workspace,
  configureDuet,
  openPractice,
}: {
  song: LoadedSong;
  close: () => void;
  changed: () => Promise<void>;
  workspace?: ScoreWorkspaceStore;
  configureDuet?:()=>void;
  openPractice?:()=>Promise<void>;
}) {
  const museScore = useExternalProgram("musescore", api.desktop);
  const [localWorkspace] = useState(createScoreWorkspaceStore);
  const manager = workspace ?? localWorkspace;
  const slot = useMemo(
    () =>
      manager.forSource({
        engineId: song.engineId ?? undefined,
        contentId: song.contentId,
        scoreRevision: song.scoreRevision ?? 0,
        title: song.title,
        path: song.sourcePath,
      }),
    [manager, song.engineId, song.contentId],
  );
  const conversion = useScoreConversion(slot);
  const pdf = usePdfConversion(slot, () => refreshSavedResult());
  const programOperation = useRef(false);
  useEffect(() => {
    const active = conversion.jobBusy || pdf.pdfBusy;
    if (programOperation.current && !active) void museScore.refresh();
    programOperation.current = active;
  }, [conversion.jobBusy, pdf.pdfBusy, museScore.refresh]);
  const { filePreview, error, editMessage, sourceFocusVersionId } = conversion;
  const sourceKey = JSON.stringify([song.engineId ?? null, song.contentId]);
  const currentSourceKey = useRef(sourceKey);
  currentSourceKey.current = sourceKey;
  const versions = conversion.catalog?.versions ?? [];
  const originals = conversion.catalog?.originals ?? [];
  const versionsLoading =
    conversion.catalogReading ||
    (!conversion.catalog && !conversion.catalogError);
  const localBusy = conversion.localBusy;
  const busy =
    museScore.changing ||
    pdf.pdfBusy ||
    pdf.pdfSubmission ||
    pdf.pdfAdopting ||
    localBusy ||
    conversion.jobBusy ||
    conversion.submissionPending ||
    versionsLoading;
  const setError = (error: string) => slot.update({ error });
  const setFilePreview = (filePreview: ScorePreview | null) =>
    slot.update({ filePreview });
  const setEditMessage = (editMessage: string) => slot.update({ editMessage });
  const setSourceFocusVersionId = (sourceFocusVersionId: string | undefined) =>
    slot.update({ sourceFocusVersionId });
  const draftSession = useMemo(
    () => scoreManagerDraftSession(song.contentId),
    [song.contentId],
  );
  const managerDraft = useSyncExternalStore(
    draftSession.subscribe,
    draftSession.getSnapshot,
  );
  const importNameKey =
    filePreview?.evidence.fingerprint ?? filePreview?.previewToken;
  const importName = importNameKey
    ? (managerDraft.labels[importNameKey] ?? filePreview?.name ?? "")
    : (filePreview?.name ?? "");
  const validImportName =
    !!importName.trim() && Array.from(importName.trim()).length <= 120;
  const [paperMounted, setPaperMounted] = useState(
    managerDraft.section === "paper",
  );
  useEffect(() => {
    if (managerDraft.section === "paper") setPaperMounted(true);
  }, [managerDraft.section]);
  useEffect(() => {
    draftSession.observe(versions);
  }, [draftSession, versions]);
  const [paperBusy, setPaperBusy] = useState(false);
  const canClose = !pdf.pdfAdopting && (!paperBusy || conversion.jobBusy);
  const occupied = useRef(false);
  occupied.current = busy || paperBusy;
  const input = useRef<HTMLInputElement>(null);
  const command = <T = { ok: boolean },>(
    request: import("../../engine/commands.generated").EngineCommand,
  ) =>
    currentSourceKey.current === sourceKey
      ? api.commandForEngine<T>(song.engineId ?? undefined, request)
      : Promise.reject<T>(
          new Error("当前曲目或连接已改变，请返回原工作台继续。"),
        );
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const canGenerateMuseScorePdf =
    api.desktop && /Windows/i.test(navigator.userAgent);
  const canGenerateDuetScore = api.desktop && !song.generated && /\.midi?$/i.test(song.sourcePath);
  const [versionPreview, setVersionPreview] =
    useState<ScoreVersionPreview | null>(null);
  const refresh = (requireFresh = false) =>
    readScoreCatalog(slot, requireFresh);
  useEffect(() => {
    const current = slot.getSnapshot();
    if (current.source.title !== song.title)
      slot.update({ source: { ...current.source, title: song.title } });
    if (current.source.scoreRevision !== (song.scoreRevision ?? 0)) {
      const previous = current.filePreview;
      const draft =
        current.pendingDraft ??
        (previous ? retainScorePreview(previous) : null);
      slot.update({
        source: {
          ...current.source,
          title: song.title,
          path: song.sourcePath,
          scoreRevision: song.scoreRevision ?? 0,
        },
        filePreview: null,
        pendingDraft: draft,
        message: draft
          ? "谱面条件已更新，原初稿保留，请重新核对演奏顺序。"
          : current.message,
      });
      setVersionPreview(null);
    }
  }, [slot, song.scoreRevision, song.title]);
  useEffect(() => {
    setPaperBusy(false);
    setVersionPreview(null);
    if (!slot.getSnapshot().catalog && !slot.getSnapshot().localBusy)
      void refresh().catch(() => {});
  }, [slot]);
  useEffect(() => {
    const current = slot.getSnapshot();
    if (
      !localBusy &&
      !current.catalog &&
      !current.catalogReading &&
      !current.catalogError
    )
      void refresh().catch(() => {});
  }, [slot, localBusy]);
  useEffect(() => {
    if (!api.desktop) return;
    const update = () => {
      if (document.visibilityState === "visible" && !occupied.current)
        void refresh().catch((e) => setError(String(e.message)));
    };
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [song.contentId, song.engineId]);
  const previewVersion = async (version: Version) => {
    const contentId = song.contentId;
    const ticket = slot.beginAction("读取谱面预览");
    if (!ticket) return;
    setError("");
    setVersionPreview(null);
    try {
      const { document, ...evidence } = await command<ScoreRouteEvidence & { document?: ScorePreviewDocument }>({
        type: "previewScoreVersionRoute",
        include_document: true,
        id: version.id,
        content_id: contentId,
      });
      if (currentSourceKey.current === sourceKey)
        setVersionPreview({ id: version.id, path: version.path, evidence, document });
    } catch (cause) {
      if (currentSourceKey.current === sourceKey)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      slot.endAction(ticket);
    }
  };
  const previewFile = async (file: File) => {
    if (busy || paperBusy) return;
    const current = slot.getSnapshot();
    if (
      [current.pendingDraft, current.filePreview].some(
        (draft) => draft && draft.cached !== true,
      )
    ) {
      setError(
        "当前还有仅保留在窗口中的谱面。请先保存、另存副本或明确收起这份预览，再选择另一份文件。",
      );
      draftSession.browse({ section: "import" });
      return;
    }
    const ticket = slot.beginAction("保留并读取上传文件");
    if (!ticket) return;
    setError("");
    try {
      if (!file.size || file.size > 64 * 1024 * 1024)
        throw new Error("乐谱为空或超过 64 MiB");
      const bytes = new Uint8Array(await file.arrayBuffer());
      draftSession.browse({ section: "import" });
      let draft: import("./scoreWorkspaceStore").RetainedScoreDraft =
        { name: file.name, bytes, imported: true };
      slot.update({
        pendingDraft: draft,
        message: "文件已读入，正在保留副本并读取演奏顺序…",
      });
      try {
        draft = await conversion.retainImported(draft);
      } catch (error) {
        draft = {
          ...draft,
          warning: `文件已读入，本机副本尚未保留：${error instanceof Error ? error.message : String(error)}`,
        };
      }
      slot.update({ pendingDraft: draft });
      await conversion.previewRetained();
      if (draft.cached) void conversion.refreshDrafts().catch(() => {});
    } catch (cause) {
      if (currentSourceKey.current === sourceKey)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      slot.endAction(ticket);
    }
  };
  const generateScore = async () => {
    try {
      await conversion.run("midiToNotation");
    } catch {
      /* The source-owned job keeps its outcome. */
    }
  };
  const recognizePaper = async (
    attachment: PaperAttachment,
    report: (message: string) => void,
  ) => {
    await conversion.run("paperToNotation", attachment, (signal) =>
      recognitionPdf(
        song.contentId,
        attachment,
        (message) => {
          report(message);
          slot.update({ message });
        },
        signal,
      ),
    );
  };
  const saveFile = async (mode: "use" | "save", practice = false) => {
    const saved = await perform(async () => {
      if (!filePreview) return false;
      if (!validImportName) throw new Error("请输入 1–120 字的谱面版本名称。");
      if (mode === "use" && !filePreview.evidence.review) {
        const fresh = await command<ScoreRouteEvidence>({
          type: "previewScoreBytesRoute",
          bytes: Array.from(filePreview.bytes),
          name: filePreview.name,
          content_id: song.contentId,
        });
        if (
          !fresh.fingerprint ||
          fresh.fingerprint !== filePreview.evidence.fingerprint ||
          JSON.stringify(fresh.route) !==
            JSON.stringify(filePreview.evidence.route)
        ) {
          slot.update({
            pendingDraft: retainScorePreview(filePreview),
            filePreview: null,
          });
          throw new Error(
            "谱面或练习条件已变化。初稿已保留，请重新核对演奏顺序。",
          );
        }
        if (mode === "use" && fresh.route?.complete !== true)
          throw new Error("当前谱面的演奏顺序尚未确认。可以仅保存这个版本。");
      }
      await command({
        type: mode === "use" ? "pairScore" : "saveScoreVersion",
        bytes: Array.from(filePreview.bytes),
        name: importName.trim(),
        content_id: song.contentId,
        ...(mode === "use" ? { expected: filePreview.evidence.review } : {}),
      });
      setFilePreview(null);
      if (currentSourceKey.current === sourceKey) setVersionPreview(null);
    });
    if (saved && practice) await returnToPractice();
  };
  const saveDraftForEdit = async () => {
    if (
      !filePreview?.previewToken ||
      (!filePreview.generated && !filePreview.recognizedFrom)
    )
      return;
    const recognized = !!filePreview.recognizedFrom;
    const ticket = slot.beginAction("保存可编辑原谱");
    if (!ticket) return;
    setError("");
    setEditMessage("");
    try {
      const fresh = await command<ScoreRouteEvidence>({
        type: "previewScoreBytesRoute",
        bytes: Array.from(filePreview.bytes),
        name: filePreview.name,
        content_id: song.contentId,
      });
      if (
        !fresh.fingerprint ||
        fresh.fingerprint !== filePreview.evidence.fingerprint ||
        JSON.stringify(fresh.route) !==
          JSON.stringify(filePreview.evidence.route)
      ) {
        slot.update({
          pendingDraft: retainScorePreview(filePreview),
          filePreview: null,
        });
        throw new Error(
          "谱面初稿或演奏顺序已变化。初稿已保留，请重新核对后继续保存。",
        );
      }
      const saved = await (
        recognized
          ? api.saveRecognizedScoreForEdit
          : api.saveGeneratedScoreForEdit
      )(
        song.contentId,
        filePreview.name,
        filePreview.bytes,
        filePreview.previewToken,
      );
      void museScore.refresh();
      if (!saved) return;
      setFilePreview(
        saved.linked && saved.versionId ? null : { ...filePreview, saved },
      );
      if (currentSourceKey.current === sourceKey) setVersionPreview(null);
      setEditMessage(
        `${saved.alreadySaved ? "已读取原保存结果，原谱位置" : "可编辑原谱已保存"}：${saved.path}。${
          saved.alreadySaved
            ? "这是上次保存的结果，文件当前状态请在原谱列表中核对。"
            : saved.linked && saved.versionId
              ? saved.opened
                ? "MuseScore Studio 已打开。修改并保存后，请回来检查原谱更新。"
                : "谱面版本与原谱已关联，可以在原谱列表中打开编辑。"
              : "请点击“继续保存与关联原谱”，完成剩余步骤。"
        }${saved.warning ? ` ${saved.warning}` : ""}`,
      );
      setSourceFocusVersionId(saved.versionId ?? undefined);
      if (
        currentSourceKey.current === sourceKey &&
        saved.linked &&
        saved.versionId
      )
        setSourcesOpen(true);
      await refreshSavedResult();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      slot.endAction(ticket);
    }
  };
  const refreshSavedResult = async (saved = true) => {
    slot.update({ refreshPending: saved });
    if (currentSourceKey.current !== sourceKey) return;
    const results = await Promise.allSettled([
      refresh(true),
      changed(),
      conversion.refreshDrafts(),
    ]);
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failures.length) {
      const detail = failures
        .map(({ reason }) =>
          reason instanceof Error ? reason.message : String(reason),
        )
        .join("；");
      throw new Error(
        saved
          ? `操作结果已保存，界面资料尚未全部更新。请点击“重新读取保存结果”：${detail}`
          : `操作已执行，谱面列表尚未全部更新。请重新读取列表：${detail}`,
      );
    }
    if (currentSourceKey.current === sourceKey)
      slot.update({ refreshPending: false });
  };
  const retrySavedRefresh = async () => {
    if (busy || paperBusy) return;
    const ticket = slot.beginAction("读取已保存的谱面结果");
    if (!ticket) return;
    setError("");
    try {
      await refreshSavedResult();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      slot.endAction(ticket);
    }
  };
  const perform = async (work: () => Promise<void | boolean>, saved = true) => {
    if (busy || paperBusy || currentSourceKey.current !== sourceKey) return false;
    const ticket = slot.beginAction();
    if (!ticket) return false;
    setError("");
    try {
      if ((await work()) === false) return false;
      await refreshSavedResult(saved);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      slot.endAction(ticket);
    }
  };
  const reloadVersions = () => {
    if (busy || paperBusy) return;
    setError("");
    void refresh(true).catch((error) =>
      setError(error instanceof Error ? error.message : String(error)),
    );
  };
  const returnToPractice = async () => {
    if (!openPractice || currentSourceKey.current !== sourceKey) return;
    try { await openPractice(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const activateVersion = async (version: Version, evidence: ScoreRouteEvidence, practice = false) => {
    const saved = await perform(async () => {
      if (evidence.route?.complete !== true)
        throw new Error("请先核对完整演奏顺序，再使用谱面。");
      if (!evidence.review) {
        const fresh = await command<ScoreRouteEvidence>({
          type: "previewScoreVersionRoute",
          id: version.id,
          content_id: song.contentId,
        });
        if (JSON.stringify(fresh) !== JSON.stringify(evidence)) {
          if (currentSourceKey.current === sourceKey) setVersionPreview(null);
          throw new Error("谱面或顺序已改变，请重新预览。");
        }
      }
      await command({
        type: "activateScore",
        id: version.id,
        content_id: song.contentId,
        expected: evidence.review,
      });
    });
    if (saved && practice) await returnToPractice();
  };
  const renameVersion = (version: Version, draft: ScoreNameDraft) =>
    void perform(async () => {
      await command({
        type: "renameScoreVersion",
        id: version.id,
        content_id: song.contentId,
        name: draft.value,
        expected_name: draft.base,
      });
      draftSession.clearName(version.id, draft);
    });
  const removeVersion = (version: Version) =>
    void perform(async () => {
      const draft = draftSession.getSnapshot().names[version.id];
      await command({
        type: "removeScoreVersion",
        id: version.id,
        content_id: song.contentId,
      });
      if (draft) draftSession.clearName(version.id, draft);
      setVersionPreview((current) =>
        current?.id === version.id ? null : current,
      );
    });
  const importContent = (
    <div className="score-import-workspace">
      <div className="score-import-heading">
        <div>
          <h3>添加与制作谱面</h3>
          <p>添加文件或制作初稿，核对演奏顺序后决定保存与使用。</p>
        </div>
        <button
          className="primary"
          disabled={busy || paperBusy}
          onClick={() => input.current?.click()}
        >
          选择 MusicXML / MXL
        </button>
        {canGenerateDuetScore && (
          <button
            disabled={busy || paperBusy}
            onClick={() => void generateScore()}
          >
            用 DuET 生成乐谱
          </button>
        )}
      </div>
      {configureDuet&&<button type="button" onClick={configureDuet}>配置 DuET 运行环境</button>}
      <p className="parameter-help">DuET 从原始演奏 MIDI 推断节奏、声部和谱表。当前转调与量化作为练习条件单独使用；MuseScore 用于后续编辑和 PDF 排版。</p>
      <input
        hidden
        ref={input}
        type="file"
        aria-label="添加谱面版本文件"
        accept=".musicxml,.xml,.mxl"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void previewFile(file);
        }}
      />
      <ScoreConversionPanel
        conversion={conversion}
        versions={versions}
        busy={
          localBusy ||
          paperBusy ||
          versionsLoading ||
          pdf.pdfBusy ||
          pdf.pdfSubmission ||
          pdf.pdfAdopting
        }
      />
      <PdfConversionPanel
        pdf={pdf}
        busy={
          localBusy ||
          paperBusy ||
          conversion.jobBusy ||
          conversion.submissionPending ||
          versionsLoading
        }
      />

      {api.desktop && (
        <ExternalProgramControls
          program={museScore}
          disabled={busy || paperBusy}
        />
      )}
      {filePreview && (
        <section className="score-source-preview" aria-label="待添加谱面预览">
          <h3>{filePreview.name}</h3>
          {importNameKey && (
            <label className="score-import-version-name">
              保存后的谱面名称
              <input
                aria-label="新谱面版本名称"
                maxLength={240}
                value={importName}
                disabled={busy}
                onChange={(event) => {
                  try {
                    draftSession.setLabel(importNameKey, event.target.value);
                  } catch (error) {
                    setError(
                      error instanceof Error ? error.message : String(error),
                    );
                  }
                }}
              />
              {managerDraft.labels[importNameKey] !== undefined && (
                <button
                  disabled={busy}
                  onClick={() => draftSession.clearLabel(importNameKey)}
                >
                  恢复文件名
                </button>
              )}
              {!validImportName && (
                <span role="status">请输入 1–120 字的版本名称。</span>
              )}
            </label>
          )}
          <button
            disabled={busy || paperBusy}
            onClick={() => void conversion.recheckPreview()}
          >
            重新核对当前文件
          </button>
          {filePreview.imported && (
            <p className="parameter-help">
              {filePreview.cached
                ? "上传文件的独立副本已保留，可从本机初稿列表继续核对。"
                : "文件当前保留在本次运行中，请保存谱面版本或保留本机副本。"}
            </p>
          )}
          {api.desktop && filePreview.imported && !filePreview.cached && (
            <button
              disabled={busy}
              onClick={() => void conversion.retryRetainImported()}
            >
              重试保留文件副本
            </button>
          )}
          {filePreview.warning && (
            <p className="score-conversion-warning" role="status">
              {filePreview.warning}
            </p>
          )}
          {filePreview.generated && (
            <p className="parameter-help">
              这是 DuET 根据原始演奏 MIDI 生成的乐谱初稿。请核对谱号、左右手、时值和小节，再采用为练习谱面。
            </p>
          )}
          {filePreview.recognizedFrom && (
            <p className="parameter-help">
              这份乐谱由 Audiveris 从“{filePreview.recognizedFrom}
              ”识别。请逐小节核对音高、时值、拍号和反复记号；原纸谱仍保留在 PDF
              / 图片谱面中。
            </p>
          )}
          {managerDraft.section === "import" && <ScoreDocumentPreview bytes={filePreview.bytes} name={filePreview.name} />}
          <details className="score-manager-route">
            <summary>演奏顺序 · {filePreview.evidence.route?.complete ? "顺序完整" : "需要核对"} · 对应 {Math.round(filePreview.evidence.coverage)}%</summary>
            <ScoreRoutePreview evidence={filePreview.evidence} title="这份谱面的演奏顺序" />
          </details>
          <p className="parameter-help">
            “添加并使用”会立即切换当前谱面。“仅保存谱面版本”会保留当前谱面和练习；以后可以在版本列表核对并启用。
            {(filePreview.generated || filePreview.recognizedFrom) &&
              "“保存可编辑原谱”会让你选一个新文件，随后在 MuseScore Studio 中打开。"}
          </p>
          <div className="dialog-actions">
            <button
              className={openPractice ? undefined : "primary-button"}
              disabled={
                busy ||
                !validImportName ||
                filePreview.evidence.route?.complete !== true
              }
              onClick={() => saveFile("use")}
            >
              添加并使用
            </button>
            {openPractice && <button className="primary-button" disabled={busy || !validImportName || filePreview.evidence.route?.complete !== true} onClick={() => void saveFile("use", true)}>添加并打开演奏</button>}
            <button
              disabled={busy || !validImportName}
              onClick={() => saveFile("save")}
            >
              仅保存谱面版本
            </button>
            {(filePreview.generated || filePreview.recognizedFrom) &&
              filePreview.previewToken && (
                <button disabled={busy} onClick={() => void saveDraftForEdit()}>
                  {filePreview.saved
                    ? filePreview.saved.linked && filePreview.saved.versionId
                      ? "查看已保存的原谱结果"
                      : "继续保存与关联原谱"
                    : "保存可编辑原谱并打开 MuseScore"}
                </button>
              )}
            <button disabled={busy} onClick={() => setFilePreview(null)}>
              收起本次预览
            </button>
          </div>
          {filePreview.evidence.route?.complete !== true && (
            <p className="score-route-warning">
              这份谱面的演奏顺序尚未确认。保存版本后，当前练习仍使用原谱面。
            </p>
          )}
        </section>
      )}

      <ScoreTaskActivity />
    </div>
  );
  const versionsContent = (
    <>
      <ScoreVersionBrowser
        previewVisible={managerDraft.section === "versions"}
        versions={versions}
        originals={originals}
        session={draftSession}
        preview={versionPreview}
        busy={busy || paperBusy}
        desktop={api.desktop}
        canPdf={canGenerateMuseScorePdf}
        loading={versionsLoading}
        sourceIssue={conversion.catalog?.originalIssue}
        read={reloadVersions}
        add={() => {
          draftSession.browse({ section: "import" });
          input.current?.click();
        }}
        previewVersion={(version) =>
          version ? void previewVersion(version) : setVersionPreview(null)
        }
        useVersion={activateVersion}
        openPractice={openPractice ? () => void returnToPractice() : undefined}
        renameVersion={renameVersion}
        removeVersion={removeVersion}
        linkSource={(version) =>
          void perform(
            async () =>
              !!(await api.linkScoreSource(
                song.sourcePath,
                song.contentId,
                version.id,
                song.engineId ?? undefined,
              )),
          )
        }
        editSource={(version) =>
          void perform(async () => {
            await api.openScoreInMuseScore(
              song.contentId,
              version.id,
              song.engineId ?? undefined,
            );
            void museScore.refresh();
            setEditMessage(
              "MuseScore Studio 已打开原谱。保存修改后，请回来检查原谱更新。",
            );
          }, false)
        }
        makePdf={(version) => {
          draftSession.browse({ section: "import" });
          void pdf.run(version.id);
        }}
      />
      <div className="score-manager-version-footer">
        <button
          disabled={busy || paperBusy}
          onClick={() => {
            setSourceFocusVersionId(undefined);
            setSourcesOpen(true);
          }}
        >
          检查原谱更新
        </button>
        <button
          disabled={
            busy ||
            paperBusy ||
            (!song.hasScore && !versions.some((version) => version.active))
          }
          onClick={() =>
            void perform(async () => {
              await command({
                type: "detachScore",
                content_id: song.contentId,
              });
            })
          }
        >
          解除当前谱面关联
        </button>
        <p>切换谱面会再次核对演奏顺序；解除关联后，保存的谱面版本继续保留。</p>
      </div>
    </>
  );
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (canClose) close();
      }}
    >
      <section
        className="settings-dialog scores-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scores-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="scores-title">谱面管理</h2>
            <p>{song.title}</p>
          </div>
          <button
            autoFocus
            data-dialog-close
            aria-label="关闭谱面管理"
            disabled={!canClose}
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        {localBusy && (
          <p className="score-manager-local-progress" role="status">
            正在{conversion.localAction || "处理谱面"}…
            可关闭此窗口，稍后从工作进度继续查看。
          </p>
        )}
        {!localBusy &&
          (conversion.jobBusy ||
            conversion.submissionPending ||
            pdf.pdfBusy ||
            pdf.pdfSubmission ||
            pdf.pdfAdopting) &&
          managerDraft.section !== "import" && (
            <div className="score-manager-draft-problem" role="status">
              <span>
                {pdf.pdfBusy || pdf.pdfSubmission || pdf.pdfAdopting
                  ? "PDF 制作正在进行。"
                  : "谱面制作或核对正在进行。"}
              </span>
              <button
                onClick={() => draftSession.browse({ section: "import" })}
              >
                查看处理进度
              </button>
            </div>
          )}
        {managerDraft.section !== "import" &&
          !conversion.jobBusy &&
          !pdf.pdfBusy &&
          (filePreview ||
            conversion.pendingDraft ||
            (pdf.pdfLast &&
              (!pdf.pdfLast.paperId || pdf.pdfLast.adoptionPending))) && (
            <div className="score-manager-draft-problem" role="status">
              <span>有保留的谱面结果可以继续核对。</span>
              <button
                onClick={() => draftSession.browse({ section: "import" })}
              >
                查看谱面结果
              </button>
            </div>
          )}
        {conversion.refreshPending && (
          <div className="score-conversion-warning" role="status">
            <p>操作结果已保存，界面更新尚未完成。</p>
            <button
              disabled={busy || paperBusy}
              onClick={() => void retrySavedRefresh()}
            >
              重新读取保存结果
            </button>
          </div>
        )}
        {conversion.catalogError && conversion.catalogError !== error && (
          <p role="alert" className="dialog-error">
            版本列表尚未更新：{conversion.catalogError}
          </p>
        )}
        {error && (
          <p role="alert" className="dialog-error">
            {error}
          </p>
        )}
        {editMessage && (
          <p role="status" className="parameter-help">
            {editMessage}
          </p>
        )}
        {managerDraft.storageError && managerDraft.section !== "versions" && (
          <div className="score-manager-draft-problem" role="status">
            <span>谱面名称或浏览输入尚未暂存，原输入继续保留。</span>
            <button
              onClick={() => draftSession.browse({ section: "versions" })}
            >
              查看暂存问题
            </button>
          </div>
        )}
        <BrowseDetailWorkspace
          header={
            <p className="browse-detail-subtitle">
              版本、初稿和纸谱分别整理，切换分区保留当前工作。
            </p>
          }
          label="谱面管理分区"
          value={managerDraft.section}
          change={(section) => draftSession.browse({ section })}
          sections={[
            {
              id: "versions",
              label: "谱面版本",
              count: versions.length,
              content: versionsContent,
            },
            {
              id: "import",
              label: "添加与初稿",
              count: filePreview || conversion.pendingDraft ? 1 : undefined,
              content: importContent,
            },
            {
              id: "paper",
              label: "PDF 与图片",
              content: paperMounted ? (
                <PaperScore
                  engineId={song.engineId ?? undefined}
                  contentId={song.contentId}
                  manage
                  onBusy={setPaperBusy}
                  onRecognize={api.desktop ? recognizePaper : undefined}
                />
              ) : (
                <p>选择此分区读取 PDF 与图片谱面。</p>
              ),
            },
          ]}
        />
        <div className="dialog-actions score-manager-footer">
          <span>初稿和处理进度可从工作进度继续查看。</span>
          <button disabled={!canClose} onClick={close}>
            完成
          </button>
        </div>
        {sourcesOpen && (
          <ScoreSourcesDialog
            contentId={song.contentId}
            engineId={song.engineId ?? undefined}
            focusVersionId={sourceFocusVersionId}
            close={() => setSourcesOpen(false)}
            changed={async () => {
              await changed();
              await refresh(true);
            }}
          />
        )}
      </section>
    </div>
  );
}
