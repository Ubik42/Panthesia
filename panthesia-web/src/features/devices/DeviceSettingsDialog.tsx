import { useCallback, useEffect, useRef, useState } from "react";
import {
  Cable,
  KeyboardMusic,
  RefreshCw,
  SlidersHorizontal,
  Volume2,
  X,
} from "lucide-react";
import {
  api,
  type EngineCommand,
  type Snapshot,
  type SoundFontStatus,
} from "../../api";
import { TaskActivity } from "../../engine/TaskActivity";
import { useDeviceCatalog } from "./useDeviceCatalog";
import { DeviceScanNotice } from "./DeviceScanNotice";
import "./deviceSettings.css";
import type { PlaybackStore } from "../practice/playbackStore";
import { usePlaybackFields } from "../practice/PlaybackView";
import { DuetRuntimePanel } from "../settings/DuetRuntimePanel";

type Calibration = { message: string; suggested: number | null };
const pluginName = (path: string) =>
  path
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.vst3$/i, "") ?? path;

export function DeviceSettingsDialog({
  store,
  state,
  busy,
  unavailable,
  engineId,
  error,
  command,
  synchronize,
  reportError,
  close,
  initialTab = "sound",
}: {
  store: PlaybackStore;
  state: Pick<
    Snapshot,
    | "input"
    | "inputConnected"
    | "output"
    | "outputId"
    | "latency"
    | "sound"
    | "soundfont"
  >;
  busy: boolean;
  unavailable?: string;
  engineId?: string;
  error: string;
  command: (value: EngineCommand) => Promise<boolean>;
  synchronize: () => Promise<void>;
  reportError: (message: string) => void;
  close: () => void;
  initialTab?: "sound"|"duet";
}) {
  const [tab,setTab]=useState(initialTab);
  const inputActivity = usePlaybackFields(store, [
    "pressed",
    "midiEvents",
    "audioLevel",
    "audioPerformance",
    "playbackPerformance",
  ]);
  const { devices, deviceError, refreshDevices, requesting } =
    useDeviceCatalog(engineId);
  const [font, setFont] = useState<SoundFontStatus | null>(null);
  const [fontLoading, setFontLoading] = useState(api.desktop);
  const [fontError, setFontError] = useState("");
  const [operation, setOperation] = useState<string | null>(null);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const [message, setMessage] = useState("");
  const [audioDevices, setAudioDevices] = useState<
    { id: string; name: string; default: boolean }[]
  >([]);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState("");
  useEffect(() => {
    void api
      .command<{ devices: typeof audioDevices }>({ type: "audioDevices" })
      .then((value) => setAudioDevices(value.devices))
      .catch((e) => setFontError(String(e)));
  }, [engineId]);
  const testSound = async () => {
    if (testing || locked) return;
    setTesting(true);
    setNotice("");
    setTestError("");
    const testingEngine = origin.current;
    try {
      for (const pitch of [60, 64, 67])
        await api.commandForEngine(testingEngine, {
          type: "note",
          pitch,
          active: true,
          velocity: 88,
        });
      await new Promise((resolve) => setTimeout(resolve, 650));
      setNotice("测试音已发送到当前音源，请确认所选扬声器或耳机发声。");
    } catch (error) {
      setTestError(`试音失败：${String(error)}`);
    } finally {
      for (const pitch of [60, 64, 67])
        await api
          .commandForEngine(testingEngine, {
            type: "note",
            pitch,
            active: false,
            velocity: 0,
          })
          .catch(() => {});
      setTesting(false);
    }
  };
  const [notice, setNotice] = useState("");
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [latency, setLatency] = useState(String(state.latency));
  const working = useRef(false);
  const operationEpoch = useRef(0);
  const origin = useRef(engineId);
  origin.current = engineId;
  const mounted = useRef(true);
  const fontEpoch = useRef(0);
  const context = JSON.stringify([
    engineId,
    state.input ?? null,
    state.outputId ?? state.output,
  ]);
  const latestContext = useRef(context);
  latestContext.current = context;
  const dismissLocked = operation !== null && closeBlocked;
  const locked =
    busy ||
    testing ||
    !!unavailable ||
    operation !== null ||
    !!state.sound?.changing;
  const selectedOutput =
    state.output === "内置钢琴"
      ? ""
      : (state.outputId ??
        (state.output.startsWith("VST3")
          ? `vst3:${devices.vst3.find((path) => state.output === `VST3 · ${pluginName(path)}`) ?? ""}`
          : state.output));
  const outputKnown =
    selectedOutput === "" ||
    devices.outputs.includes(selectedOutput) ||
    devices.vst3.some((path) => selectedOutput === `vst3:${path}`);
  const inventoryErrors = [
    deviceError,
    !devices.scans && devices.inputError,
    !devices.scans && devices.outputError,
  ].filter(Boolean);
  const scanRequested = (target: "input" | "output" | "plugins") =>
    requesting.has("all") || requesting.has(target);
  const allRefreshing =
    requesting.has("all") ||
    (devices.scans
      ? ["input", "output", "plugins"].every(
          (target) =>
            devices.scans![target as "input" | "output" | "plugins"].refreshing,
        )
      : devices.refreshing);
  const latencyValue = Number(latency);
  const validLatency =
    latency.trim() !== "" &&
    Number.isInteger(latencyValue) &&
    latencyValue >= -250 &&
    latencyValue <= 250;

  useEffect(() => {
    if (error === "后台任务已取消") {
      reportError("");
      setMessage("");
      setNotice("设备操作已取消；后台清理完成后可继续演奏");
    }
  }, [error, reportError]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operationEpoch.current++;
      fontEpoch.current++;
    };
  }, []);
  useEffect(() => {
    operationEpoch.current++;
    working.current = false;
    setOperation(null);
    setCloseBlocked(false);
    setMessage("");
    setNotice("");
    setFont(null);
    setFontError("");
  }, [engineId]);
  useEffect(() => {
    setLatency(String(state.latency));
  }, [context, state.latency]);
  useEffect(() => {
    setCalibration(null);
  }, [context]);
  const readFont = useCallback(async () => {
    if (!api.desktop) return;
    const request = ++fontEpoch.current;
    setFontLoading(true);
    try {
      const status = await api.soundfontStatus();
      if (
        mounted.current &&
        origin.current === engineId &&
        request === fontEpoch.current
      ) {
        setFont(status);
        setFontError("");
      }
    } catch (failure) {
      if (
        mounted.current &&
        origin.current === engineId &&
        request === fontEpoch.current
      )
        setFontError(
          failure instanceof Error ? failure.message : String(failure),
        );
    } finally {
      if (
        mounted.current &&
        origin.current === engineId &&
        request === fontEpoch.current
      )
        setFontLoading(false);
    }
  }, [engineId]);
  useEffect(() => {
    void readFont();
    return () => {
      fontEpoch.current++;
    };
  }, [readFont, state.soundfont]);

  const work = async (
    label: string,
    job: (current: () => boolean) => Promise<void>,
    nativeDialog = false,
  ) => {
    if (working.current || busy || unavailable) return;
    working.current = true;
    const request = ++operationEpoch.current;
    const current = () =>
      mounted.current &&
      origin.current === engineId &&
      operationEpoch.current === request;
    setOperation(label);
    setCloseBlocked(nativeDialog);
    setMessage("");
    setNotice("");
    try {
      await job(current);
    } catch (failure) {
      if (!current()) return;
      const detail =
        failure instanceof Error ? failure.message : String(failure);
      if (detail === "后台任务已取消") {
        reportError("");
        if (mounted.current) {
          setMessage("");
          setNotice("设备操作已取消；后台清理完成后可继续演奏");
        }
      } else {
        reportError(detail);
        if (mounted.current) setMessage(detail);
      }
    } finally {
      if (current()) {
        working.current = false;
        setOperation(null);
        setCloseBlocked(false);
      }
    }
  };
  const changeDevice = (type: "input" | "output", name: string) =>
    void work(
      type === "input" ? "正在连接键盘…" : "正在连接音源…",
      async (current) => {
        if ((await command({ type, name: name || null })) && current())
          setNotice(type === "input" ? "输入设备已保存" : "演奏音源已保存");
      },
    );
  const saveLatency = (value: number) =>
    void work("正在保存延迟补偿…", async (current) => {
      if (
        (await command({ type: "latency", milliseconds: value })) &&
        current()
      ) {
        setCalibration(null);
        setNotice("延迟补偿已保存，按当前输入与音源组合生效");
      }
    });
  const estimateLatency = () =>
    void work("正在估计输入延迟…", async (current) => {
      const scope = context;
      const result = await api.commandForEngine<Calibration>(engineId, {
        type: "calibration",
      });
      if (current() && latestContext.current === scope) setCalibration(result);
    });
  const changeFont = (restore: boolean) =>
    void work(
      "正在准备钢琴音源…",
      async (current) => {
        ++fontEpoch.current;
        setFontLoading(false);
        const status = restore
          ? await api.resetSoundfont()
          : await api.selectSoundfont();
        if (!status || !current()) return;
        if (current()) {
          setFont(status);
          setFontError("");
        }
        try {
          await synchronize();
          if (current()) setNotice("内置音源文件已保存");
        } catch (failure) {
          throw new Error(
            `音源已更换，界面状态读取失败：${failure instanceof Error ? failure.message : String(failure)}`,
          );
        }
      },
      !restore,
    );

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!dismissLocked) close();
      }}
    >
      <section
        className="settings-dialog device-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="device-title"
        aria-busy={locked}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="device-title">演奏与制谱设置</h2>
            <p className="device-subtitle">
              {tab==="sound"?"选择输入键盘、演奏音源和发声设备，然后试音。":"配置本机 Python、DuET 模型和计算设备。"}
            </p>
          </div>
          <button
            autoFocus
            data-dialog-close
            className="icon-button"
            aria-label="关闭设备设置"
            disabled={dismissLocked}
            onClick={close}
          >
            <X size={19} />
          </button>
        </div>
        <nav className="device-settings-tabs" role="tablist" aria-label="设置分类"><button role="tab" aria-selected={tab==="sound"} onClick={()=>setTab("sound")}>设备与声音</button><button role="tab" aria-selected={tab==="duet"} onClick={()=>setTab("duet")}>DuET 制谱</button></nav>
        {tab==="duet"&&<div className="device-settings-body"><DuetRuntimePanel disabled={!!unavailable}/></div>}
        <div className="device-settings-body" hidden={tab!=="sound"}>
          <div className="sound-signal-path" aria-label="当前发声链路">
            <span>
              <small>输入键盘</small>
              <strong>{state.input ?? "电脑 / 屏幕键盘"}</strong>
              <em>
                {inputActivity.pressed.length
                  ? `正在输入：${inputActivity.pressed.join(" · ")}`
                  : state.inputConnected
                    ? "已连接，按琴键查看输入"
                    : "请选择或连接键盘"}
              </em>
            </span>
            <span aria-hidden="true">→</span>
            <span>
              <small>演奏音源</small>
              <strong>{state.output}</strong>
              <em>{state.sound?.ready ? "已连接" : "等待连接"}</em>
            </span>
            <span aria-hidden="true">→</span>
            <span>
              <small>发声设备</small>
              <strong>{state.sound?.device ?? "系统默认设备"}</strong>
              <em>
                {selectedOutput && !selectedOutput.startsWith("vst3:")
                  ? "由 Windows MIDI 路由控制"
                  : "应用音频输出"}
              </em>
            </span>
          </div>
          <section
            className="device-audio-endpoint"
            aria-label="发声设备与试音"
          >
            <h3>
              <Volume2 size={17} />
              连接与试音
            </h3>
            <div className="sound-routing-selectors">
              <label htmlFor="route-input">
                输入键盘
                <select
                  id="route-input"
                  value={state.input ?? ""}
                  disabled={locked}
                  onChange={(e) => changeDevice("input", e.target.value)}
                >
                  <option value="">电脑 / 屏幕键盘</option>
                  {state.input && !devices.inputs.includes(state.input) && (
                    <option value={state.input}>{state.input}（未连接）</option>
                  )}
                  {devices.inputs.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor="route-instrument">
                演奏音源
                <select
                  id="route-instrument"
                  value={selectedOutput}
                  disabled={locked}
                  onChange={(e) => changeDevice("output", e.target.value)}
                >
                  <option value="">内置钢琴</option>
                  {!outputKnown && (
                    <option value={selectedOutput}>
                      {state.output}（当前选择）
                    </option>
                  )}
                  {devices.outputs
                    .filter((name) => /Microsoft GS Wavetable/i.test(name))
                    .map((name) => (
                      <option key={name} value={name}>
                        Windows 系统 MIDI 音源
                      </option>
                    ))}
                  <optgroup label="VST3 乐器">
                    {[...devices.vst3]
                      .sort(
                        (a, b) =>
                          Number(/Pianoteq/i.test(b)) -
                          Number(/Pianoteq/i.test(a)),
                      )
                      .map((path) => (
                        <option key={path} value={`vst3:${path}`}>
                          {pluginName(path)}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="外部 MIDI 设备">
                    {devices.outputs
                      .filter((name) => !/Microsoft GS Wavetable/i.test(name))
                      .map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                  </optgroup>
                </select>
              </label>
            </div>
            {state.sound?.pluginStatePath && <p className="device-note" role={state.sound.pluginStateWarning?"status":undefined}>
              {state.sound.pluginStateWarning || (state.sound.pluginStateRestored?"插件设置已从练习资料恢复。":"插件首次连接，设置将保存在练习资料中。")}
              {" "}更新软件时可继续使用同一份练习资料。
            </p>}
            <label htmlFor="audio-endpoint">扬声器 / 耳机</label>
            <select
              id="audio-endpoint"
              value={state.sound?.deviceId ?? ""}
              disabled={
                locked ||
                (!!selectedOutput && !selectedOutput.startsWith("vst3:"))
              }
              onChange={(e) =>
                void work("正在连接发声设备…", async () => {
                  await command({
                    type: "audioDevice",
                    name: e.target.value || null,
                  });
                  await synchronize();
                })
              }
            >
              <option value="">跟随系统默认设备</option>
              {audioDevices.map((device, index) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                  {audioDevices.filter((d) => d.name === device.name).length > 1
                    ? ` · ${index + 1}`
                    : ""}
                  {device.default ? "（系统默认）" : ""}
                </option>
              ))}
            </select>
            <div className="sound-output-meter" aria-label="音源输出电平">
              <span>
                {inputActivity.audioLevel == null
                  ? "外部 MIDI：音频由系统或外部设备处理"
                  : "音源输出"}
              </span>
              {inputActivity.audioLevel != null && (
                <>
                  <meter
                    min={0}
                    max={1}
                    value={Math.min(1, inputActivity.audioLevel)}
                    aria-label="实时音源电平"
                  />
                  <small>
                    {inputActivity.audioLevel > 0.001
                      ? "有音频信号"
                      : "等待输入或试音"}
                  </small>
                </>
              )}
            </div>
            {testError && (
              <p role="alert" className="browser-error">
                {testError}
              </p>
            )}
            <div className="sound-test-row">
              <button
                className="sound-test-button"
                disabled={locked || !state.sound?.ready}
                onClick={() => void testSound()}
              >
                <Volume2 size={17} />
                {testing ? "正在试音…" : "播放测试和弦"}
              </button>
              <span>
                测试会发出 C 大调和弦。键盘输入和曲目播放使用同一音源。
              </span>
            </div>
            {!!selectedOutput && !selectedOutput.startsWith("vst3:") && (
              <p className="device-help">
                系统 MIDI 音源和外部 MIDI 端口使用各自的输出设置；可在 Windows
                音量混合器或外部设备中调整。
              </p>
            )}
          </section>
          {unavailable && (
            <p className="device-readonly-notice" role="status">
              {unavailable}当前窗口可以随时返回。
            </p>
          )}
          <details className="device-performance"><summary>播放性能记录</summary>
            <p>播放调度最大间隔：{(inputActivity.playbackPerformance?.maxGapMs??0).toFixed(1)} ms；超过 20 ms：{inputActivity.playbackPerformance?.lateTicks??0} 次。</p>
            <p>音符处理最大耗时：{(inputActivity.playbackPerformance?.maxTickMs??0).toFixed(2)} ms；状态更新：{(inputActivity.playbackPerformance?.maxPublishMs??0).toFixed(2)} ms。</p>
            {inputActivity.audioPerformance?<p>内置音频计算最大耗时：{(inputActivity.audioPerformance.maxRenderUs/1000).toFixed(2)} ms；最大缓冲：{inputActivity.audioPerformance.maxFrames} 帧；计算超时：{inputActivity.audioPerformance.overBudgetCallbacks} 次。</p>:<p>当前音源的音频回调耗时由外部音源管理。播放调度记录仍可查看。</p>}
            <p>这些是本次启动以来的记录。调度间隔与音频计算耗时分别统计，用于区分播放停顿与音源处理过慢。</p>
          </details>
          <details className="device-advanced-settings">
            <summary>设备诊断与高级设置</summary>
            <section
              className="device-section"
              aria-labelledby="device-input-title"
            >
              <h3 id="device-input-title">
                <KeyboardMusic size={17} />
                演奏输入
              </h3>
              <label htmlFor="device-midi-input">MIDI 输入</label>
              <select
                id="device-midi-input"
                value={state.input ?? ""}
                disabled={locked}
                onChange={(event) => changeDevice("input", event.target.value)}
              >
                <option value="">电脑键盘 / 屏幕键盘</option>
                {state.input && !devices.inputs.includes(state.input) && (
                  <option value={state.input}>
                    {state.input}（
                    {state.inputConnected ? "当前连接" : "等待连接"}）
                  </option>
                )}
                {devices.inputs.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
              <p
                className={`device-connection ${state.input && !state.inputConnected ? "device-connection-offline" : ""}`}
                role="status"
              >
                <Cable size={14} />
                {!state.input
                  ? "使用电脑键盘或屏幕键盘"
                  : state.inputConnected
                    ? `已连接 · ${state.input}`
                    : `等待连接 · ${state.input}`}
              </p>
              <p className="device-help">
                设备清单自动更新。键盘断开时会暂停播放；重新连接后，点击开始练习继续。
              </p>
              <DeviceScanNotice
                label="键盘清单"
                count={devices.inputs.length}
                empty="尚未发现 MIDI 键盘。连接键盘后可刷新，也可继续使用电脑键盘。"
                status={devices.scans?.input}
                requesting={scanRequested("input")}
                legacyReady={devices.ready}
                legacyRefreshing={devices.refreshing}
                refresh={() => void refreshDevices(true, "input")}
              />
            </section>
            <section
              className="device-section"
              aria-labelledby="device-output-title"
            >
              <h3 id="device-output-title">
                <Volume2 size={17} />
                演奏声音
              </h3>
              <label htmlFor="device-midi-output">演奏音源</label>
              <p className="device-help">
                切换会暂停播放，并保留当前的位置与练习记录。
              </p>
              <select
                id="device-midi-output"
                value={selectedOutput}
                disabled={locked}
                onChange={(event) => changeDevice("output", event.target.value)}
              >
                <option value="">内置音源</option>
                {!outputKnown && (
                  <option value={selectedOutput}>
                    {state.output}（当前使用）
                  </option>
                )}
                {devices.vst3.length > 0 && (
                  <optgroup label="VST3 乐器">
                    {devices.vst3.map((path) => (
                      <option key={path} value={`vst3:${path}`} title={path}>
                        VST3 · {pluginName(path)}
                        {devices.vst3.filter(
                          (other) => pluginName(other) === pluginName(path),
                        ).length > 1
                          ? ` · ${path}`
                          : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
                {devices.outputs.length > 0 && (
                  <optgroup label="Windows 系统音源 / 外部 MIDI">
                    {devices.outputs.map((name) => (
                      <option key={name} value={name}>
                        {/Microsoft GS Wavetable/i.test(name)
                          ? `Windows 系统音源 · ${name}`
                          : `外部设备 · ${name}`}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <div className="device-output-scans">
                <DeviceScanNotice
                  label="MIDI 输出"
                  count={devices.outputs.length}
                  empty="尚未发现 MIDI 输出，可使用内置钢琴或已安装的 VST3 插件。"
                  status={devices.scans?.output}
                  requesting={scanRequested("output")}
                  legacyReady={devices.ready}
                  legacyRefreshing={devices.refreshing}
                  refresh={() => void refreshDevices(true, "output")}
                />
                <DeviceScanNotice
                  label="VST3 插件"
                  count={devices.vst3.length}
                  empty="尚未发现 VST3 插件，可使用内置钢琴。新安装的插件可单独刷新。"
                  status={devices.scans?.plugins}
                  requesting={scanRequested("plugins")}
                  legacyReady={!devices.refreshing}
                  legacyRefreshing={devices.refreshing}
                  refresh={() => void refreshDevices(true, "plugins")}
                />
              </div>
              {state.output.startsWith("VST3") && (
                <div className="device-inline-actions">
                  <button
                    disabled={locked}
                    onClick={() =>
                      void work("正在打开音源窗口…", async () => {
                        await command({ type: "vstEditor" });
                      })
                    }
                  >
                    打开音源窗口
                  </button>
                  <span>在乐器自己的窗口中调整音色。</span>
                </div>
              )}
              {api.desktop && (
                <div className="device-soundfont" aria-label="内置音源文件">
                  <p>
                    内置音源文件：
                    <strong>
                      {font?.label ??
                        (fontLoading ? "正在读取…" : "暂时无法读取")}
                    </strong>
                  </p>
                  {font?.path && (
                    <p className="device-soundfont-path" title={font.path}>
                      {font.path}
                    </p>
                  )}
                  {font?.warning && (
                    <p className="device-soundfont-warning" role="alert">
                      {font.warning}
                    </p>
                  )}
                  {fontError && (
                    <p className="device-inline-error" role="alert">
                      音源信息暂未更新：{fontError}
                    </p>
                  )}
                  <div className="device-soundfont-actions">
                    <button
                      disabled={fontLoading || operation !== null}
                      onClick={() => void readFont()}
                    >
                      <RefreshCw
                        size={14}
                        className={
                          fontLoading ? "device-refreshing" : undefined
                        }
                      />
                      {fontLoading ? "正在读取音源…" : "重读音源信息"}
                    </button>
                    <button disabled={locked} onClick={() => changeFont(false)}>
                      选择本机 .sf2
                    </button>
                    <button
                      disabled={locked || !font || font.isDefault}
                      onClick={() => changeFont(true)}
                    >
                      恢复随包钢琴
                    </button>
                  </div>
                  {state.output !== "内置钢琴" && (
                    <p>切回「内置音源」后使用这份音源文件。</p>
                  )}
                </div>
              )}
            </section>
            <section
              className="device-section"
              aria-labelledby="device-latency-title"
            >
              <h3 id="device-latency-title">
                <SlidersHorizontal size={17} />
                输入延迟
              </h3>
              <label htmlFor="device-latency">延迟补偿（毫秒）</label>
              <div className="device-latency-row">
                <input
                  id="device-latency"
                  aria-label="输入延迟补偿"
                  aria-describedby="device-latency-help"
                  type="number"
                  min="-250"
                  max="250"
                  step="1"
                  value={latency}
                  disabled={locked}
                  onChange={(event) => setLatency(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && validLatency) {
                      event.preventDefault();
                      saveLatency(latencyValue);
                    }
                  }}
                />
                <button
                  disabled={
                    locked || !validLatency || latencyValue === state.latency
                  }
                  onClick={() => saveLatency(latencyValue)}
                >
                  应用补偿
                </button>
                <button disabled={locked} onClick={estimateLatency}>
                  估计输入延迟
                </button>
              </div>
              <p id="device-latency-help" className="device-help">
                范围 −250～250 毫秒。补偿按当前输入设备与音源组合分别保存。
              </p>
              {!validLatency && (
                <p className="device-inline-error" role="alert">
                  请输入 −250～250 之间的整数。
                </p>
              )}
              {calibration && (
                <div className="device-calibration">
                  <p>{calibration.message}</p>
                  {calibration.suggested !== null && (
                    <button
                      disabled={locked}
                      onClick={() => saveLatency(calibration.suggested!)}
                    >
                      应用建议 {calibration.suggested} 毫秒
                    </button>
                  )}
                </div>
              )}
            </section>
          </details>
          <TaskActivity
            engineId={engineId}
            label={[
              "连接演奏音源",
              "连接 MIDI 键盘",
              "准备钢琴音源",
              "打开音源窗口",
            ]}
            cancelLabel="取消设备操作"
          />
          {state.sound && !state.sound.ready && !state.sound.changing && (
            <button
              disabled={locked}
              onClick={() =>
                void work("正在重新连接声音设备…", async () => {
                  await command(
                    state.output === "内置钢琴"
                      ? {
                          type: "soundFont",
                          path: state.soundfont || font?.path || "",
                        }
                      : { type: "output", name: selectedOutput || null },
                  );
                })
              }
            >
              重新连接当前音源
            </button>
          )}
          {!!state.sound?.lateNotes && (
            <p className="device-help" role="status">
              本次声音连接已跳过 {state.sound.lateNotes}{" "}
              个过期音符，避免延迟后集中发声。重新连接音源会清除这项计数。
            </p>
          )}
          {state.sound?.changing && (
            <p className="device-operation" role="status">
              正在准备声音设备，请等待连接或取消清理完成。切换期间播放保持暂停。
            </p>
          )}
          {state.sound && !state.sound.ready && !state.sound.changing && (
            <p className="device-inline-error" role="alert">
              {state.sound.error ??
                "演奏音源尚未就绪，请重新选择音源或有效的 .sf2 文件。"}
            </p>
          )}
          {!devices.scans && !devices.ready && (
            <p className="device-help" role="status">
              正在读取 MIDI 设备…
            </p>
          )}
          {inventoryErrors.length > 0 && (
            <p className="device-inline-error" role="alert">
              {inventoryErrors.join("；")}
              。保留上次成功读取的设备清单，可点击刷新重试。
            </p>
          )}
          {(message || error) && (
            <p className="device-inline-error" role="alert">
              {message || error}
            </p>
          )}
          {(operation || notice) && (
            <p className="device-operation" role="status">
              {operation ?? notice}
            </p>
          )}
          {operation && !closeBlocked && (
            <p className="device-help">
              可以先返回主界面，连接工作会继续；顶部“工作进度”可查看结果或取消尚未提交的操作。
            </p>
          )}
        </div>
        <div className="dialog-actions device-settings-footer">
          {tab==="sound"&&<button
            disabled={allRefreshing}
            onClick={() => void refreshDevices(true)}
          >
            <RefreshCw
              size={14}
              className={devices.refreshing ? "device-refreshing" : undefined}
            />
            {allRefreshing
              ? "正在刷新全部…"
              : devices.refreshing
                ? "刷新其他清单"
                : "刷新全部清单"}
          </button>}
          <button
            data-dialog-close
            className="device-done"
            disabled={dismissLocked}
            onClick={close}
          >
            {operation || state.sound?.changing || busy ? "返回主界面" : "完成"}
          </button>
        </div>
      </section>
    </div>
  );
}
