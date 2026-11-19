import { requireValue } from "./engine/requireValue";
import { useEffect, useRef, useState } from "react";
import type { ScoreSourceClient } from "./features/scores/scoreSourceClient";
import type { Preview, Source } from "./ScoreSourcesDialog";
import { ScoreRoutePreview } from "./ScoreRoutePreview";
import "./features/scores/scoreConversion.css";

type Choice = "skip" | "notation" | "performance" | "keep";
type Item = {
  source: Source;
  preview?: Preview;
  choice: Choice;
  state: "waiting" | "ready" | "failed" | "done";
  detail: string;
  failedAt?: "preview" | "apply";
};

export function ScoreSourceBatch({
  sources,
  client,
  run,
  busy,
  changed,
  close,
}: {
  sources: Source[];
  client: ScoreSourceClient;
  run: (job: () => Promise<void>) => Promise<void>;
  busy: boolean;
  changed: () => Promise<void>;
  close: () => void;
}) {
  const [items, setItems] = useState<Item[]>(() =>
    sources.map((source) => ({
      source,
      choice: "skip",
      state: "waiting",
      detail: "等待预览",
    })),
  );
  const [phase, setPhase] = useState("待预览"),
    [prepared, setPrepared] = useState(false);
  const [refreshPending, setRefreshPending] = useState(false);
  const cancelled = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    cancelled.current = false;
    return () => {
      alive.current = false;
      cancelled.current = true;
    };
  }, []);
  const replace = (id: string, patch: Partial<Item>) =>
    alive.current &&
    setItems((current) =>
      current.map((item) =>
        item.source.id === id ? { ...item, ...patch } : item,
      ),
    );
  const prepare = () =>
    void run(async () => {
      cancelled.current = false;
      setPhase("正在预览");
      for (const item of items.filter(
        (item) =>
          item.state === "waiting" ||
          (item.state === "failed" && item.failedAt === "preview"),
      )) {
        if (cancelled.current) break;
        try {
          const preview = await client.preview(
            item.source.id,
            requireValue(item.source.fingerprint, "原谱指纹"),
          );
          replace(item.source.id, {
            preview,
            state: "ready",
            failedAt: undefined,
            detail: "已预览，请选择处理方式",
          });
        } catch (error) {
          replace(item.source.id, {
            state: "failed",
            failedAt: "preview",
            detail: String(error),
          });
        }
      }
      if (alive.current) {
        setPrepared(true);
        setPhase(cancelled.current ? "预览已停止" : "预览完成");
      }
    });
  const apply = () =>
    void run(async () => {
      cancelled.current = false;
      setPhase("正在处理");
      let saved = false;
      for (const item of items.filter(
        (item) => item.state === "ready" && item.choice !== "skip",
      )) {
        if (cancelled.current) break;
        try {
          if (
            item.choice === "performance" &&
            (!item.preview?.performanceReady ||
              item.preview.routePreview?.route?.complete !== true)
          )
            throw new Error("演奏顺序尚未确认，本项只能保存谱面版本");
          let warnings: string[] = [];
          if (item.choice === "keep")
            await client.keep(item.source.id, item.preview!.fingerprint);
          else
            warnings = (
              await client.apply(
                item.source.id,
                item.preview!.fingerprint,
                item.choice === "performance" ? "performance" : "notation",
              )
            ).warnings;
          saved = true;
          replace(item.source.id, {
            state: "done",
            failedAt: undefined,
            detail: [
              item.choice === "keep"
                ? "已保留当前版本"
                : item.choice === "performance"
                  ? "已生成并打开演奏曲目"
                  : "已保存新谱面版本",
              ...warnings,
            ].join("；"),
          });
        } catch (error) {
          replace(item.source.id, {
            state: "failed",
            failedAt: "apply",
            detail: String(error),
          });
        }
      }
      if (alive.current)
        setPhase(cancelled.current ? "已停止，完成项已保留" : "处理完成");
      if (saved) {
        if (alive.current) setRefreshPending(true);
        try {
          await changed();
          if (alive.current) setRefreshPending(false);
        } catch (error) {
          if (alive.current)
            setPhase(
              (current) =>
                `${current}；完成项已保存，曲库状态暂未同步：${String(error)}`,
            );
        }
      }
    });
  const refreshSaved = () =>
    void run(async () => {
      try {
        await changed();
        setRefreshPending(false);
        setPhase("已重新读取保存结果");
      } catch (failure) {
        setRefreshPending(true);
        setPhase(`完成项已保存，界面更新尚未完成：${String(failure)}`);
      }
    });
  const remaining = items.filter(
    (item) =>
      item.state === "waiting" ||
      (item.state === "failed" && item.failedAt === "preview"),
  ).length;
  const actionable = items.filter(
    (item) => item.state === "ready" && item.choice !== "skip",
  ).length;
  return (
    <section className="score-source-batch" aria-label="批量原谱更新">
      <header>
        <h3>批量原谱更新 · {items.length} 个版本</h3>
        <span role="status">
          {phase} · {items.filter((item) => item.state === "done").length}{" "}
          个已完成
        </span>
      </header>
      <p className="parameter-help">
        先核对每份原谱，再逐项选择处理方式，默认跳过。添加谱面或保留版本不切换当前演奏；生成演奏会依次打开，结束后停留在最后成功生成的曲目，旧曲目和资料继续保留。
      </p>
      <div className="dialog-actions">
        {remaining > 0 && (
          <button disabled={busy} onClick={prepare}>
            {prepared ? `继续读取未完成预览 · ${remaining}` : "生成逐项预览"}
          </button>
        )}
        <button
          disabled={busy || !prepared}
          onClick={() =>
            setItems((current) =>
              current.map((item) =>
                item.state === "ready" ? { ...item, choice: "notation" } : item,
              ),
            )
          }
        >
          已预览项添加新谱面
        </button>
        <button
          disabled={busy || !prepared}
          onClick={() =>
            setItems((current) =>
              current.map((item) =>
                item.state === "ready" ? { ...item, choice: "keep" } : item,
              ),
            )
          }
        >
          已预览项保留当前版本
        </button>
        <button
          disabled={busy || !prepared}
          onClick={() =>
            setItems((current) =>
              current.map((item) =>
                item.state === "ready" ? { ...item, choice: "skip" } : item,
              ),
            )
          }
        >
          全部跳过
        </button>
      </div>
      {refreshPending && (
        <div className="score-conversion-warning" role="status">
          <p>完成项已保存，曲库界面更新尚未完成。</p>
          <button disabled={busy} onClick={refreshSaved}>
            重新读取保存结果
          </button>
        </div>
      )}
      <div className="score-source-batch-items">
        {items.map((item) => (
          <article key={item.source.id} data-batch-source-id={item.source.id}>
            <div>
              <strong>
                {item.source.songTitle} · {item.source.name}
              </strong>
              <p className="source-path" title={item.source.path}>
                {item.source.path.replace(/^\\\\\?\\/, "")}
              </p>
              {item.preview && (
                <p>
                  {item.preview.performanceReady
                    ? `${item.preview.notes} 个演奏音符 · ${item.preview.samePerformance ? "演奏内容相同" : "演奏内容不同"}`
                    : `${item.preview.writtenNotes} 个书面谱音 · 演奏暂无法生成`}
                  {item.preview.pairing
                    ? ` · 旧演奏对应 ${item.preview.pairing.coverage}%`
                    : " · 旧演奏不可用"}
                </p>
              )}
              {item.preview?.performanceError && (
                <p className="parameter-help">
                  {item.preview.performanceError}
                </p>
              )}
              {item.preview && (
                <ScoreRoutePreview
                  evidence={item.preview.routePreview}
                  title="更新后谱面的实际演奏顺序"
                  initialVisible={8}
                />
              )}
              {[
                ...(item.preview?.warnings ?? []),
                ...(item.preview?.pairing?.diagnostics ?? []),
              ].map((warning, index) => (
                <p className="parameter-help" key={index}>
                  {warning}
                </p>
              ))}
              <p
                className={
                  item.state === "failed" ? "dialog-error" : "parameter-help"
                }
              >
                {item.detail}
              </p>
              {item.state === "failed" && item.failedAt === "apply" && (
                <p className="parameter-help">
                  请返回原谱列表，核对原文件和已有版本后再处理这一项。
                </p>
              )}
            </div>
            <select
              aria-label={`处理方式：${item.source.songTitle} · ${item.source.name}`}
              disabled={busy || item.state !== "ready"}
              value={item.choice}
              onChange={(event) =>
                replace(item.source.id, {
                  choice: event.target.value as Choice,
                })
              }
            >
              <option value="skip">跳过</option>
              <option value="notation">添加新谱面版本</option>
              <option
                value="performance"
                disabled={
                  !item.preview?.performanceReady ||
                  item.preview.routePreview?.route?.complete !== true
                }
              >
                生成并打开演奏曲目
              </option>
              <option value="keep">保留当前版本</option>
            </select>
          </article>
        ))}
      </div>
      <div className="dialog-actions">
        <button
          className="primary-button"
          disabled={busy || !actionable}
          onClick={apply}
        >
          执行所选处理 · {actionable}
        </button>
        {busy && (
          <button
            onClick={() => {
              cancelled.current = true;
              setPhase("正在停止，等待当前项完成");
            }}
          >
            停止批次
          </button>
        )}
        <button disabled={busy} onClick={close}>
          返回原谱列表
        </button>
      </div>
      <p className="parameter-help">
        每项执行前重新核对原文件。失败项保留原资料并列出原因，其他项继续；停止后保留已完成项。
      </p>
    </section>
  );
}
