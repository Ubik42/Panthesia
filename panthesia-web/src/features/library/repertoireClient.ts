import { api } from "../../api";
import type {
  RepertoireEdit,
  RepertoireView,
  NotationCapabilities,
} from "../../engine/commands.generated";
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
const fields = (v: unknown, names: string[]): v is Record<string, string> =>
  object(v) && names.every((n) => typeof v[n] === "string");
function read(value: unknown): RepertoireView {
  if (
    !object(value) ||
    typeof value.revision !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.revision) ||
    !object(value.registry) ||
    !object(value.notationStatuses)
  )
    throw new Error("作品资料回复无效，请刷新后继续。");
  const r = value.registry;
  if (
    Object.values(value.notationStatuses).some(
      (status) =>
        typeof status !== "string" ||
        !["ready", "changed", "missing", "unreadable", "retained"].includes(
          status,
        ),
    )
  )
    throw new Error("谱面文件状态无效，请重新读取。");
  if (
    r.version !== 1 ||
    !object(r.works) ||
    !object(r.performances) ||
    !object(r.notations)
  )
    throw new Error("作品资料版本暂不支持。");
  for (const [id, work] of Object.entries(r.works))
    if (
      !fields(work, ["id", "title", "composer", "catalogue"]) ||
      work.id !== id
    )
      throw new Error("作品资料字段无效。");
  for (const [id, p] of Object.entries(r.performances))
    if (
      !fields(p, ["contentId", "workId", "label"]) ||
      p.contentId !== id ||
      !r.works[p.workId] ||
      !strings(p.locations)
    )
      throw new Error("演奏版本关联无效。");
  for (const [id, n] of Object.entries(r.notations))
    if (
      !fields(n, [
        "id",
        "contentId",
        "performanceId",
        "versionId",
        "name",
        "path",
        "quality",
        "source",
      ]) ||
      n.id !== id ||
      typeof n.registered !== "boolean" ||
      !r.performances[n.performanceId] ||
      !["original", "proofread", "automaticDraft", "unreviewed"].includes(
        n.quality,
      )
    )
      throw new Error("谱面版本资料无效。");
  return value as unknown as RepertoireView;
}
export const readRepertoire = async (path: string, contentId: string) =>
  read(
    await api.command<unknown>({
      type: "readRepertoire",
      path,
      content_id: contentId,
    }),
  );
export const editRepertoire = async (request: RepertoireEdit) =>
  read(await api.command<unknown>({ type: "editRepertoire", request }));
export async function inspectNotation(
  path: string,
  contentId: string,
  versionId: string,
): Promise<NotationCapabilities> {
  const v = await api.command<unknown>({
    type: "inspectNotation",
    path,
    content_id: contentId,
    version_id: versionId,
  });
  if (
    !fields(v, [
      "fingerprint",
      "format",
      "display",
      "analysis",
      "playback",
      "editing",
      "export",
      "identity",
    ]) ||
    !object(v) ||
    !strings(v.issues) ||
    !strings(v.preservedOnly) ||
    !strings(v.formatChanges) ||
    !Number.isSafeInteger(v.writtenNotes) ||
    !Number.isSafeInteger(v.parts)
  )
    throw new Error("谱面能力回复不完整，请重新读取。");
  return v as unknown as NotationCapabilities;
}
