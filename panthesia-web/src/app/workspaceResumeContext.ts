import type { LibraryBrowse } from "../features/library/libraryBrowse";
import type { HistoryBrowse } from "../features/review/historyBrowse";
import { handName, modeName } from "../features/review/historyPresentation";
import { learningStages } from "../songLearning";

const queryLabel = (query: string) => {
  const value = query.trim();
  return value
    ? `搜索：${value.length > 80 ? `${value.slice(0, 80)}…` : value}`
    : "";
};
const compactFilters = (values: string[]) => {
  const active = values.filter(Boolean);
  return [
    ...active.slice(0, 3),
    ...(active.length > 3 ? [`另有 ${active.length - 3} 项筛选`] : []),
  ];
};

/** A navigation hint describes the saved view, without presenting cached scores as current results. */
export function libraryResumeContext(browse: LibraryBrowse | undefined) {
  if (!browse) return "";
  const view = browse.view;
  const filters = compactFilters([
    queryLabel(view.query),
    (
      {
        score: "已配乐谱",
        missing: "文件缺失",
        duplicates: "重复内容",
        unindexed: "尚未索引",
        errors: "需要处理",
      } as Record<string, string>
    )[view.filter] ?? "",
    (
      {
        played: "已有成绩",
        unplayed: "尚无成绩",
        favorite: "收藏",
        review: "待复习",
      } as Record<string, string>
    )[view.practice] ?? "",
    learningStages[view.learning] ??
      (
        {
          untracked: "未设目标",
          overdue: "目标已逾期",
          today: "今日目标",
        } as Record<string, string>
      )[view.learning] ??
      "",
    browse.group ? "分组筛选" : "",
    browse.recordings ? "自由演奏录音" : "",
    browse.selectionOnly ? "仅看所选" : "",
    view.minRating ? `至少 ${view.minRating} 星` : "",
    view.minDuration || view.maxDuration ? "时长筛选" : "",
  ]);
  return [
    browse.pane === "detail"
      ? (
          {
            overview: "曲目概览",
            scores: "曲目乐谱",
            files: "文件与资料",
          } as const
        )[browse.detailSection ?? "overview"]
      : "",
    ...filters,
    browse.selected.length ? `已选 ${browse.selected.length} 首` : "",
    browse.page ? `第 ${browse.page + 1} 页` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function historyResumeContext(browse: HistoryBrowse | undefined) {
  if (!browse) return "";
  const filters = browse.filters;
  const active = compactFilters([
    queryLabel(filters.query),
    filters.mode ? modeName(filters.mode) : "",
    filters.hands ? handName(filters.hands) : "",
    filters.range ? (filters.range === "whole" ? "全曲" : "选段") : "",
    filters.days
      ? filters.days === 1
        ? "最近 24 小时"
        : `最近 ${filters.days} 天`
      : filters.from !== null || filters.to !== null
        ? "指定日期"
        : "",
  ]);
  return [
    browse.pane === "detail"
      ? (
          {
            results: "演奏成绩",
            performance: "演奏回放",
            comparison: "同条件对比",
            annotation: "练习评语",
          } as const
        )[browse.detailSection ?? "results"]
      : "",
    ...active,
    browse.offset ? `第 ${Math.floor(browse.offset / 50) + 1} 页` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
