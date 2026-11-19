import type {
  PaperAttachment,
  PaperNoteAnchor,
  PracticeContext,
  HistoryPaperFocus,
} from "./paperTypes";
import { paperAnchorAt } from "./paperNavigationIndex";

export function paperNoteAnchor(
  attachment: PaperAttachment,
  practice: PracticeContext,
  focus: HistoryPaperFocus,
): PaperNoteAnchor | null {
  if (focus.index == null || !Number.isSafeInteger(focus.index)) return null;
  const anchor = attachment.noteAnchors?.find(
    (item) =>
      item.track === focus.track &&
      item.index === focus.index &&
      item.pitch === focus.pitch &&
      item.measure === focus.measure &&
      item.grid === practice.grid,
  );
  if (!anchor) return null;
  const asset =
    attachment.format === "pdf"
      ? attachment.pages[0]
      : attachment.pages[anchor.page - 1];
  return asset?.id === anchor.assetId && asset.available ? anchor : null;
}
export function historyMappingIssue(
  attachment: PaperAttachment,
  practice: PracticeContext,
  focus: HistoryPaperFocus,
): string | null {
  if (paperNoteAnchor(attachment, practice, focus)) return null;
  if (!attachment.mapping?.anchors.length) return "尚未设置小节与谱页对应";
  if (attachment.mapping.grid !== practice.grid)
    return "小节位置已改变，映射需要重新核对";
  const anchor = paperAnchorAt(attachment.mapping.anchors, focus.measure);
  if (!anchor) return `第 ${focus.measure} 小节之前没有纸谱对应点`;
  if (
    attachment.format === "images" &&
    !attachment.pages[anchor.page - 1]?.available
  )
    return `第 ${anchor.page} 页图片不可用`;
  if (attachment.format === "pdf" && !attachment.pages[0]?.available)
    return "PDF 文件不可用";
  return null;
}
