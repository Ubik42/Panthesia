import { Sparkles } from "lucide-react";
import type { DisplayPreferences } from "./displayPreferences";

export function PianoEffectsSettings({ value, change, compact = false, openAppearance }: {
  value: DisplayPreferences; change: (patch: Partial<DisplayPreferences>) => void; compact?: boolean; openAppearance?:()=>void;
}) {
  return <section className={`piano-effects-settings ${compact ? "compact" : ""}`} aria-label="钢琴光效设置">
    {!compact && <>
      <div className="appearance-section-heading"><h3>练习室皮肤</h3><span>切换整体配色</span></div>
      <div className="skin-options" role="group" aria-label="界面皮肤">
        {([{id:"studio",name:"练习室",description:"雾白 · 海蓝"},{id:"midnight",name:"午夜",description:"墨紫 · 银光"},{id:"rosewood",name:"玫瑰木",description:"奶油 · 黄铜"}] as const).map(skin=><button type="button" key={skin.id} className="skin-option" data-preview-skin={skin.id} aria-pressed={value.skin===skin.id} onClick={()=>change({skin:skin.id})}><span className="skin-swatch" aria-hidden="true"><i/><i/><i/></span><strong>{skin.name}</strong><small>{skin.description}</small></button>)}
      </div>
      <div className="appearance-section-heading"><h3>琴键与光影</h3><span>保留清楚的落键反馈</span></div>
    </>}
    <div className="effects-heading"><Sparkles size={15} /><span>琴键光影</span>
      <button type="button" role="switch" aria-label="钢琴特效" aria-checked={value.effectsEnabled}
        className={`effects-switch ${value.effectsEnabled ? "enabled" : ""}`} onClick={() => change({ effectsEnabled: !value.effectsEnabled })}>
        {value.effectsEnabled ? "已开启" : "已关闭"}
      </button>
    </div>
    {!compact&&<section className="virtual-hands-settings" aria-label="虚拟双手设置">
      <h4>虚拟双手</h4>
      <label><input type="checkbox" aria-label="虚拟双手演示" checked={value.virtualHands} onChange={e=>change({virtualHands:e.target.checked})}/>演示当前歌曲的左右手与指法</label>
      <label className="effects-intensity">手部不透明度 <output>{value.virtualHandOpacity}%</output><input aria-label="手部不透明度" type="range" min="20" max="100" value={value.virtualHandOpacity} onChange={e=>change({virtualHandOpacity:Number(e.target.value)})}/></label>
      <p className="parameter-help">按已保存的左右手、指法和换指动作演示，包含穿指与双手交叉。缺少指法的音符可先在歌曲设置中补充。演示随播放、等待、定位和速度同步。</p>
    </section>}
    <div className="effects-presets" aria-label="光效预设">
      <button type="button" aria-pressed={value.effectsPreset === "practice"} onClick={() => change({ effectsPreset: "practice", effectsEnabled: true })}>练习光效</button>
      <button type="button" aria-pressed={value.effectsPreset === "performance"} onClick={() => change({ effectsPreset: "performance", effectsEnabled: true })}>演出光效</button>
    </div>
    <label className="effects-colors"><span className={compact ? "sr-only" : ""}>光效配色</span>
      <select aria-label="光效配色" value={value.effectsPalette} onChange={e => change({ effectsPalette: e.target.value as DisplayPreferences["effectsPalette"] })}>
        <option value="aurora">极光 · 青绿与靛蓝</option><option value="ember">余晖 · 琥珀与珊瑚</option><option value="violet">星云 · 紫藤与冰蓝</option>
      </select>
    </label>
    {compact && openAppearance && <button type="button" className="open-appearance" onClick={openAppearance}>材质与特效…</button>}
    {!compact && <>
      <div className="appearance-fields">
        <label>琴键材质<select aria-label="琴键材质" value={value.pianoMaterial} onChange={e=>change({pianoMaterial:e.target.value as DisplayPreferences["pianoMaterial"]})}><option value="ivory">暖象牙</option><option value="porcelain">白瓷</option><option value="glass">冰晶玻璃</option></select></label>
        <label>落键特效<select aria-label="落键特效" value={value.effectStyle} onChange={e=>change({effectStyle:e.target.value as DisplayPreferences["effectStyle"]})}><option value="bloom">辉光 · 光柱与星屑</option><option value="ripple">涟漪 · 多重扩散光环</option><option value="comet">流星 · 光点与拖尾</option></select></label>
      </div>
      <p className="parameter-help">练习光效提供清楚的落点与按键反馈；演出光效增加光束、扩散光环和粒子拖尾，随击键力度变化；踏板会延长星屑余光。</p>
      <label className="effects-intensity">光效强度 <output>{value.effectsIntensity}%</output>
        <input aria-label="光效强度" type="range" min="0" max="100" value={value.effectsIntensity} onChange={e => change({ effectsIntensity: Number(e.target.value) })} />
      </label>
      <label className="effects-motion"><input type="checkbox" checked={value.reduceMotion} onChange={e => change({ reduceMotion: e.target.checked })} />减少动画，只保留短暂击键高亮</label>
      <p className="parameter-help">同时遵循系统的减少动画设置。暂停、跳转、循环与切换曲目会清理旧光效。</p>
      <div className="grid-settings"><h4>练习网格</h4>
        <label>细分密度<select aria-label="网格细分" value={value.gridSubdivision} onChange={e=>change({gridSubdivision:Number(e.target.value) as DisplayPreferences["gridSubdivision"]})}><option value={4}>四分音符</option><option value={8}>八分音符</option><option value={16}>十六分音符</option><option value={32}>三十二分音符</option></select></label>
        {([['barOpacity','小节线透明度'],['beatOpacity','拍线透明度'],['subdivisionOpacity','细分线透明度']] as const).map(([key,label])=><label className="effects-intensity" key={key}>{label}<output>{value[key]}%</output><input aria-label={label} type="range" min="0" max="100" value={value[key]} onChange={e=>change({[key]:Number(e.target.value)})}/></label>)}
        <div className="effects-presets"><button onClick={()=>change({gridSubdivision:16,barOpacity:75,beatOpacity:45,subdivisionOpacity:30})}>清楚对拍</button><button onClick={()=>change({gridSubdivision:8,barOpacity:45,beatOpacity:18,subdivisionOpacity:12})}>柔和网格</button><button onClick={()=>change({barOpacity:0,beatOpacity:0,subdivisionOpacity:0})}>隐藏网格</button></div>
        <p className="parameter-help">数值越高线条越清楚，0% 为完全透明。实线标记小节与拍，虚线标记细分；设置立即生效并自动保存。</p>
      </div>
    </>}
  </section>;
}
