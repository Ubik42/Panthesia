import {
  ArrowRight,
  FolderOpen,
  KeyboardMusic,
  Library,
  Music2,
} from "lucide-react";
import { useId } from "react";
import "./practiceWelcome.css";

export function PracticeWelcome({
  resumeTitle,
  resumeRecent,
  disabled,
  input,
  inputConnected,
  resume,
  choose,
  importFile,
  generate,
  devices,
}: {
  resumeTitle?: string;
  resumeRecent: boolean;
  disabled: boolean;
  input: string | null;
  inputConnected: boolean;
  resume: () => void;
  choose: () => void;
  importFile: () => void;
  generate: () => void;
  devices: () => void;
}) {
  const heading = useId();
  return (
    <section className="practice-welcome" aria-labelledby={heading}>
      <div className="practice-welcome-art" aria-hidden="true">
        <svg viewBox="0 0 360 110" focusable="false">
          {Array.from({ length: 14 }, (_, key) => (
            <rect
              key={`w${key}`}
              x={key * 25 + 5}
              y={8}
              width={23}
              height={91}
              rx={4}
              className={`welcome-key${key === 4 || key === 6 || key === 8 ? " welcome-key-lit" : ""}`}
            />
          ))}
          {[0, 1, 3, 4, 5, 7, 8, 10, 11, 12].map((key) => (
            <rect
              key={`b${key}`}
              x={key * 25 + 21}
              y={7}
              width={16}
              height={54}
              rx={3}
              className="welcome-key-black"
            />
          ))}
        </svg>
        <span className="practice-welcome-note">♪</span>
      </div>
      <div className="practice-welcome-intro">
        <span className="practice-welcome-eyebrow">今天，弹一会儿</span>
        <h2 id={heading}>从一首曲目开始</h2>
        <p>选择曲目后，可以调慢速度、分手练习，也可以打开乐谱跟练。</p>
      </div>
      {resumeTitle && (
        <button
          className="practice-welcome-resume"
          disabled={disabled}
          onClick={resume}
        >
          <Music2 size={20} />
          <span>
            <small>{resumeRecent ? "继续上次曲目" : "开始第一首练习"}</small>
            <strong>{resumeTitle}</strong>
          </span>
          <ArrowRight size={19} />
        </button>
      )}
      <div className="practice-welcome-choices">
        <button disabled={disabled} onClick={choose}>
          <Library size={18} />
          <span>
            <strong>从曲库选曲</strong>
            <small>浏览曲目、分组和学习目标</small>
          </span>
        </button>
        <button disabled={disabled} onClick={importFile}>
          <FolderOpen size={18} />
          <span>
            <strong>打开 MIDI 文件</strong>
            <small>使用电脑上的曲目</small>
          </span>
        </button>
        <button disabled={disabled} onClick={generate}>
          <Music2 size={18} />
          <span>
            <strong>生成技术练习</strong>
            <small>音阶、琶音与和弦</small>
          </span>
        </button>
      </div>
      <button
        className="practice-welcome-device"
        disabled={disabled}
        onClick={devices}
      >
        <KeyboardMusic size={16} />
        <span>
          {input
            ? `${inputConnected ? "已连接" : "等待连接"}：${input}`
            : "选择 MIDI 键盘与声音输出"}
        </span>
        <ArrowRight size={14} />
      </button>
    </section>
  );
}
