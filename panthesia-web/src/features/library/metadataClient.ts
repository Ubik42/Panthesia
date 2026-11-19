import { metadataFieldNames } from "./metadataFields";
import { api } from "../../api";
import type { Rules } from "../../metadataTemplates";
import type {
  Metadata,
  MetadataDefaults,
  MetadataField,
  MetadataHistory,
  MetadataRestorePreview,
  MetadataSaveReply,
} from "./metadataTypes";

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const contentIdentity = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{64}$/i.test(value);
const metadata = (value: unknown): value is Metadata =>
  object(value) &&
  metadataFieldNames.filter((field) => field !== "tags").every(
    (field) => value[field] === null || typeof value[field] === "string",
  ) &&
  Array.isArray(value.tags) &&
  value.tags.every((tag) => typeof tag === "string");

function identity(
  reply: unknown,
  expected: string | null,
): asserts reply is Record<string, unknown> & { contentId: string } {
  if (
    !object(reply) ||
    !contentIdentity(reply.contentId) ||
    (expected !== null && reply.contentId !== expected)
  )
    throw new Error("返回资料与所选曲目不一致，请重新读取原文件。");
}

export async function readLibraryMetadata(
  path: string,
  expected: string | null,
) {
  const reply = await api.command<unknown>({
    type: "readLibraryMetadata",
    path,
    content_id: expected,
  });
  identity(reply, expected);
  return metadataDefaultsReply(reply, reply.contentId);
}

export function metadataDefaultsReply(reply: unknown, contentId: string): MetadataDefaults {
  identity(reply, contentId);
  const layers = reply.layers;
  if (!metadata(reply.value) || !contentIdentity(reply.proof) ||
    (layers !== null && (!object(layers) || layers.sourceFormat !== "synthesia" ||
      !contentIdentity(layers.sourceId) || !metadata(layers.defaults) || !fieldList(layers.overridden))))
    throw new Error("资料来源读取不完整，请重新读取。");
  return reply as unknown as MetadataDefaults;
}

export async function resetLibraryMetadataDefaults(path: string, contentId: string,
  fields: MetadataField[], expected: Metadata, proof: string): Promise<MetadataSaveReply> {
  return savedReply(await api.command<unknown>({ type: "resetLibraryMetadataDefaults", path,
    content_id: contentId, fields, expected, proof }), contentId);
}

export async function previewLibraryMetadata(
  path: string,
  expected: string | null,
  rules: Rules,
) {
  const reply = await api.command<unknown>({
    type: "previewLibraryMetadata",
    path,
    content_id: expected,
    rules,
  });
  identity(reply, expected);
  if (!metadata(reply.base) || !metadata(reply.value))
    throw new Error("资料预览不完整，原修改尚未提交。");
  return { contentId: reply.contentId, base: reply.base, value: reply.value };
}

export async function saveLibraryMetadata(
  path: string,
  contentId: string,
  value: Metadata,
  expected: Metadata,
): Promise<MetadataSaveReply> {
  const reply = await api.command<unknown>({
    type: "saveLibraryMetadata",
    path,
    content_id: contentId,
    value,
    expected,
  });
  return savedReply(reply, contentId);
}

export async function restoreLibraryMetadata(
  path: string,
  contentId: string,
  id: string,
  fields: string[],
  expected: Metadata,
): Promise<MetadataSaveReply> {
  const reply = await api.command<unknown>({
    type: "restoreLibraryMetadata",
    path,
    content_id: contentId,
    id,
    fields,
    expected,
  });
  return savedReply(reply, contentId);
}

function savedReply(reply: unknown, contentId: string): MetadataSaveReply {
  identity(reply, contentId);
  if (
    (reply.status !== "saved" && reply.status !== "conflict") ||
    (reply.status === "saved"
      ? !metadata(reply.value)
      : !metadata(reply.current)) ||
    (reply.warnings !== undefined &&
      (!Array.isArray(reply.warnings) ||
        !reply.warnings.every((warning) => typeof warning === "string")))
  )
    throw new Error("保存回执不完整，请读取实际资料后核对结果。");
  return reply as unknown as MetadataSaveReply;
}

const fieldList = (value: unknown): value is MetadataField[] =>
  Array.isArray(value) &&
  value.length <= metadataFieldNames.length &&
  new Set(value).size === value.length &&
  value.every((field) =>
    metadataFieldNames.includes(field),
  );

export async function readMetadataHistory(
  path: string,
  contentId: string,
): Promise<MetadataHistory> {
  const reply = await api.command<unknown>({
    type: "libraryMetadataHistory",
    path,
    content_id: contentId,
  });
  identity(reply, contentId);
  if (
    !Array.isArray(reply.records) ||
    reply.records.length > 200 ||
    typeof reply.retention !== "number" ||
    !Number.isSafeInteger(reply.retention) ||
    reply.retention < 0 ||
    typeof reply.available !== "boolean" ||
    (reply.error !== null && typeof reply.error !== "string") ||
    !reply.records.every(
      (record) =>
        object(record) &&
        contentIdentity(record.id) &&
        record.contentId === contentId &&
        typeof record.timeMs === "number" &&
        Number.isSafeInteger(record.timeMs) &&
        record.timeMs >= 0 &&
        metadata(record.before) &&
        metadata(record.after) &&
        typeof record.state === "string" &&
        ["prepared", "applied", "failed"].includes(record.state) &&
        (record.restoredFrom === null ||
          contentIdentity(record.restoredFrom)) &&
        fieldList(record.fields) &&
        typeof record.matchesCurrent === "boolean",
    )
  )
    throw new Error("资料修改历史读取不完整，已保留当前内容，请重新读取。");
  return reply as unknown as MetadataHistory;
}

export async function previewMetadataRestore(
  path: string,
  contentId: string,
  id: string,
): Promise<MetadataRestorePreview> {
  const reply = await api.command<unknown>({
    type: "previewMetadataRestore",
    path,
    content_id: contentId,
    id,
  });
  identity(reply, contentId);
  if (
    reply.historyId !== id ||
    !metadata(reply.base) ||
    !metadata(reply.value) ||
    !metadata(reply.after) ||
    !fieldList(reply.fields) ||
    !fieldList(reply.conflicts) ||
    !reply.conflicts.every((field) =>
      (reply.fields as MetadataField[]).includes(field),
    )
  )
    throw new Error("恢复预览与所选历史不一致或内容不完整，请重新读取。");
  return reply as unknown as MetadataRestorePreview;
}
