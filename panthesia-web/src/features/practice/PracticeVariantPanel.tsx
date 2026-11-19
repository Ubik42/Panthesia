import type { LoadedSong } from "../../api";
import type { Variant } from "../../engine/commands.generated";

const names = ["C", "C♯ / D♭", "D", "D♯ / E♭", "E", "F", "F♯ / G♭", "G", "G♯ / A♭", "A", "A♯ / B♭", "B"];
export function PracticeVariantPanel({song, disabled, apply}: {song: LoadedSong; disabled: boolean; apply: (value: Variant) => Promise<unknown>}) {
  const info = song.practiceVariant;
  if (!info) return null;
  const v = {transpose:0,quantize:0,durations:true,tonic:null,minor:null,...info.settings};
  const change = (patch: Partial<Variant>) => { void apply({...v,...patch}); };
  const target = (info.tonic + v.transpose + 120) % 12;
  const cShift = Array.from({length:49},(_,i)=>i-24).filter(n=>(info.tonic+n+120)%12===0)
    .sort((a,b)=>{
      const penalty=(n:number)=>((info.minPitch ?? 60)+n<21 || (info.maxPitch ?? 60)+n>108 ? 100 : 0)+Math.abs(n);
      return penalty(a)-penalty(b);
    })[0] ?? 0;
  const outside = (info.minPitch ?? 60)+v.transpose<21 || (info.maxPitch ?? 60)+v.transpose>108;
  return <details className="practice-variant" key={song.contentId}>
    <summary><span>转调与量化</span><strong>{names[target]} {info.minor ? "小调" : "大调"} · {v.transpose ? `${v.transpose>0?"+":""}${v.transpose} 半音` : "原调"} · {v.quantize ? `1/${v.quantize} 量化` : "原始时序"}</strong></summary>
    <div className="variant-body">
      <fieldset disabled={disabled}>
        <legend>练习音高</legend>
        <div className="variant-transpose"><button aria-label="降低一个八度" disabled={v.transpose< -12} onClick={()=>change({transpose:v.transpose-12})}>−12</button><button aria-label="降低一个半音" disabled={v.transpose<=-24} onClick={()=>change({transpose:v.transpose-1})}>−</button>
          <label>半音 <input aria-label="转调半音" type="number" min={-24} max={24} value={v.transpose} onChange={e=>{const value=Number(e.target.value);if(Number.isInteger(value)&&value>=-24&&value<=24)change({transpose:value});}} /></label>
          <button aria-label="升高一个半音" disabled={v.transpose>=24} onClick={()=>change({transpose:v.transpose+1})}>+</button><button aria-label="升高一个八度" disabled={v.transpose>12} onClick={()=>change({transpose:v.transpose+12})}>+12</button>
          <button onClick={()=>change({transpose:cShift})}>移到 C{info.minor ? "小调" : "大调"}</button></div>
        <div className="variant-key"><span>原曲调性{info.keySource==="estimate"?"（估计，可修改）":info.keySource==="midi"?"（MIDI 标记，可修改）":"（手动）"}</span>
          <select aria-label="原曲主音" value={info.tonic} onChange={e=>change({tonic:Number(e.target.value)})}>{names.map((n,i)=><option key={i} value={i}>{n}</option>)}</select>
          <select aria-label="原曲调式" value={info.minor?"minor":"major"} onChange={e=>change({minor:e.target.value==="minor"})}><option value="major">大调</option><option value="minor">小调</option></select>
        </div>
      </fieldset>
      <fieldset disabled={disabled}><legend>对齐练习网格</legend>
        <label>量化 <select aria-label="练习量化" value={v.quantize} onChange={e=>change({quantize:Number(e.target.value)})}><option value={0}>原始时序</option><option value={8}>八分音符 · 1/8</option><option value={16}>十六分音符 · 1/16</option><option value={32}>三十二分音符 · 1/32</option></select></label>
        <label><input type="checkbox" checked={v.durations} onChange={e=>change({durations:e.target.checked})}/>同时量化时值</label>
        <button onClick={()=>change({transpose:0,quantize:0})} disabled={!info.active}>恢复原始演奏</button>
      </fieldset>
      <p>设置按曲目自动保存。切换后暂停播放；音符、声音、等音和 MIDI 简谱同步更新。转调保留大小调性质。量化保留速度变化与踏板时序。</p>
      {info.active && info.sourceHasScore && <p>当前显示练习版 MIDI 五线谱。原始关联谱保留，恢复原始演奏后可查看。</p>}
      {outside && <p className="variant-warning">转调后部分音符超出 88 键钢琴音域。请缩小转调幅度，以便用实体钢琴练习。</p>}
    </div>
  </details>;
}
