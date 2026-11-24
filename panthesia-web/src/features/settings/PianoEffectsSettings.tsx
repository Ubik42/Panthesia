import type { DisplayPreferences } from "./displayPreferences";
import { StageBackgroundSettings } from "./StageBackgroundSettings";

type Change = (patch: Partial<DisplayPreferences>) => void;

/** A percentage slider row: name on the left, slider and value on the right. */
function Percent({ label, value, change, min = 0 }: { label: string; value: number; change: (value: number) => void; min?: number }) {
  return (
    <label>
      <span>{label}</span>
      <span className="settings-range">
        <input aria-label={label} type="range" min={min} max="100" value={value} onChange={(e) => change(Number(e.target.value))} />
        <output>{value}%</output>
      </span>
    </label>
  );
}

/** Stage appearance on the settings page: backdrop, key light, virtual hands, practice grid. */
export function PianoEffectsSettings({ value, change }: { value: DisplayPreferences; change: Change }) {
  return (
    <>
      <section aria-labelledby="appearance-theme">
        <h3 id="appearance-theme">界面</h3>
        <div className="ui-row">
          <span>主题</span>
          <span className="ui-segmented" role="group" aria-label="界面主题">
            <button type="button" aria-pressed={value.theme === "light"} onClick={() => change({ theme: "light" })}>
              浅色
            </button>
            <button type="button" aria-pressed={value.theme === "dark"} onClick={() => change({ theme: "dark" })}>
              深色
            </button>
          </span>
        </div>
      </section>
      <StageBackgroundSettings heading="舞台背景" value={value} change={change} />

      <section aria-labelledby="appearance-keys">
        <h3 id="appearance-keys">琴键与光效</h3>
        <label>
          <input type="checkbox" aria-label="钢琴光效" checked={value.effectsEnabled} onChange={(e) => change({ effectsEnabled: e.target.checked })} />
          落键光效
        </label>
        <div className="ui-row">
          <span>光效风格</span>
          <span className="ui-segmented" role="group" aria-label="光效风格">
            <button type="button" aria-pressed={value.effectsPreset === "practice"} onClick={() => change({ effectsPreset: "practice", effectsEnabled: true })}>
              练习
            </button>
            <button type="button" aria-pressed={value.effectsPreset === "performance"} onClick={() => change({ effectsPreset: "performance", effectsEnabled: true })}>
              演出
            </button>
          </span>
        </div>
        <label>
          <span>光效配色</span>
          <select aria-label="光效配色" value={value.effectsPalette} onChange={(e) => change({ effectsPalette: e.target.value as DisplayPreferences["effectsPalette"] })}>
            <option value="aurora">极光 · 青绿与靛蓝</option>
            <option value="ember">余晖 · 琥珀与珊瑚</option>
            <option value="violet">星云 · 紫藤与冰蓝</option>
          </select>
        </label>
        <label>
          <span>落键特效</span>
          <select aria-label="落键特效" value={value.effectStyle} onChange={(e) => change({ effectStyle: e.target.value as DisplayPreferences["effectStyle"] })}>
            <option value="bloom">辉光 · 光柱与星屑</option>
            <option value="ripple">涟漪 · 多重扩散光环</option>
            <option value="comet">流星 · 光点与拖尾</option>
          </select>
        </label>
        <label>
          <span>琴键材质</span>
          <select aria-label="琴键材质" value={value.pianoMaterial} onChange={(e) => change({ pianoMaterial: e.target.value as DisplayPreferences["pianoMaterial"] })}>
            <option value="ivory">暖象牙</option>
            <option value="porcelain">白瓷</option>
            <option value="glass">冰晶玻璃</option>
          </select>
        </label>
        <Percent label="光效强度" value={value.effectsIntensity} change={(effectsIntensity) => change({ effectsIntensity })} />
        <label>
          <input type="checkbox" checked={value.reduceMotion} onChange={(e) => change({ reduceMotion: e.target.checked })} />
          减少动画，只保留短暂击键高亮
        </label>
        <p className="parameter-help">练习光效给出清楚的落点；演出光效增加光束、光环与粒子拖尾，随力度变化。同时遵循系统的“减少动画”。</p>
      </section>

      <section aria-labelledby="appearance-hands">
        <h3 id="appearance-hands">虚拟双手</h3>
        <label>
          <input type="checkbox" aria-label="虚拟双手演示" checked={value.virtualHands} onChange={(e) => change({ virtualHands: e.target.checked })} />
          演示当前歌曲的左右手与指法
        </label>
        <Percent label="手部不透明度" min={20} value={value.virtualHandOpacity} change={(virtualHandOpacity) => change({ virtualHandOpacity })} />
      </section>

      <section aria-labelledby="appearance-grid">
        <h3 id="appearance-grid">练习网格</h3>
        <label>
          <span>细分密度</span>
          <select aria-label="网格细分" value={value.gridSubdivision} onChange={(e) => change({ gridSubdivision: Number(e.target.value) as DisplayPreferences["gridSubdivision"] })}>
            <option value={4}>四分音符</option>
            <option value={8}>八分音符</option>
            <option value={16}>十六分音符</option>
            <option value={32}>三十二分音符</option>
          </select>
        </label>
        <Percent label="小节线" value={value.barOpacity} change={(barOpacity) => change({ barOpacity })} />
        <Percent label="拍线" value={value.beatOpacity} change={(beatOpacity) => change({ beatOpacity })} />
        <Percent label="细分线" value={value.subdivisionOpacity} change={(subdivisionOpacity) => change({ subdivisionOpacity })} />
        <div className="settings-row-actions">
          <button type="button" onClick={() => change({ gridSubdivision: 16, barOpacity: 75, beatOpacity: 45, subdivisionOpacity: 30 })}>清楚对拍</button>
          <button type="button" onClick={() => change({ gridSubdivision: 8, barOpacity: 45, beatOpacity: 18, subdivisionOpacity: 12 })}>柔和网格</button>
          <button type="button" onClick={() => change({ barOpacity: 0, beatOpacity: 0, subdivisionOpacity: 0 })}>隐藏网格</button>
        </div>
      </section>
    </>
  );
}
