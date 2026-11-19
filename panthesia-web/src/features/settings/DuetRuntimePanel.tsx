import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { api } from "../../api";
import "./duetRuntime.css";
type Settings = {
  python: string | null;
  model: string | null;
  device: "auto" | "cuda" | "cpu" | null;
};
type Effective = {
  python: string;
  model: string;
  device: string;
  pythonSource: string;
  modelSource: string;
};
type View = {
  settings: Settings;
  revision: string;
  effective: Effective;
  filesReady: boolean;
  issues: string[];
};
type Probe = {
  available: boolean;
  pythonVersion: string;
  duetVersion: string;
  torchVersion: string;
  cudaAvailable: boolean;
  cudaDevice: string | null;
  effectiveDevice: string;
  message: string;
};
const empty: Settings = { python: null, model: null, device: "auto" };
// A dialog can be closed while a draft is being edited; keep it for this app session.
let retained: { settings: Settings; revision: string } | null = null;
export function DuetRuntimePanel({ disabled = false }: { disabled?: boolean }) {
  const [view, setView] = useState<View | null>(null),
    [draft, setDraft] = useState<Settings>(retained?.settings ?? empty);
  const [revision, setRevision] = useState(retained?.revision ?? "");
  const [working, setWorking] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [probe, setProbe] = useState<Probe | null>(null);
  const load = async (reset = false) => {
    setWorking("正在读取设置…");
    setError("");
    try {
      const next = await invoke<View>("read_duet_runtime");
      setView(next);
      if (reset || !retained) {
        setDraft(next.settings);
        setRevision(next.revision);
        if (reset) retained = null;
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking("");
    }
  };
  useEffect(() => {
    if (api.desktop) void load();
  }, []);
  const change = (patch: Partial<Settings>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    retained = { settings: next, revision };
    setProbe(null);
    setMessage("");
  };
  const browse = async (kind: "python" | "model") => {
    setWorking("正在选择位置…");
    setError("");
    try {
      const path = await invoke<string | null>("browse_duet_runtime", { kind });
      if (path) change({ [kind]: path });
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking("");
    }
  };
  const check = async () => {
    setWorking("正在检查 Python、DuET 和计算设备…");
    setError("");
    setProbe(null);
    try {
      setProbe(await invoke<Probe>("probe_duet_runtime", { settings: draft }));
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking("");
    }
  };
  const save = async () => {
    setWorking("正在保存设置…");
    setError("");
    try {
      const next = await invoke<View>("save_duet_runtime", {
        settings: draft,
        expectedRevision: revision,
      });
      retained = null;
      setView(next);
      setDraft(next.settings);
      setRevision(next.revision);
      setMessage("设置已保存，下次制谱使用新设置。");
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking("");
    }
  };
  const locked = disabled || !!working || !view;
  if (!api.desktop) return <p>请在 Panthesia 桌面版配置本机 DuET。</p>;
  const source = (value: string) =>
    ({
      environment: "环境变量优先",
      selected: "手动选择",
      automatic: "自动查找",
    })[value] ?? value;
  return (
    <section
      className="duet-runtime-panel"
      aria-label="DuET 制谱设置"
      aria-busy={!!working}
    >
      <div className="duet-runtime-title">
        <div>
          <h3>DuET 制谱</h3>
          <p>从 MIDI 生成 MusicXML，随后预览、采用或交给 MuseScore 编辑。</p>
        </div>
        <span className={view?.filesReady ? "ready" : ""}>
          {probe?.available
            ? "环境可用"
            : view?.filesReady
              ? "文件已找到"
              : "需要配置"}
        </span>
      </div>
      <div className="duet-runtime-field">
        <label htmlFor="duet-python">Python 程序</label>
        <div>
          <input
            id="duet-python"
            value={draft.python ?? ""}
            placeholder="留空自动查找"
            disabled={locked}
            onChange={(e) => change({ python: e.target.value || null })}
          />
          <button disabled={locked} onClick={() => void browse("python")}>
            浏览程序
          </button>
        </div>
        {view && (
          <small>
            已保存配置：{source(view.effective.pythonSource)} · {view.effective.python}
          </small>
        )}
      </div>
      <div className="duet-runtime-field">
        <label htmlFor="duet-model">DuET 模型目录</label>
        <div>
          <input
            id="duet-model"
            value={draft.model ?? ""}
            placeholder="包含 model.safetensors 和 config.json 的目录"
            disabled={locked}
            onChange={(e) => change({ model: e.target.value || null })}
          />
          <button disabled={locked} onClick={() => void browse("model")}>
            浏览目录
          </button>
        </div>
        {view && (
          <small>
            已保存配置：{source(view.effective.modelSource)} · {view.effective.model}
          </small>
        )}
      </div>
      <label className="duet-runtime-device">
        <span>计算设备</span>
        <select
          aria-label="DuET 计算设备"
          value={draft.device ?? "auto"}
          disabled={locked}
          onChange={(e) =>
            change({ device: e.target.value as Settings["device"] })
          }
        >
          <option value="auto">自动选择</option>
          <option value="cuda">CUDA 显卡</option>
          <option value="cpu">CPU</option>
        </select>
      </label>
      <p className="duet-runtime-help">
        Python 需已安装
        duet-score。检查会读取本机组件及模型配置，生成时读取所选模型；所有过程均使用本机文件。
      </p>
      {!!view?.issues.length && (
        <ul className="duet-runtime-issues">
          {view.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      {retained && (
        <p className="duet-runtime-help">
          有尚未保存的修改，收起设置后可继续编辑。
        </p>
      )}
      {working && <p role="status">{working}</p>}
      {error && (
        <p className="duet-runtime-error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {probe && (
        <div
          className={`duet-runtime-probe ${probe.available ? "ready" : ""}`}
          role="status"
        >
          <strong>{probe.message}</strong>
          <p>
            Python {probe.pythonVersion} · DuET {probe.duetVersion} · Torch{" "}
            {probe.torchVersion}
          </p>
          <p>
            本次使用：
            {probe.effectiveDevice === "cuda"
              ? (probe.cudaDevice ?? "CUDA")
              : "CPU"}
            。
            {probe.cudaAvailable && probe.effectiveDevice !== "cuda"
              ? `可用显卡：${probe.cudaDevice}`
              : ""}
          </p>
          <small>模型推理与谱面质量由实际制谱结果核对。</small>
        </div>
      )}
      <div className="duet-runtime-actions">
        <button disabled={locked} onClick={() => void check()}>
          检查运行环境
        </button>
        <button
          className="duet-runtime-save"
          disabled={locked}
          onClick={() => void save()}
        >
          保存制谱设置
        </button>
        <button
          disabled={locked}
          onClick={() => {
            retained = null;
            setDraft(empty);
            setProbe(null);
            setMessage("已恢复自动查找，保存后生效。");
            retained = { settings: empty, revision };
          }}
        >
          恢复自动查找
        </button>
        <button disabled={!!working} onClick={() => void load(true)}>
          重新读取
        </button>
      </div>
    </section>
  );
}
