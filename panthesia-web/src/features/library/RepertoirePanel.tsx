import { useEffect, useRef, useState } from "react";
import { editRepertoire, readRepertoire } from "./repertoireClient";
import { NotationCapabilitiesView } from "../scores/NotationCapabilitiesView";
import { SongProjectSummary } from "../scores/SongProjectSummary";
import type {
  RepertoireView,
  ScoreQuality,
} from "../../engine/commands.generated";

const qualities: Record<ScoreQuality, string> = {
  original: "原谱",
  proofread: "已校对",
  automaticDraft: "自动初稿",
  unreviewed: "待核对",
};
const statuses: Record<string, string> = {
  ready: "文件可用",
  changed: "来源内容已变化",
  missing: "文件缺失",
  unreadable: "文件暂不可读",
  retained: "历史版本资料保留",
};
export function RepertoirePanel({
  contentId,
  path,
  blocked,
}: {
  contentId?: string | null;
  path: string;
  blocked: boolean;
}) {
  const [view, setView] = useState<RepertoireView | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [title, setTitle] = useState(""),
    [composer, setComposer] = useState(""),
    [catalogue, setCatalogue] = useState(""),
    [target, setTarget] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setView(null);
    setBusy(false);
    setError("");
  }, [contentId, path]);
  const accept = (next: RepertoireView) => {
    setView(next);
    const performance = contentId && next.registry.performances[contentId];
    if (performance) {
      const work = next.registry.works[performance.workId];
      setTitle(work.title);
      setComposer(work.composer);
      setCatalogue(work.catalogue);
      setTarget(work.id);
    }
  };
  const run = async (action: () => Promise<RepertoireView>) => {
    const current = generation.current;
    setBusy(true);
    setError("");
    try {
      const next = await action();
      if (current === generation.current) accept(next);
    } catch (e) {
      if (current === generation.current) setError(String(e));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  const performance = contentId
    ? view?.registry.performances[contentId]
    : undefined;
  const work = performance
    ? view?.registry.works[performance.workId]
    : undefined;
  const editions = Object.values(view?.registry.notations ?? {}).filter(
    (n) => n.performanceId === contentId,
  ).sort((a,b) => Number(b.registered)-Number(a.registered) || a.name.localeCompare(b.name,"zh-CN"));
  const dirty = !!work && (title !== work.title || composer !== work.composer || catalogue !== work.catalogue);
  const siblings = Object.values(view?.registry.performances ?? {}).filter(
    (p) => work && p.workId === work.id,
  );
  return (
    <section
      className="browse-detail-block repertoire-panel"
      aria-label="作品与版本关系"
    >
      <h4>歌曲与演奏版本</h4>
      <p className="parameter-help">
        同一作品可以关联多个演奏版本。练习历史、指法和文件位置继续按各自内容保存。
      </p>
      {!view ? (
        <button
          disabled={
            blocked || busy || !contentId || path.startsWith("exercise:")
          }
          onClick={() => run(() => readRepertoire(path, contentId!))}
        >
          {busy ? "正在读取…" : "查看歌曲与版本"}
        </button>
      ) : (
        <>
          {view.project && <SongProjectSummary project={view.project}/>}
          <div className="repertoire-form">
            <label>
              作品标题
              <input
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy || blocked}
              />
            </label>
            <label>
              作曲者
              <input
                value={composer}
                maxLength={160}
                onChange={(e) => setComposer(e.target.value)}
                disabled={busy || blocked}
              />
            </label>
            <label>
              作品号
              <input
                value={catalogue}
                maxLength={100}
                onChange={(e) => setCatalogue(e.target.value)}
                disabled={busy || blocked}
              />
            </label>
            <button
              disabled={busy || blocked || !title.trim()}
              onClick={() =>
                run(() =>
                  editRepertoire({
                    expected: view.revision,
                    contentId: contentId!,
                    title,
                    composer,
                    catalogue,
                  }),
                )
              }
            >
              保存作品资料
            </button>
            <label>
              关联到作品
              <select
                value={target}
                disabled={busy || blocked || dirty}
                onChange={(e) => setTarget(e.target.value)}
              >
                {Object.values(view.registry.works)
                  .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"))
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.title}
                      {w.composer ? ` · ${w.composer}` : ""}
                      {w.id === `work-${contentId}` ? "（本版本独立作品）" : ""}
                    </option>
                  ))}
              </select>
            </label>
            <button
              disabled={busy || blocked || dirty || !target || target === work?.id}
              onClick={() =>
                run(() =>
                  editRepertoire({
                    expected: view.revision,
                    contentId: contentId!,
                    workId: target,
                  }),
                )
              }
            >
              确认关联作品
            </button>
          </div>
          {dirty && <p role="status">作品资料尚未保存。保存后可切换关联或刷新。<button disabled={busy || blocked} onClick={() => accept(view)}>放弃本次编辑</button></p>}
          <p>
            此作品已登记 {siblings.length} 个演奏版本，当前版本有{" "}
            {performance ? performance.locations.length : 0} 个文件位置。
          </p>
          <ul>
            {siblings.map((p) => (
              <li key={p.contentId}>
                {p.label || "未命名演奏"}
                {p.contentId === contentId ? " · 当前版本" : ""}
                <small className="file-path">{p.contentId.slice(0, 16)}</small>
              </li>
            ))}
          </ul>
          {!!performance && (
            <details>
              <summary>当前演奏的文件位置</summary>
              {performance.locations.map((location) => (
                <p className="file-path" key={location}>
                  {location}
                </p>
              ))}
            </details>
          )}
          {editions.length ? (
            editions.map((n) => (
              <div
                key={`${n.id}:${view.revision}`}
                className="repertoire-notation"
              >
                <strong>{n.name}</strong>
                <span>
                  {statuses[
                    view.notationStatuses[n.id] ??
                      (n.registered ? "ready" : "retained")
                  ] ?? "待检查文件"}
                </span>
                <small className="file-path">{n.path}</small>
                <label>
                  谱面状态
                  <select
                    defaultValue={n.quality}
                    disabled={busy || blocked || dirty}
                    onChange={(e) =>
                      run(() =>
                        editRepertoire({
                          expected: view.revision,
                          contentId: contentId!,
                          notationId: n.id,
                          quality: e.target.value as ScoreQuality,
                        }),
                      )
                    }
                  >
                    {Object.entries(qualities).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  来源与校对说明
                  <input
                    defaultValue={n.source}
                    maxLength={2000}
                    disabled={busy || blocked || dirty}
                    onBlur={(e) => {
                      if (e.target.value !== n.source) {
                        const source = e.target.value;
                        void run(() =>
                          editRepertoire({
                            expected: view.revision,
                            contentId: contentId!,
                            notationId: n.id,
                            source,
                          }),
                        );
                      }
                    }}
                  />
                </label>
                <NotationCapabilitiesView
                  path={path}
                  contentId={contentId!}
                  versionId={n.versionId}
                  blocked={
                    blocked || busy || view.notationStatuses[n.id] !== "ready"
                  }
                />
              </div>
            ))
          ) : (
            <p className="parameter-help">
              当前演奏尚无已保存的配对谱。可在“乐谱”中添加原谱，自动转换结果应标为初稿。
            </p>
          )}
          <button
            disabled={busy || blocked || dirty}
            onClick={() => run(() => readRepertoire(path, contentId!))}
          >
            刷新版本资料
          </button>
        </>
      )}
      {error && (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
