import type { ReactNode } from "react";
import { RepertoirePanel } from "./RepertoirePanel";
import { clock, type CollectionSong, type SongRow } from "../../api";
import { BrowseDetailWorkspace } from "../../app/BrowseDetailWorkspace";
import type { Entry } from "../../libraryQuery";
import {
  activeDeadline,
  learningStages,
  type SongLearning,
} from "../../songLearning";
import type { LibraryDetailSection } from "./libraryBrowse";

export interface LibraryDetailAction {
  label: string;
  run: () => void;
  disabled: boolean;
  title?: string;
}

function Action({
  action,
  primary = false,
}: {
  action: LibraryDetailAction;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      className={primary ? "primary" : undefined}
      disabled={action.disabled}
      title={action.title}
      onClick={action.run}
    >
      {action.label}
    </button>
  );
}

export function LibrarySongDetail({
  row,
  entry,
  learning,
  review,
  reviewReason,
  today,
  section,
  changeSection,
  blocked,
  open,
  history,
  learn,
  fileActions,
  scores,
  time,
  editor,
  notice,
}: {
  row: SongRow;
  entry: Entry | null | undefined;
  learning?: SongLearning;
  review: CollectionSong["review"];
  reviewReason: string;
  today: string;
  section: LibraryDetailSection;
  changeSection: (section: LibraryDetailSection) => void;
  blocked: boolean;
  open: LibraryDetailAction;
  history?: LibraryDetailAction;
  learn: LibraryDetailAction;
  fileActions: readonly LibraryDetailAction[];
  scores: ReactNode;
  time: ReactNode;
  editor: ReactNode;
  notice?: string;
}) {
  const title = entry?.metadata.title ?? row.title;
  const composer = entry?.metadata.composer ?? row.composer;
  const missing = entry?.available === false;
  const generated = row.path.startsWith("exercise:");
  const state = missing
    ? "文件缺失"
    : entry?.error
      ? "文件需处理"
      : entry?.contentId
        ? "已建立索引"
        : generated
          ? "内置生成练习"
          : "待检查文件";
  return (
    <BrowseDetailWorkspace<LibraryDetailSection>
      label="曲目详情分类"
      value={section}
      change={changeSection}
      header={
        <>
          <h3
            className="browse-detail-heading"
            title={title}
            tabIndex={-1}
            data-browse-detail-heading
          >
            {title}
          </h3>
          <p className="browse-detail-subtitle">
            {composer || (generated ? "内置技术练习" : "未填写作曲者")}
            {entry?.contentId
              ? ` · ${clock(entry.duration)} · ${entry.measures} 小节`
              : ""}
          </p>
          <div className="browse-detail-actions">
            <Action action={open} primary />
            {history && <Action action={history} />}
            {(missing || entry?.error) && (
              <button
                type="button"
                disabled={blocked}
                onClick={() => changeSection("files")}
              >
                处理文件问题
              </button>
            )}
          </div>
        </>
      }
      sections={[
        {
          id: "overview",
          label: "概览与目标",
          content: (
            <>
              <div className="library-detail-facts">
                <span
                  className="browse-detail-status"
                  data-problem={missing || !!entry?.error || undefined}
                >
                  {state}
                </span>
                {entry?.metadata.difficulty && (
                  <span>难度 {entry.metadata.difficulty}</span>
                )}
                {!!entry?.rating && (
                  <span aria-label={`评级 ${entry.rating} 星`}>
                    {"★".repeat(entry.rating)}
                  </span>
                )}
              </div>
              <div className="browse-detail-block">
                <div className="library-detail-section-heading">
                  <h4>学习目标</h4>
                  <Action action={learn} />
                </div>
                {learning ? (
                  <section
                    className="library-learning-summary"
                    aria-label="当前曲目学习资料"
                  >
                    <strong>
                      {learningStages[learning.stage] ?? "学习目标"}
                    </strong>
                    <p>
                      {learning.due
                        ? `目标日期：${learning.due}`
                        : "未设置目标日期"}
                      {activeDeadline(learning) && learning.due! < today
                        ? " · 已逾期"
                        : ""}
                    </p>
                    {learning.weeklyMinutes != null &&
                      learning.weeklyMinutes > 0 && (
                        <p>每周计划 {learning.weeklyMinutes} 分钟</p>
                      )}
                    {learning.targetBpm != null && learning.targetBpm > 0 && (
                      <p>目标速度 {learning.targetBpm} BPM</p>
                    )}
                    {learning.goal && (
                      <p className="learning-goal-text">{learning.goal}</p>
                    )}
                  </section>
                ) : (
                  <p className="parameter-help">
                    可以设置目标日期、每周练习时间和目标速度。
                  </p>
                )}
              </div>
              {review && (
                <div className="browse-detail-block library-review-status">
                  <h4>{review.due ? "现在待复习" : "建议复习时间"}</h4>
                  {review.dueAt != null && (
                    <p>{new Date(review.dueAt).toLocaleString("zh-CN")}</p>
                  )}
                  <p>{reviewReason}</p>
                  {review.due && (
                    <Action action={{ ...open, label: "开始复习" }} />
                  )}
                </div>
              )}
              <div className="browse-detail-block">
                {time || (
                  <p className="parameter-help">
                    检查文件并建立内容索引后，可查看练习时间。
                  </p>
                )}
              </div>
            </>
          ),
        },
        {
          id: "scores",
          label: "乐谱",
          count: entry?.contentId
            ? (entry.notationCount ?? 0) + (entry.paperCount ?? 0)
            : undefined,
          content: (
            <>
              {scores || (
                <div className="browse-detail-empty">
                  <strong>先确认曲目文件</strong>
                  <span>
                    检查 MIDI 并建立内容索引后，可以添加和管理演奏乐谱、PDF
                    与图片谱面。
                  </span>
                  <button
                    disabled={blocked}
                    onClick={() => changeSection("files")}
                  >
                    查看文件与资料
                  </button>
                </div>
              )}
            </>
          ),
        },
        {
          id: "files",
          label: "文件与资料",
          content: (
            <>
              {missing && (
                <p className="browse-detail-note">
                  原文件暂时不可用。已保存的练习记录和曲目资料继续保留，可重新定位
                  MIDI 文件。
                </p>
              )}
              {entry?.error && (
                <p className="dialog-error" role="alert">
                  {entry.error}
                </p>
              )}
              <div className="library-detail-file-actions">
                {fileActions.map((action) => (
                  <Action key={action.label} action={action} />
                ))}
              </div>
              {notice && (
                <p className="library-detail-action-result" role="status">
                  {notice}
                </p>
              )}
              {editor}
              <RepertoirePanel key={entry?.contentId ?? row.path} contentId={entry?.contentId ?? row.contentId} path={row.path} blocked={blocked} />
              <section className="browse-detail-block">
                <h4>{generated ? "练习来源" : "文件位置"}</h4>
                <p className="file-path">
                  {generated
                    ? "由内置技术练习生成，重新打开时按已保存参数恢复。"
                    : row.path}
                </p>
                <p className="library-source-line">
                  <strong>{row.source || "本地文件"}</strong>
                  {row.category && ` · ${row.category}`}
                  {row.source === "GiantMIDI-Piano" && (
                    <span>自动转录，拍号和声部需校对</span>
                  )}
                  {row.license && <span>许可：{row.license}</span>}
                </p>
                {entry?.scoreName && (
                  <p className="file-path">配对乐谱：{entry.scoreName}</p>
                )}
              </section>
              <section className="browse-detail-block">
                <h4>曲目资料</h4>
                <dl className="library-detail-data">
                  {[
                    ["作曲者", composer || "未填写"],
                    ["演奏者", entry?.metadata.artist || "未填写"],
                    ["曲集", entry?.metadata.collection || "未填写"],
                    [
                      "难度",
                      entry?.metadata.difficulty ?? row.difficulty ?? "未填写",
                    ],
                    [
                      "标签",
                      (entry?.metadata.tags ?? row.tags ?? []).join(" · ") ||
                        "未填写",
                    ],
                    ["音符", entry?.contentId ? entry.notes : "待检查"],
                    ["声部音轨", entry?.contentId ? entry.tracks : "待检查"],
                    ["拍号", entry?.meter || "未记录"],
                    [
                      "文件大小",
                      generated
                        ? "不适用"
                        : entry
                          ? `${Math.round(entry.size / 1024)} KB`
                          : "待检查",
                    ],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                {entry?.metadata.notes && (
                  <div className="library-detail-notes">
                    <h4>曲目备注</h4>
                    <p>{entry.metadata.notes}</p>
                  </div>
                )}
              </section>
            </>
          ),
        },
      ]}
    />
  );
}
