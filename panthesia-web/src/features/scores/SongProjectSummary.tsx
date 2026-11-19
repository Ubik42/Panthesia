import { useEffect, useState } from "react";
import type { SongProject } from "../../engine/commands.generated";
import { readRepertoire } from "../library/repertoireClient";
import "./songProject.css";

export function SongProjectSummary({ project }: { project: SongProject }) {
  const transform = project.practice.transform;
  const active = project.notations.find((row) => row.active);
  const practice = [
    transform.transpose
      ? `${transform.transpose > 0 ? "+" : ""}${transform.transpose} 半音`
      : "原调",
    transform.quantize
      ? `1/${transform.quantize} 量化${transform.durations ? "（含时值）" : ""}`
      : "原始时序",
  ].join(" · ");
  return (
    <section className="song-project-summary" aria-label="歌曲、演奏与谱面关系">
      <header>
        <strong>{project.work.title}</strong>
        <span>歌曲与版本</span>
      </header>
      <dl>
        <div>
          <dt>演奏版本</dt>
          <dd>{project.performance.label || "当前 MIDI"}</dd>
        </div>
        <div>
          <dt>当前练习</dt>
          <dd>{practice}</dd>
        </div>
        <div>
          <dt>采用谱面</dt>
          <dd>{active?.edition.name || "MIDI 即时预览"}</dd>
        </div>
        <div>
          <dt>谱面版本</dt>
          <dd>
            {project.notations.length} 份
            {project.generations.length
              ? ` · DuET 生成 ${project.generations.filter((row) => row.generator === "duet").length} 份`
              : ""}
          </dd>
        </div>
      </dl>
      {project.issues.map((issue, index) => (
        <p key={index} role="status">
          {issue}
        </p>
      ))}
    </section>
  );
}
export function CurrentSongProject({
  contentId,
  path,
  revision,
}: {
  contentId: string;
  path: string;
  revision: string;
}) {
  const [project, setProject] = useState<SongProject | null>(null),
    [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    setProject(null);
    if (!path || path.startsWith("exercise:")) return;
    void readRepertoire(path, contentId)
      .then((result) => {
        if (active && result.project?.performance.contentId === contentId)
          setProject(result.project);
      })
      .catch((error) => {
        if (active)
          setError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [contentId, path, revision, retry]);
  if (error)
    return (
      <div className="song-project-error" role="status">
        歌曲版本暂未读到：{error}{" "}
        <button onClick={() => setRetry((value) => value + 1)}>重新读取</button>
      </div>
    );
  return project && project.performance.contentId === contentId ? (
    <SongProjectSummary project={project} />
  ) : null;
}
