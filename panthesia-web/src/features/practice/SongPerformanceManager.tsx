import { useState } from "react";
import { Layers3 } from "lucide-react";
import type { RepertoireView } from "../../engine/commands.generated";
import { editRepertoire } from "../library/repertoireClient";

export function SongPerformanceManager({
  view,
  disabled,
  change,
  open,
  embedded = false,
}: {
  view: RepertoireView;
  disabled: boolean;
  change: (operation: () => Promise<unknown>) => Promise<void>;
  open: (path: string, contentId: string, label: string) => Promise<unknown>;
  embedded?: boolean;
}) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState("");
  const project = view.project;
  if (!project) return null;
  const siblings = Object.values(view.registry.performances).filter(
    (row) => row.workId === project.work.id,
  );
  const candidates = Object.values(view.registry.performances)
    .filter(
      (row) =>
        row.workId !== project.work.id &&
        row.locations.length &&
        [
          row.label,
          view.registry.works[row.workId]?.title ?? "",
          ...row.locations,
        ].some((text) =>
          text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
        ),
    )
    .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
  const target = candidates.find((row) => row.contentId === selected);
  const Container = embedded ? "section" : "details";
  return (
    <Container className="song-performance-manager">
      {!embedded && (
        <summary>
          <Layers3 size={15} />
          管理演奏版本 <span>{siblings.length} 份</span>
        </summary>
      )}
      <div className="song-performance-body">
        <section aria-label="当前歌曲的演奏版本">
          <h3>{project.work.title}</h3>
          <p>各演奏版本分别保存谱面、练习条件和历史。</p>
          <ul>
            {siblings.map((row) => (
              <li key={row.contentId}>
                <span>
                  <strong>{row.label || "演奏版本"}</strong>
                  <small>
                    {row.contentId === project.performance.contentId
                      ? embedded
                        ? "当前选择"
                        : "当前演奏"
                      : row.locations[0] || "文件待定位"}
                  </small>
                </span>
                {row.contentId !== project.performance.contentId && (
                  <button
                    disabled={disabled || !row.locations.length}
                    onClick={() =>
                      void change(() =>
                        open(row.locations[0], row.contentId, row.label),
                      )
                    }
                  >
                    切换
                  </button>
                )}
                {siblings.length > 1 && (
                  <button
                    disabled={disabled}
                    onClick={() =>
                      void change(() =>
                        editRepertoire({
                          expected: view.revision,
                          contentId: row.contentId,
                          independent: true,
                        }),
                      )
                    }
                  >
                    设为独立歌曲
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="添加同歌演奏版本">
          <h3>添加另一份演奏</h3>
          <label>
            查找曲库中的 MIDI
            <input
              aria-label="查找演奏版本"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected("");
              }}
              placeholder="曲名或文件位置"
            />
          </label>
          <select
            aria-label="待归组的演奏版本"
            size={Math.min(5, Math.max(2, candidates.length))}
            value={selected}
            disabled={disabled}
            onChange={(event) => setSelected(event.target.value)}
          >
            {candidates.slice(0, 100).map((row) => (
              <option key={row.contentId} value={row.contentId}>
                {row.label ||
                  view.registry.works[row.workId]?.title ||
                  "演奏 MIDI"}
              </option>
            ))}
          </select>
          {!candidates.length && (
            <p>暂无匹配的演奏。导入另一份 MIDI 后可在这里归组。</p>
          )}
          {candidates.length > 100 && (
            <p>显示前 100 份，请输入曲名缩小范围。</p>
          )}
          <button
            disabled={disabled || !target}
            onClick={() =>
              void change(() =>
                editRepertoire({
                  expected: view.revision,
                  contentId: target!.contentId,
                  workId: project.work.id,
                }),
              )
            }
          >
            归入当前歌曲
          </button>
        </section>
      </div>
    </Container>
  );
}
