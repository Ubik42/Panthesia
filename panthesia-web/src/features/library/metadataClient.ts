import { metadataFieldNames } from "./metadataFields";
import type { Metadata, MetadataDefaults, MetadataField } from "./metadataTypes";

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
const fieldList = (value: unknown): value is MetadataField[] =>
  Array.isArray(value) &&
  value.length <= metadataFieldNames.length &&
  new Set(value).size === value.length &&
  value.every((field) => metadataFieldNames.includes(field));

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

export function metadataDefaultsReply(reply: unknown, contentId: string): MetadataDefaults {
  identity(reply, contentId);
  const layers = reply.layers;
  if (!metadata(reply.value) || !contentIdentity(reply.proof) ||
    (layers !== null && (!object(layers) || layers.sourceFormat !== "synthesia" ||
      !contentIdentity(layers.sourceId) || !metadata(layers.defaults) || !fieldList(layers.overridden))))
    throw new Error("资料来源读取不完整，请重新读取。");
  return reply as unknown as MetadataDefaults;
}
