import { taskStageLabel } from "../../engine/taskStages";
import { api, type SongRow, type CollectionSong } from "../../api";
import {
  createPreparationSession,
  type PreparedIntent,
} from "../activity/preparationSession";
import {
  PreparationPhaseValues,
  type LibraryOpenSource,
  type LibraryOpenRequest,
  type LibraryOpenReceipt,
  type LibraryPrepared,
  type LibraryOpenView,
} from "../../engine/commands.generated";
import { libraryOpenCommand, type LibraryOpenLocation } from "./libraryOpen";
import type { LibraryScoreVisitSelection } from "../../LibraryScoresPane";

export type LibraryOpenWorkspace = "library" | "practice" | "review";
export interface LibraryOpenIntent extends PreparedIntent<LibraryOpenRequest> {
  workspace?: LibraryOpenWorkspace;
  path: string;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 4096): value is string =>
  typeof value === "string" && value.length <= max;
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const phase = (value: unknown) =>
  PreparationPhaseValues.some((phase) => phase === value);
const pathKey = (value: string) => value.replaceAll("\\", "/").toLowerCase();
function validSource(value: unknown): value is LibraryOpenSource {
  if (!object(value)) return false;
  const identity = (value: unknown) => text(value, 160) && value.length > 0;
  const path = (value: unknown) => text(value, 32768) && value.length > 0;
  if (value.kind === "originalScore")
    return (
      path(value.path) &&
      integer(value.defaultBpm) &&
      value.defaultBpm >= 20 &&
      value.defaultBpm <= 400
    );
  if (value.kind === "recent") return identity(value.contentId);
  if (value.kind === "relocated")
    return (
      path(value.path) &&
      text(value.title) &&
      identity(value.contentId) &&
      (value.from == null || path(value.from))
    );
  if (value.kind === "file")
    return (
      path(value.path) &&
      text(value.title) &&
      (value.contentId == null || identity(value.contentId))
    );
  if (value.kind === "recording") return path(value.path);
  if (
    value.kind !== "score" ||
    !path(value.path) ||
    !identity(value.contentId) ||
    !identity(value.id) ||
    !["notation", "paper"].includes(String(value.scoreKind))
  )
    return false;
  if (value.selection == null) return true;
  const selection = value.selection;
  const visit = (value: unknown) =>
    object(value) &&
    integer(value.ordinal) &&
    value.ordinal < 20000 &&
    integer(value.measure) &&
    value.measure < 20000 &&
    typeof value.start === "number" &&
    Number.isFinite(value.start) &&
    typeof value.end === "number" &&
    Number.isFinite(value.end) &&
    value.start >= 0 &&
    value.end > value.start;
  return (
    value.scoreKind === "notation" &&
    object(selection) &&
    visit(selection.first) &&
    visit(selection.last) &&
    Number((selection.first as Record<string, unknown>).ordinal) <=
      Number((selection.last as Record<string, unknown>).ordinal) &&
    ["loop", "range"].includes(String(selection.mode)) &&
    typeof selection.fingerprint === "string" &&
    /^[a-f0-9]{64}$/i.test(selection.fingerprint)
  );
}
export const librarySourceKey = (source: LibraryOpenSource) =>
  JSON.stringify(
    source.kind === "originalScore"
      ? [source.kind, pathKey(source.path), source.defaultBpm]
      : source.kind === "file" || source.kind === "relocated"
        ? [
            source.kind,
            pathKey(source.path),
            source.contentId ?? null,
            source.title,
          ]
        : source.kind === "recent"
          ? [source.kind, source.contentId]
          : source.kind === "recording"
            ? [source.kind, pathKey(source.path)]
            : [
                source.kind,
                pathKey(source.path),
                source.contentId,
                source.scoreKind,
                source.id,
                source.selection
                  ? [
                      source.selection.first.ordinal,
                      source.selection.first.measure,
                      source.selection.first.start,
                      source.selection.first.end,
                      source.selection.last.ordinal,
                      source.selection.last.measure,
                      source.selection.last.start,
                      source.selection.last.end,
                      source.selection.mode,
                      source.selection.fingerprint,
                    ]
                  : null,
              ],
  );
function validRequest(value: unknown): value is LibraryOpenRequest {
  return (
    object(value) &&
    text(value.engineId, 160) &&
    value.engineId.length > 0 &&
    typeof value.id === "string" &&
    /^[A-Za-z0-9_-]{8,96}$/.test(value.id) &&
    integer(value.createdAtMs) &&
    object(value.origin) &&
    (value.origin.contentId == null || text(value.origin.contentId, 160)) &&
    integer(value.origin.scoreRevision) &&
    integer(value.origin.midiEvents) &&
    text(value.origin.status, 32) &&
    validSource(value.source)
  );
}
function validIntent(value: unknown): value is LibraryOpenIntent {
  return (
    object(value) &&
    validRequest(value.request) &&
    (value.workspace === undefined ||
      value.workspace === "library" ||
      value.workspace === "practice" ||
      value.workspace === "review") &&
    text(value.title) &&
    text(value.path, 32768) &&
    ["pending", "kept", "presented"].includes(String(value.disposition)) &&
    (value.lastPhase === "unknown" || phase(value.lastPhase)) &&
    text(value.error) &&
    (value.releasePending == null || typeof value.releasePending === "boolean")
  );
}
function sameRequest(left: LibraryOpenRequest, right: LibraryOpenRequest) {
  return (
    left.id === right.id &&
    left.engineId === right.engineId &&
    left.createdAtMs === right.createdAtMs &&
    (left.origin.contentId ?? null) === (right.origin.contentId ?? null) &&
    left.origin.scoreRevision === right.origin.scoreRevision &&
    left.origin.midiEvents === right.origin.midiEvents &&
    left.origin.status === right.origin.status &&
    librarySourceKey(left.source) === librarySourceKey(right.source)
  );
}
function requestedView(source: LibraryOpenSource): LibraryOpenView {
  if (source.kind !== "score") return "practice";
  if (source.scoreKind === "paper") return "paper";
  return source.selection?.mode === "range" ? "range" : "notation";
}
function checkReceipt(value: LibraryOpenReceipt, intent: LibraryOpenIntent) {
  const result = value?.result?.libraryPrepared;
  if (
    !value ||
    !validRequest(value.request) ||
    !sameRequest(value.request, intent.request) ||
    !phase(value.phase) ||
    typeof value.cancellable !== "boolean" ||
    typeof value.hasResult !== "boolean" ||
    !text(value.stage, 160) ||
    (value.phase === "done" && !value.hasResult) ||
    (value.result &&
      (!result ||
        !validSource(result.source) ||
        librarySourceKey(result.source) !==
          librarySourceKey(intent.request.source) ||
        !text(result.contentId, 160) ||
        !result.contentId ||
        (intent.request.source.kind !== "recording" &&
          intent.request.source.kind !== "originalScore" &&
          intent.request.source.contentId != null &&
          intent.request.source.contentId !== result.contentId) ||
        (result.sourcePath != null && !text(result.sourcePath, 32768)) ||
        (result.importWarnings != null &&
          (!Array.isArray(result.importWarnings) ||
            !result.importWarnings.every((warning) => text(warning, 65536)))) ||
        !integer(result.scoreRevision) ||
        result.view !== requestedView(intent.request.source)))
  )
    throw new Error("曲目打开结果与原请求不一致，请核对当前练习后继续。");
}
function createStore() {
  const base = createPreparationSession<
    LibraryOpenRequest,
    LibraryOpenIntent,
    LibraryOpenReceipt
  >({
    key: "neothesia.library-opens.v1",
    validIntent,
    checkReceipt,
    subject: (intent) => librarySourceKey(intent.request.source),
    start: (request) =>
      api.commandForEngine(request.engineId, {
        type: "startLibraryOpen",
        request,
      }),
    read: (engineId, id, metadataOnly) =>
      api.commandForEngine(engineId, {
        type: "readLibraryOpen",
        id,
        metadata_only: metadataOnly,
      }),
    cancel: (engineId, id) =>
      api.commandForEngine(engineId, { type: "cancelLibraryOpen", id }),
    release: (engineId, id) =>
      api.commandForEngine(engineId, { type: "releaseLibraryOpen", id }),
  });
  return {
    ...base,
    async create(
      source: LibraryOpenSource,
      title: string,
      path: string,
      engineId?: string,
      canAdmit?: () => boolean,
      workspace: LibraryOpenWorkspace = "library",
    ) {
      const current = await api.state();
      if (canAdmit && !canAdmit())
        throw new Error("已离开原曲目，这次打开尚未提交。");
      const origin = engineId ?? current.stateOrder?.engineId;
      if (!origin || current.stateOrder?.engineId !== origin)
        throw new Error("练习室连接已变化，请重新读取曲库后打开。");
      return base.add(
        {
          request: {
            engineId: origin,
            id: `library-${crypto.randomUUID()}`,
            createdAtMs: Date.now(),
            origin: {
              contentId: current.contentId ?? null,
              scoreRevision: current.scoreRevision ?? 0,
              midiEvents: current.midiEvents,
              status: current.status,
            },
            source,
          },
          title,
          path,
          workspace,
          disposition: "pending",
          lastPhase: "unknown",
          error: "",
        },
        canAdmit,
      );
    },
  };
}
let store: ReturnType<typeof createStore> | undefined;
export const getLibraryOpens = () => (store ??= createStore());
export function sourceForLibraryRow(
  row: SongRow,
  expectedContentId?: string,
  location: LibraryOpenLocation = "selected",
  recent?: Pick<CollectionSong, "contentId" | "generated">,
): LibraryOpenSource {
  if (row.id.startsWith("recording/"))
    return { kind: "recording", path: row.path };
  const command = libraryOpenCommand(row, expectedContentId, location, recent);
  return command.type === "openRecent"
    ? { kind: "recent", contentId: command.content_id }
    : {
        kind: "file",
        path: command.path,
        title: command.title,
        contentId: command.type === "loadIndexed" ? command.content_id : null,
      };
}
export function sourceForLibraryScore(
  row: SongRow,
  contentId: string,
  kind: "notation" | "paper",
  id: string,
  selection?: LibraryScoreVisitSelection,
): LibraryOpenSource {
  const visit = (value: LibraryScoreVisitSelection["first"]) => ({
    ordinal: value.ordinal,
    measure: value.measure,
    start: value.start,
    end: value.end,
  });
  return {
    kind: "score",
    path: row.path,
    contentId,
    scoreKind: kind,
    id,
    selection: selection
      ? {
          first: visit(selection.first),
          last: visit(selection.last),
          mode: selection.mode,
          fingerprint: selection.fingerprint,
        }
      : null,
  };
}
export function libraryOpenLabel(source: LibraryOpenSource) {
  return source.kind === "originalScore"
    ? "打开本地乐谱"
    : source.kind === "relocated"
      ? "重新定位并打开曲目"
      : source.kind === "score"
        ? source.selection
          ? "原谱小节练习"
          : source.scoreKind === "paper"
            ? "打开纸谱"
            : "打开演奏乐谱"
        : source.kind === "recording"
          ? "打开录音"
          : "打开曲目";
}
export function checkLibraryPrepared(
  value: LibraryPrepared,
  engineId: string,
  snapshot: import("../../api").Snapshot,
) {
  if (
    snapshot.stateOrder?.engineId !== engineId ||
    snapshot.contentId !== value.contentId ||
    snapshot.scoreRevision !== value.scoreRevision
  )
    throw new Error(
      "当前练习已与原打开结果不同，请先核对当前曲目。原打开记录继续保留。",
    );
  if (value.view !== "practice" && snapshot.mode === "memory")
    throw new Error(
      "当前已切换为背谱模式。可按原选择重新打开谱面，原操作记录继续保留。",
    );
  const selection =
    value.source.kind === "score" ? value.source.selection : null;
  if (selection && ["recital", "memory"].includes(snapshot.mode))
    throw new Error(
      "当前已切换为完整演奏，原小节练习结果继续保留。可按原选择重新打开。",
    );
  if (
    selection?.mode === "loop" &&
    (!snapshot.passage ||
      Math.abs(snapshot.passage.start - selection.first.start) > 0.001 ||
      Math.abs(snapshot.passage.end - selection.first.end) > 0.001)
  )
    throw new Error(
      "当前循环范围已改变，原打开记录继续保留。可按原选择重新打开这次小节。",
    );
}
export function libraryOpenPending() {
  const state = getLibraryOpens().getSnapshot();
  return (
    state.storageError ||
    (state.entries.some(
      (intent) =>
        intent.disposition !== "presented" &&
        state.receipts[intent.request.id]?.warning,
    )
      ? "曲目打开结果的回执尚未写入，可先接续结果或复制记录。"
      : null)
  );
}

export function libraryOpenProgress(phase: string, stage?: string) {
  if (phase === "done") return "曲目与所选谱面已准备，可接续打开结果。";
  if (phase === "released") return "已接续练习，打开结果缓存已释放。";
  if (phase === "cancelled") return "这次打开已取消，可以继续选择曲目。";
  if (phase === "error") return "这次打开未完成，请查看原因后重新选择曲目。";
  if (phase === "unconfirmed") return "原操作结果待核对，请先查看当前练习。";
  return stage ? taskStageLabel(stage) : "原打开请求已保留，可读取进度后继续。";
}
