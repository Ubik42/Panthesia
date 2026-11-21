import type { PassagePreset } from "../../engine/commands.generated";
import type { EditorForm } from "./practiceEditorStore";

export const integerInput = (text: string | undefined) =>
  text && /^\d+$/.test(text) && Number.isSafeInteger(Number(text))
    ? Number(text)
    : NaN;
export const passageForm = (row: PassagePreset): EditorForm => ({
  name: row.name,
  first: String(row.start),
  last: String(row.end),
  notes: row.notes,
});
export const newPassageForm = (start: number, end: number): EditorForm => ({
  name: "",
  first: String(start),
  last: String(end),
  notes: "",
});
export const validMeasureRange = (first: number, last: number, total: number) =>
  Number.isInteger(first) &&
  Number.isInteger(last) &&
  first >= 1 &&
  first <= last &&
  last <= total;

