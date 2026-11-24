import type { Metadata } from "./metadataTypes";

export const metadataFields = [
  ["title", "曲名"],
  ["subtitle", "副标题"],
  ["composer", "作曲家"],
  ["arranger", "改编者"],
  ["artist", "演奏者"],
  ["copyright", "版权"],
  ["license", "许可说明"],
  ["collection", "作品集"],
  ["difficulty", "难度"],
  ["tags", "标签"],
  ["source", "来源链接"],
  ["notes", "备注"],
] as const;

export const metadataFieldNames = metadataFields.map(([field]) => field);

// Older saved editor drafts predate descriptive fields; preserve their inputs.
export function completeMetadata(value: Metadata): Metadata {
  return {
    ...value,
    subtitle: value.subtitle ?? null,
    arranger: value.arranger ?? null,
    copyright: value.copyright ?? null,
    license: value.license ?? null,
    source: value.source ?? null,
  };
}
