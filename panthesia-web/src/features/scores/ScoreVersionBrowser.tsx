import { ScoreDocumentPreview, type ScorePreviewDocument } from "./ScoreDocumentPreview";
import { useMemo, useState, useSyncExternalStore } from "react";
import {
  ScoreRoutePreview,
  type ScoreRouteEvidence,
} from "./ScoreRoutePreview";
import { PersistentSessionRecovery } from "../../ui/legacy/PersistentSessionRecovery";
import { PaperListPager } from "./PaperListPager";
import type {
  ScoreManagerDraftSession,
  ScoreNameDraft,
  ScoreVersionRow,
} from "./scoreManagerDraftStore";

export type ScoreOriginalSource = {
  versionId: string;
  status: string;
  path: string;
};
export type ScoreVersionPreview = {
  id: string;
  path: string;
  evidence: ScoreRouteEvidence;
  document?: ScorePreviewDocument;
};
export function ScoreVersionBrowser({
  versions,
  originals,
  session,
  preview,
  busy,
  desktop,
  canPdf,
  loading,
  sourceIssue,
  read,
  previewVersion,
  useVersion,
  openPractice,
  previewVisible = true,
  renameVersion,
  removeVersion,
  linkSource,
  editSource,
  makePdf,
  add,
}: {
  versions: ScoreVersionRow[];
  originals: ScoreOriginalSource[];
  session: ScoreManagerDraftSession;
  preview: ScoreVersionPreview | null;
  busy: boolean;
  desktop: boolean;
  canPdf: boolean;
  loading: boolean;
  sourceIssue?: string;
  read: () => void;
  previewVersion: (row: ScoreVersionRow | null) => void;
  useVersion: (row: ScoreVersionRow, evidence: ScoreRouteEvidence, practice?: boolean) => void;
  openPractice?: () => void;
  previewVisible?: boolean;
  renameVersion: (row: ScoreVersionRow, draft: ScoreNameDraft) => void;
  removeVersion: (row: ScoreVersionRow) => void;
  linkSource: (row: ScoreVersionRow) => void;
  editSource: (row: ScoreVersionRow) => void;
  makePdf: (row: ScoreVersionRow) => void;
  add: () => void;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [editError, setEditError] = useState("");
  const sourceIndex = useMemo(
    () => new Map(originals.map((source) => [source.versionId, source])),
    [originals],
  );
  const filtered = useMemo(() => {
    const query = state.query.trim().toLocaleLowerCase();
    return versions.filter(
      (row) =>
        (!query ||
          [row.name, row.path, state.names[row.id]?.value ?? ""].some((value) =>
            value.toLocaleLowerCase().includes(query),
          )) &&
        (state.filter === "all" ||
          (state.filter === "available" && row.available) ||
          (state.filter === "missing" && !row.available) ||
          (state.filter === "drafts" && !!state.names[row.id])),
    );
  }, [versions, state.query, state.filter, state.names]);
  const page = Math.min(
      state.page,
      Math.max(0, Math.ceil(filtered.length / 12) - 1),
    ),
    visible = filtered.slice(page * 12, page * 12 + 12);
  const selected =
    visible.find((row) => row.id === state.selected) ?? visible[0];
  const draft = selected ? state.names[selected.id] : undefined,
    original = selected ? sourceIndex.get(selected.id) : undefined;
  const evidence =
    selected &&
    preview?.id === selected.id &&
    preview.path === selected.path &&
    selected.available
      ? preview.evidence
      : null;
  const conflict =
    !!selected &&
    !!draft &&
    (draft.base !== selected.name || draft.path !== selected.path);
  const orphans = useMemo(() => {
    const ids = new Set(versions.map((row) => row.id));
    return Object.entries(state.names).filter(([id]) => !ids.has(id));
  }, [versions, state.names]);
  return (
    <div className="score-version-browser">
      {sourceIssue && (
        <p role="status" className="score-version-warning">
          谱面版本已读到，原谱资料暂未更新：{sourceIssue}
          。可重新读取版本后继续使用原谱工具。
        </p>
      )}
      <PersistentSessionRecovery
        store={session}
        error={state.storageError}
        busy={busy}
        label="谱面名称与浏览位置"
      />
      <div className="score-version-browser-heading">
        <div>
          <h3>谱面版本</h3>
          <p>
            {loading
              ? "正在读取谱面…"
              : `${versions.length} 份谱面 · ${versions.filter((row) => row.available).length} 份文件可用`}
          </p>
        </div>
        <button disabled={busy} onClick={read}>
          重新读取版本
        </button>
        <button className="primary" disabled={busy} onClick={add}>
          添加谱面版本
        </button>
      </div>
      <div className="score-version-filter">
        <label>
          查找谱面
          <input
            aria-label="查找谱面版本"
            placeholder="名称或文件位置"
            value={state.query}
            maxLength={1024}
            onChange={(event) =>
              session.browse({ query: event.target.value, page: 0 })
            }
          />
        </label>
        <label>
          显示范围
          <select
            aria-label="谱面版本筛选"
            value={state.filter}
            onChange={(event) =>
              session.browse({
                filter: event.target.value as typeof state.filter,
                page: 0,
              })
            }
          >
            <option value="all">全部版本</option>
            <option value="available">文件可用</option>
            <option value="missing">文件缺失</option>
            <option value="drafts">名称待保存</option>
          </select>
        </label>
      </div>
      <div className="score-version-columns">
        <div
          className="score-version-list"
          aria-label="谱面版本列表"
          onKeyDown={(event) => {
            if (
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              !(event.target as HTMLElement).matches("[data-score-version]") ||
              !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            const buttons = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "[data-score-version]",
                ),
              ],
              index = buttons.indexOf(event.target as HTMLButtonElement);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : Math.max(
                      0,
                      Math.min(
                        buttons.length - 1,
                        index + (event.key === "ArrowUp" ? -1 : 1),
                      ),
                    );
            if (visible[next]) {
              session.browse({ selected: visible[next].id });
              buttons[next]?.focus({ preventScroll: true });
            }
          }}
        >
          <div className="score-version-items">
            {visible.map((row) => (
              <button
                key={row.id}
                type="button"
                data-score-version
                aria-pressed={selected?.id === row.id}
                className={selected?.id === row.id ? "selected" : ""}
                onClick={() => session.browse({ selected: row.id })}
              >
                <span>
                  <strong>{row.name}</strong>
                  <small>
                    {row.active
                      ? row.available
                        ? "当前使用"
                        : "当前关联 · 文件缺失"
                      : row.available
                        ? "已保存"
                        : "文件缺失"}
                    {state.names[row.id] ? " · 名称待保存" : ""}
                  </small>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
          </div>
          {!loading && !visible.length && (
            <div className="score-version-empty">
              {versions.length
                ? "没有符合条件的谱面。"
                : "添加与当前 MIDI 对应的 MusicXML 或 MXL 文件，核对后即可使用。"}
            </div>
          )}
          <PaperListPager
            page={page}
            total={filtered.length}
            size={12}
            label="谱面版本分页"
            change={(page) =>
              session.browse({
                page,
                selected: filtered[page * 12]?.id ?? null,
              })
            }
          />
        </div>
        <section className="score-version-detail" aria-label="所选谱面详情">
          {selected ? (
            <>
              <div className="score-version-current">
                <h3>{selected.name}</h3>
                <span>
                  {selected.active
                    ? selected.available
                      ? "当前使用"
                      : "当前关联 · 文件缺失"
                    : selected.available
                      ? "文件可用"
                      : "文件缺失"}
                </span>
              </div>
              <details className="score-version-file" key={selected.id}>
                <summary>文件位置与名称{draft ? " · 有未保存输入" : ""}</summary>
              <p className="score-version-path">{selected.path}</p>
              <label className="score-version-name">
                谱面名称
                <input
                  aria-label={`谱面名称 ${selected.name}`}
                  maxLength={240}
                  disabled={busy}
                  value={draft?.value ?? selected.name}
                  onChange={(event) => {
                    try {
                      session.editName(selected, event.target.value);
                      setEditError("");
                    } catch (error) {
                      setEditError(
                        error instanceof Error ? error.message : String(error),
                      );
                    }
                  }}
                />
              </label>
              {editError && (
                <p role="status" className="score-version-warning">
                  {editError}
                </p>
              )}
              {draft && (
                <div className="score-version-name-status">
                  <span>
                    {conflict
                      ? `已保存名称或文件位置已改变，当前名称：${selected.name}`
                      : "名称输入已暂存在本机。"}
                  </span>
                  {conflict && (
                    <button
                      disabled={busy}
                      onClick={() => session.acceptCurrentBase(selected)}
                    >
                      已核对，保留此输入
                    </button>
                  )}
                  <button
                    disabled={
                      busy ||
                      conflict ||
                      !draft.value.trim() ||
                      Array.from(draft.value.trim()).length > 120
                    }
                    onClick={() => renameVersion(selected, draft)}
                  >
                    保存名称
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => session.clearName(selected.id, draft)}
                  >
                    采用已保存名称
                  </button>
                </div>
              )}
              </details>
              <div className="score-version-main-actions">
                <button
                  disabled={busy || !selected.available}
                  onClick={() => previewVersion(evidence ? null : selected)}
                >
                  {evidence ? "收起谱面预览" : "预览谱面"}
                </button>
                <button
                  disabled={
                    busy ||
                    selected.active ||
                    !selected.available ||
                    evidence?.route?.complete !== true
                  }
                  onClick={() => evidence && useVersion(selected, evidence)}
                >
                  {selected.active ? "正在使用" : "使用此谱面"}
                </button>
                {openPractice && <button className="primary" disabled={busy || !selected.available || (!selected.active && evidence?.route?.complete !== true)}
                  onClick={() => selected.active ? openPractice() : evidence && useVersion(selected, evidence, true)}>
                  {selected.active ? "打开谱面演奏" : "使用并打开演奏"}
                </button>}
              </div>
              {previewVisible && evidence && preview?.document && <ScoreDocumentPreview {...preview.document} />}
              {!selected.available && (
                <p className="score-version-warning">
                  原文件当前不可用。可重新添加相同谱面，或从原谱工具核对文件位置。
                </p>
              )}
              {evidence && <details className="score-manager-route">
                <summary>演奏顺序 · {evidence.route?.complete ? "顺序完整" : "需要核对"} · 对应 {Math.round(evidence.coverage)}%</summary>
                <ScoreRoutePreview evidence={evidence} title={`${selected.name} · 演奏顺序`} />
              </details>}
              {desktop && (
                <div className="score-version-source-actions">
                  <h4>原谱与排版</h4>
                  <p>
                    {original
                      ? `原谱状态：${({ ready: "可编辑", changed: "内容已更新", missing: "文件缺失", unreadable: "暂时无法读取", acknowledged: "已保留现有版本" } as Record<string, string>)[original.status] ?? "待核对"}`
                      : "关联可编辑原谱后，可在 MuseScore 中修改或生成 PDF。"}
                  </p>
                  <button
                    disabled={busy || !selected.available}
                    onClick={() => linkSource(selected)}
                  >
                    关联原谱文件
                  </button>
                  {original && (
                    <button
                      disabled={busy}
                      onClick={() => editSource(selected)}
                    >
                      在 MuseScore 中编辑原谱
                    </button>
                  )}
                  {canPdf && original && (
                    <button
                      disabled={busy || original.status !== "ready"}
                      onClick={() => makePdf(selected)}
                    >
                      生成 PDF 谱面
                    </button>
                  )}
                </div>
              )}
              <div className="score-version-remove">
                <button
                  disabled={busy || selected.active}
                  onClick={() => removeVersion(selected)}
                >
                  移除这个版本
                </button>
                <small>从版本列表移除，原文件继续保留。</small>
              </div>
            </>
          ) : (
            <p className="parameter-help">
              从左侧选择谱面，查看顺序、名称和原谱工具。
            </p>
          )}
        </section>
      </div>
      {!!orphans.length && !loading && (
        <details className="score-version-orphans">
          <summary>未匹配到版本的名称输入 · {orphans.length} 份</summary>
          <p>原输入继续保留；版本重新出现后可接续编辑。</p>
          {orphans.map(([id, draft]) => (
            <div key={id}>
              <span>
                {draft.base} → {draft.value}
              </span>
              <small>{draft.path}</small>
              <button
                disabled={busy}
                onClick={() => session.clearName(id, draft)}
              >
                移除此输入
              </button>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
