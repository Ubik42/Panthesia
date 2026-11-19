import { CalendarDateInput } from "../../app/CalendarDateInput";
import { editDraftValue } from "../editing/editDraftStore";
import { useEffect, useId, useState } from "react";
import { X } from "lucide-react";
import { BrowseDetailWorkspace } from "../../app/BrowseDetailWorkspace";
import { BrowsePagination } from "../../app/BrowsePagination";
import { useCloseParticipant } from "../../app/closePreparation";
import { EditDraftStatus } from "../editing/EditDraftStatus";
import { CopyPracticeDraft } from "../practice/CopyPracticeDraft";
import { TaskActivity } from "../../engine/TaskActivity";
import { PracticeTimePanel } from "../../PracticeTimePanel";
import { LearningEvidencePanel } from "../../LearningEvidencePanel";
import { learningStages, type SongLearning } from "../../songLearning";
import {
  learningInputs,
  type LearningEditDraft,
  type LearningInputs,
  type LearningSection,
} from "./learningDraft";
import { useLearningEditor } from "./useLearningEditor";
import "./songLearningEditor.css";

const fields = [
  { key: "stage", label: "学习阶段" },
  { key: "due", label: "目标日期" },
  { key: "weeklyMinutes", label: "每周计划分钟" },
  { key: "targetBpm", label: "目标速度 BPM" },
  { key: "goal", label: "目标与达标要求" },
] as const;
export function SongLearningDialog({
  path,
  contentId,
  title,
  previous,
  close,
  changed,
  draftMemory,
  engineId,
}: {
  path: string;
  contentId: string;
  title: string;
  previous: SongLearning | null;
  close: () => void;
  changed: () => Promise<void>;
  draftMemory?: Map<string, LearningEditDraft>;
  engineId?: string;
}) {
  const editor = useLearningEditor({
    path,
    contentId,
    title,
    previous,
    changed,
    memory: draftMemory,
    engineId,
  });
  const formId = useId(),
    [discard, setDiscard] = useState(false),
    [historyPage, setHistoryPage] = useState(0);
  const [choices, setChoices] = useState<
    Partial<Record<keyof LearningInputs, "mine" | "latest">>
  >({});
  useEffect(() => setChoices({}), [editDraftValue(editor.latest)]);
  const frozen =
    editor.busy || editor.reading || !!editor.pending || editor.conflict;
  const latest = learningInputs(editor.latest),
    original = learningInputs(editor.base);
  const pick = (key: keyof LearningInputs) =>
    choices[key] ??
    (editor.inputs[key] === latest[key] || latest[key] === original[key]
      ? "mine"
      : editor.inputs[key] === original[key]
        ? "latest"
        : undefined);
  const unresolved = fields.some(({ key }) => !pick(key));
  const update = (patch: Partial<LearningInputs>) =>
    editor.change({ ...editor.inputs, ...patch });
  const attemptClose = () => {
    if (draftMemory || (!editor.busy && !editor.dirty && !editor.pending))
      close();
    else if (!editor.busy) setDiscard(true);
  };
  useCloseParticipant("曲目学习输入", () =>
    editor.busy
      ? "学习资料仍在处理，请稍后继续退出。"
      : !draftMemory && (editor.dirty || editor.pending)
        ? "学习输入仍保留在当前窗口，可复制或保存后退出。"
        : null,
  );
  const transitions = [
    ...(editor.latest?.transitions ?? editor.base?.transitions ?? []),
  ].reverse();
  const page = Math.min(
    historyPage,
    Math.max(0, Math.ceil(transitions.length / 12) - 1),
  );
  const labelValue = (key: keyof LearningInputs, value: string) =>
    key === "stage" ? (learningStages[value] ?? value) : value || "未设置";
  return (
    <div
      className="modal-backdrop song-learning-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) attemptClose();
      }}
    >
      <section
        className="settings-dialog song-learning-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="song-learning-title"
        aria-busy={editor.busy || editor.reading}
      >
        <BrowseDetailWorkspace<LearningSection>
          value={editor.section}
          change={editor.changeSection}
          label="曲目学习分区"
          header={
            <>
              <div className="dialog-heading">
                <div>
                  <h2 id="song-learning-title">曲目学习</h2>
                  <p>{title}</p>
                </div>
                <button
                  autoFocus
                  aria-label="关闭曲目学习"
                  disabled={!draftMemory && editor.writing}
                  onClick={attemptClose}
                >
                  <X size={18} />
                </button>
              </div>
              <p className="browse-detail-subtitle">
                同内容的文件副本共用学习资料。阶段由你确认，练习记录用于对照目标。
              </p>
              <EditDraftStatus
                drafts={draftMemory}
                visible={editor.dirty || !!editor.pending}
                phase={
                  editor.pending?.phase === "refresh"
                    ? "saved"
                    : editor.pending
                      ? "unconfirmed"
                      : "draft"
                }
              />
              <div className="browse-detail-actions">
                <button
                  className="primary"
                  type="submit"
                  form={formId}
                  disabled={
                    frozen ||
                    !editor.verified ||
                    !!editor.inputError ||
                    (!!editor.base && !editor.dirty)
                  }
                >
                  保存学习资料
                </button>
                <button
                  disabled={editor.busy || editor.reading}
                  onClick={() => void editor.refresh()}
                >
                  {editor.reading ? "正在读取…" : "读取最新资料"}
                </button>
                {(editor.dirty || editor.pending) && (
                  <CopyPracticeDraft
                    label="复制学习目标输入"
                    value={editor.copy()}
                  />
                )}
              </div>
              {editor.error && (
                <p
                  className="dialog-error learning-editor-message"
                  role="alert"
                >
                  {editor.error}
                </p>
              )}
              {editor.notice && (
                <p className="learning-editor-message" role="status">
                  {editor.notice}
                </p>
              )}
            </>
          }
          sections={[
            {
              id: "plan",
              label: "学习目标",
              content: (
                <>
                  <TaskActivity
                    contentId={contentId}
                    label={["读取学习资料", "保存学习资料"]}
                    cancelLabel="取消准备或读取"
                  />
                  {editor.pending && (
                    <section className="learning-editor-receipt">
                      <p>
                        {editor.pending.phase === "refresh"
                          ? "保存回复已保留，请读取实际资料后完成核对。"
                          : "原提交回复尚未确认，输入和提交条件继续保留。"}
                      </p>
                      <div className="dialog-actions">
                        <button
                          disabled={editor.busy || editor.reading}
                          onClick={() => void editor.finish()}
                        >
                          读取结果并完成
                        </button>
                        {editor.pending.phase === "unconfirmed" && (
                          <button
                            disabled={
                              editor.busy || editor.reading || !editor.verified
                            }
                            onClick={() => void editor.retry()}
                          >
                            按原条件重试
                          </button>
                        )}
                        <button
                          disabled={
                            editor.busy || editor.reading || !editor.verified
                          }
                          onClick={() => editor.continueEditing()}
                        >
                          保留输入继续编辑
                        </button>
                      </div>
                    </section>
                  )}
                  {editor.conflict && !editor.pending && (
                    <section
                      className="learning-editor-conflict"
                      aria-label="学习目标修改核对"
                    >
                      <p>已保存资料有更新。请逐项选择要保留的内容。</p>
                      {fields
                        .filter(({ key }) => editor.inputs[key] !== latest[key])
                        .map(({ key, label }) => (
                          <div className="learning-merge-field" key={key}>
                            <strong>{label}</strong>
                            <p>
                              当前输入：{labelValue(key, editor.inputs[key])}
                            </p>
                            <p>最新资料：{labelValue(key, latest[key])}</p>
                            <select
                              aria-label={`${label}合并选择`}
                              value={pick(key) ?? ""}
                              onChange={(event) =>
                                setChoices((old) => ({
                                  ...old,
                                  [key]: event.target.value as
                                    "mine" | "latest",
                                }))
                              }
                            >
                              <option value="" disabled>
                                请选择
                              </option>
                              <option value="mine">保留当前输入</option>
                              <option value="latest">采用最新资料</option>
                            </select>
                          </div>
                        ))}
                      <div className="dialog-actions">
                        <button
                          disabled={editor.busy || unresolved}
                          onClick={() => {
                            const merged = Object.fromEntries(
                              fields.map(({ key }) => [
                                key,
                                pick(key) === "latest"
                                  ? latest[key]
                                  : editor.inputs[key],
                              ]),
                            ) as unknown as LearningInputs;
                            editor.continueEditing(merged);
                            setChoices({});
                          }}
                        >
                          合并到输入
                        </button>
                        <button
                          disabled={editor.busy}
                          onClick={editor.adoptLatest}
                        >
                          采用最新资料
                        </button>
                      </div>
                    </section>
                  )}
                  <form
                    id={formId}
                    noValidate
                    onSubmit={(event) => {
                      event.preventDefault();
                      void editor.save();
                    }}
                  >
                    <div className="song-learning-fields">
                      <label>
                        学习阶段
                        <select
                          aria-label="曲目学习阶段"
                          value={editor.inputs.stage}
                          disabled={frozen}
                          onChange={(event) =>
                            update({ stage: event.target.value })
                          }
                        >
                          {Object.entries(learningStages).map(
                            ([key, label]) => (
                              <option key={key} value={key}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      <label>
                        目标日期
                        <CalendarDateInput
                          label="曲目目标日期"
                          disabled={frozen}
                          value={editor.inputs.due}
                          change={(due) => update({ due })}
                        />
                        <small>年-月-日，留空表示未设置</small>
                      </label>
                      <label>
                        每周计划 · 分钟
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={16}
                          aria-label="曲目每周计划分钟"
                          placeholder="未设置"
                          disabled={frozen}
                          value={editor.inputs.weeklyMinutes}
                          onChange={(event) =>
                            update({ weeklyMinutes: event.target.value })
                          }
                        />
                        <small>1–10080，留空表示未设置</small>
                      </label>
                      <label>
                        目标速度 · BPM
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={16}
                          aria-label="曲目目标速度"
                          placeholder="未设置"
                          disabled={frozen}
                          value={editor.inputs.targetBpm}
                          onChange={(event) =>
                            update({ targetBpm: event.target.value })
                          }
                        />
                        <small>20–300，留空表示未设置</small>
                      </label>
                    </div>
                    <label className="song-learning-goal">
                      目标与达标要求
                      <textarea
                        aria-label="曲目学习目标"
                        maxLength={2000}
                        rows={5}
                        disabled={frozen}
                        value={editor.inputs.goal}
                        onChange={(event) =>
                          update({ goal: event.target.value })
                        }
                      />
                    </label>
                    {editor.inputError && (
                      <p className="dialog-error" role="status">
                        {editor.inputError}
                      </p>
                    )}
                    {editor.base && (
                      <p className="parameter-help">
                        移除学习资料会清除本曲的目标和阶段变更，练习成绩继续保留。可先复制当前输入与原资料。
                      </p>
                    )}
                    <div className="dialog-actions">
                      <button
                        type="button"
                        disabled={editor.busy || !editor.verified}
                        onClick={editor.adoptLatest}
                      >
                        还原为已保存资料
                      </button>
                      {editor.discarded && (
                        <button
                          type="button"
                          disabled={
                            editor.busy || editor.dirty || !!editor.pending
                          }
                          onClick={editor.undoDiscard}
                        >
                          撤销本次还原
                        </button>
                      )}
                      {editor.base && (
                        <button
                          type="button"
                          disabled={frozen || !editor.verified}
                          onClick={() => void editor.save(true)}
                        >
                          移除学习资料
                        </button>
                      )}
                    </div>
                  </form>
                </>
              ),
            },
            {
              id: "evidence",
              label: "练习证据",
              content: (
                <>
                  <PracticeTimePanel
                    contentId={contentId}
                    targetMinutes={editor.value.weeklyMinutes}
                    active={editor.section === "evidence" && !!editor.engineId}
                    engineId={editor.engineId}
                  />
                  <LearningEvidencePanel
                    contentId={contentId}
                    targetBpm={editor.value.targetBpm}
                    targetMinutes={editor.value.weeklyMinutes}
                    draftChanged={editor.dirty || !!editor.inputError}
                    active={editor.section === "evidence" && !!editor.engineId}
                    engineId={editor.engineId}
                  />
                </>
              ),
            },
            {
              id: "history",
              label: "阶段变更",
              count: transitions.length,
              content: (
                <section className="learning-transition-list">
                  <h3>阶段变更</h3>
                  {!transitions.length && <p>尚未保存阶段变更。</p>}
                  {transitions
                    .slice(page * 12, page * 12 + 12)
                    .map((transition, index) => (
                      <article key={page * 12 + index}>
                        <header>
                          <strong>
                            {learningStages[transition.stage] ??
                              transition.stage}
                          </strong>
                          <time>
                            {new Date(transition.at * 1000).toLocaleString(
                              "zh-CN",
                            )}
                          </time>
                        </header>
                        {transition.plan && (
                          <p>
                            {transition.plan.goal || "未填写目标说明"} · 每周{" "}
                            {transition.plan.weeklyMinutes ?? "未设置"} 分钟 ·{" "}
                            {transition.plan.targetBpm ?? "未设置"} BPM
                          </p>
                        )}
                        {transition.evidence ? (
                          <p>
                            当时实际练习{" "}
                            {Math.round(
                              transition.evidence.week.runningMs / 60000,
                            )}{" "}
                            分钟 ·{" "}
                            {transition.evidence.week.met
                              ? "达到当时的时长计划"
                              : "时长计划尚未达到或未设置"}{" "}
                            ·{" "}
                            {transition.evidence.wholeSong.targetBpmMet
                              ? "有达到目标速度的整曲记录"
                              : "目标速度尚未达到或未设置"}{" "}
                            · 日期计划完成{" "}
                            {transition.evidence.routines.completedCount} 项
                          </p>
                        ) : (
                          <p>旧记录未保存当时的练习证据。</p>
                        )}
                      </article>
                    ))}
                  <BrowsePagination
                    page={page}
                    total={transitions.length}
                    pageSize={12}
                    disabled={false}
                    label="阶段变更"
                    unit="次"
                    change={setHistoryPage}
                  />
                </section>
              ),
            },
          ]}
        />
        {discard && (
          <div className="dialog-actions">
            <span>当前输入只保留在此窗口。</span>
            <button disabled={editor.busy} onClick={close}>
              放弃输入并关闭
            </button>
            <button onClick={() => setDiscard(false)}>继续编辑</button>
          </div>
        )}
        <div className="dialog-actions learning-editor-footer">
          <span>
            {draftMemory
              ? "关闭后可从未提交输入继续。"
              : "保存后可保留本次修改。"}
          </span>
          <button
            disabled={!draftMemory && editor.writing}
            onClick={attemptClose}
          >
            {draftMemory ? "关闭并保留输入" : "关闭"}
          </button>
        </div>
      </section>
    </div>
  );
}
