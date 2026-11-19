import type { Annotation, HistoryEntry } from "./historyTypes";
export type AnnotationText = Pick<Annotation, "note" | "teacher" | "next">;
export interface AnnotationDraft {
  base: Annotation | null;
  draft: AnnotationText;
  entry?: HistoryEntry;
  field?: keyof AnnotationText;
  pending?: {
    phase: "unconfirmed" | "refresh";
    value: AnnotationText;
    expected: Annotation | null;
    engineId?: string;
  };
}
export const annotationFields = [
  { key: "note", label: "练习备注" },
  { key: "teacher", label: "教师评语" },
  { key: "next", label: "下次重点" },
] as const;
export const annotationText = (value: Annotation | null): AnnotationText => ({
  note: value?.note ?? "",
  teacher: value?.teacher ?? "",
  next: value?.next ?? "",
});
export function annotationInputError(value: AnnotationText): string {
  for (const { key, label } of annotationFields)
    if (new TextEncoder().encode(value[key]).length > 8192)
      return `${label}超过 8192 字节，请缩短后保存。`;
  return "";
}

// Keep the small archive header, not the complete feedback/detail payload.
export function annotationEntry(value: HistoryEntry): HistoryEntry {
  return {
    annotation: value.annotation,
    id: value.id,
    contentId: value.contentId,
    title: value.title,
    path: value.path,
    recordedAt: value.recordedAt,
    playingMs: value.playingMs,
    speed: value.speed,
    hands: value.hands,
    mode: value.mode,
    coverage: value.coverage,
    range: value.range,
    exactPassage: value.exactPassage,
    score: value.score,
    restorable: value.restorable,
    tempo: value.tempo,
  };
}
