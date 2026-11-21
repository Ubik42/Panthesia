import type { ScoreJobProgress } from "./scoreJobProgress";
import { activitySignal } from "../activity/activitySignal";
import type {
  ScoreDraft,
  ScoreJobRequest,
  DraftSummary,
  DraftSaved,
  PdfDraft,
} from "../../engine/commands.generated";
import type { ScoreVersionRow } from "./scoreManagerDraftStore";
export interface ScoreCatalog {
  versions: ScoreVersionRow[];
  originals: { versionId: string; status: string; path: string }[];
  originalIssue?: string;
}
import type { ScoreRouteEvidence } from "./ScoreRoutePreview";
export interface ScoreWorkspaceSource {
  engineId?: string;
  contentId: string;
  scoreRevision: number;
  title?: string;
  path?: string;
}
export interface ScorePreview {
  name: string;
  bytes: Uint8Array;
  evidence: ScoreRouteEvidence;
  generated?: boolean;
  imported?: boolean;
  recognizedFrom?: string;
  previewToken?: string;
  warning?: string | null;
  saved?: DraftSaved | null;
  cached?: boolean;
}
export type RetainedScoreDraft = Omit<
  ScoreDraft,
  "previewToken" | "warning" | "saved" | "cached" | "bytes"
> & {
  bytes: Uint8Array;
  previewToken?: string;
  warning?: string | null;
  saved?: DraftSaved | null;
  cached?: boolean;
  generated?: boolean;
  imported?: boolean;
  recognizedFrom?: string;
};
export function retainScorePreview(preview: ScorePreview): RetainedScoreDraft {
  const { evidence: _evidence, ...draft } = preview;
  return draft;
}
export interface ScoreWorkspace {
  source: ScoreWorkspaceSource;
  tab: "notation" | "paper";
  names: Record<string, string>;
  catalog: ScoreCatalog | null;
  catalogReading: boolean;
  catalogError: string;
  filePreview: ScorePreview | null;
  pendingDraft: RetainedScoreDraft | null;
  job?: ScoreJobRequest;
  jobStatus?: ScoreJobProgress;
  jobBusy: boolean;
  localBusy: boolean;
  localAction: string;
  submissionPending: boolean;
  message: string;
  error: string;
  editMessage: string;
  refreshPending: boolean;
  sourceFocusVersionId?: string;
  drafts: DraftSummary[];
  draftQuery: string;
  draftPage: number;
  draftExpanded: boolean;
  draftIssues: string[];
  pdfJob?: ScoreJobRequest;
  pdfStatus?: ScoreJobProgress;
  pdfBusy: boolean;
  pdfSubmission: boolean;
  pdfAdopting: boolean;
  pdfAutoAdopt: boolean;
  pdfAll: boolean;
  pdfLast?: PdfDraft;
  pdfDrafts: PdfDraft[];
  pdfTotal: number;
  pdfIssues: string[];
  pdfMessage: string;
  pdfError: string;
}
function createSlot(source: ScoreWorkspaceSource) {
  let draftRead = 0;
  let pdfRead = 0;
  let state: ScoreWorkspace = {
    source,
    tab: "notation",
    names: {},
    catalog: null,
    catalogReading: false,
    catalogError: "",
    filePreview: null,
    pendingDraft: null,
    jobBusy: false,
    localBusy: false,
    localAction: "",
    submissionPending: false,
    message: "",
    error: "",
    editMessage: "",
    refreshPending: false,
    drafts: [],
    draftQuery: "",
    draftPage: 0,
    draftExpanded: false,
    draftIssues: [],
    pdfBusy: false,
    pdfSubmission: false,
    pdfAdopting: false,
    pdfAutoAdopt: false,
    pdfAll: false,
    pdfDrafts: [],
    pdfTotal: 0,
    pdfIssues: [],
    pdfMessage: "",
    pdfError: "",
  };
  const listeners = new Set<() => void>();
  let action: symbol | null = null;
  const update = (
    change: Partial<ScoreWorkspace> | ((old: ScoreWorkspace) => ScoreWorkspace),
  ) => {
    state =
      typeof change === "function" ? change(state) : { ...state, ...change };
    for (const listener of [...listeners]) listener();
    activitySignal.changed();
  };

  return {
    beginPdfRead: () => {
      const ticket = ++pdfRead;
      return () => pdfRead === ticket;
    },
    beginDraftRead: () => {
      const ticket = ++draftRead;
      return () => draftRead === ticket;
    },
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update,
    beginAction(label = "更新谱面资料") {
      if (action) return null;
      action = Symbol("score-workspace-action");
      update({ localBusy: true, localAction: label });
      return action;
    },
    endAction(ticket: symbol) {
      if (action !== ticket) return;
      action = null;
      update({ localBusy: false, localAction: "" });
    },
  };
}
export type ScoreWorkspaceSlot = ReturnType<typeof createSlot>;
function hasUnretainedWork(state: ScoreWorkspace) {
  return (
    state.catalogReading ||
    state.localBusy ||
    state.jobBusy ||
    state.pdfBusy ||
    state.pdfSubmission ||
    state.pdfAdopting ||
    state.submissionPending ||
    state.refreshPending ||
    Object.keys(state.names).length > 0 ||
    (!!state.job &&
      (!state.jobStatus ||
        ["preparing", "running"].includes(state.jobStatus.phase))) ||
    (!!state.pdfJob &&
      (!state.pdfStatus ||
        ["preparing", "running"].includes(state.pdfStatus.phase))) ||
    [state.pendingDraft, state.filePreview].some(
      (preview) =>
        preview &&
        (!preview.previewToken ||
          preview.cached !== true ||
          (!!preview.saved && !preview.saved.linked)),
    )
  );
}
/** Keep source-owned drafts outside the dialog. Older generated drafts also remain in the native cache. */
export function createScoreWorkspaceStore() {
  const slots = new Map<string, ScoreWorkspaceSlot>();
  const forSource = (source: ScoreWorkspaceSource) => {
    const key = JSON.stringify([source.engineId ?? null, source.contentId]);
    let slot = slots.get(key);
    if (!slot) {
      while (slots.size >= 16) {
        const oldest = [...slots].find(
          ([, slot]) => !hasUnretainedWork(slot.getSnapshot()),
        );
        if (!oldest) break;
        slots.delete(oldest[0]);
      }
      slot = createSlot(source);
      activitySignal.changed();
    }
    slots.delete(key);
    slots.set(key, slot);
    return slot;
  };
  return {
    forSource,
    recoverPreview(key: string, target: ScoreWorkspaceSource) {
      const origin = slots.get(key),
        retained = origin?.getSnapshot();
      if (
        !origin ||
        !retained ||
        retained.source.contentId !== target.contentId
      )
        throw new Error("原初稿或来源曲目已改变，请重新打开工作进度。");
      if (retained.localBusy || retained.jobBusy || retained.submissionPending)
        throw new Error(
          "原谱面工作台正在交接初稿，请稍后再取回。原内容继续保留。",
        );
      const draft =
        retained.pendingDraft ??
        (retained.filePreview
          ? retainScorePreview(retained.filePreview)
          : null);
      if (!draft) throw new Error("原初稿尚未读到，可以从本机初稿列表核对。");
      if (!draft.bytes.length || draft.bytes.length > 4_000_000)
        throw new Error("原初稿大小无效，请从原文件重新打开。");
      const destination = forSource(target),
        current = destination.getSnapshot();
      if (destination === origin) return;
      const alreadyRetained =
        current.pendingDraft?.bytes === draft.bytes ||
        current.filePreview?.bytes === draft.bytes;
      if (
        !alreadyRetained &&
        (current.localBusy ||
          current.jobBusy ||
          current.submissionPending ||
          current.job ||
          current.pendingDraft ||
          current.filePreview)
      )
        throw new Error(
          "当前曲目的谱面工作台已有另一份初稿或任务。请先处理，再取回这份初稿。原内容继续保留。",
        );
      if (!alreadyRetained)
        destination.update({
          pendingDraft: {
            ...draft,
            cached: false,
            warning: [
              draft.warning,
              "这份初稿来自上次连接，请重新核对演奏顺序。",
            ]
              .filter(Boolean)
              .join("\n"),
          },
          tab: "notation",
          error: "",
          message: "已取回原初稿，点击核对演奏顺序后可继续处理。",
        });
      // Release only the transferred preview. Other input and original native requests retain their own ownership.
      const latest = origin.getSnapshot();
      origin.update({
        ...(retained.pendingDraft
          ? latest.pendingDraft === retained.pendingDraft
            ? { pendingDraft: null }
            : {}
          : latest.filePreview === retained.filePreview && retained.filePreview
            ? { filePreview: null }
            : {}),
        drafts: latest.drafts.filter((row) => row.id !== draft.previewToken),
        error: "",
        message: "保留的初稿已转入当前连接的谱面工作台。",
        editMessage: "保留的初稿已取回，可从当前曲目继续核对。",
      });
    },
    sessions: () =>
      [...slots].map(([key, slot]) => ({
        key,
        slot,
        state: slot.getSnapshot(),
      })),
    hasWorking: () =>
      [...slots.values()].some((slot) => hasUnretainedWork(slot.getSnapshot())),
    closeSummary: () => {
      const values = [...slots.values()].map((slot) => slot.getSnapshot());
      if (values.some((state) => Object.keys(state.names).length > 0))
        return "谱面工作台还有尚未保存的名称输入，关闭后这些输入会丢失。";
      if (
        values.some((state) =>
          [state.pendingDraft, state.filePreview].some(
            (preview) =>
              preview && (!preview.previewToken || preview.cached !== true),
          ),
        )
      )
        return "还有仅保留在当前窗口中的谱面预览，关闭后需要重新读取或制作。";
      if (
        values.some(
          (state) =>
            state.localBusy ||
            state.jobBusy ||
            state.pdfBusy ||
            state.submissionPending ||
            state.pdfSubmission ||
            state.pdfAdopting,
        )
      )
        return "谱面任务尚未结束，请等待完成或返回查看处理结果。";
      return null;
    },
  };
}
export type ScoreWorkspaceStore = ReturnType<typeof createScoreWorkspaceStore>;
