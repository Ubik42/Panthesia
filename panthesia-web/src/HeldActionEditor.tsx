import type { ActionEdit } from "./engine/commands.generated";
import {useEffect,useState} from "react";
import {api,type LoadedSong,type PracticeEditCommand} from "./api";
import {musicalActionPosition,type HeldAction} from "./fingerActions";
export function HeldActionEditor({song,action,rate,busy,perform,commit}:{song:LoadedSong;action:HeldAction;rate:number;busy:boolean;perform:(job:()=>Promise<void>)=>Promise<void>;commit:(command:PracticeEditCommand,message?:string)=>Promise<unknown>}){
 const originalBar=song.measures.find(m=>action.atTick>=m.startTick&&action.atTick<m.endTick)??song.measures[0];
 const [measure,setMeasure]=useState(originalBar?.number??1),[beat,setBeat]=useState(Number((1+(action.atTick-(originalBar?.startTick??0))/(song.ppq*4/(originalBar?.denominator??4))).toFixed(6))),[to,setTo]=useState(action.to);
 const [review,setReview]=useState<{token:string;key:string;position:string;unrelatedInvalid:number;baseline:string;rate:number}|null>(null);
 const bar=song.measures.find(m=>m.number===measure);
 const tick=bar?Math.round(bar.startTick+(beat-1)*song.ppq*4/bar.denominator):0;
 const validInput=!!bar&&Number.isSafeInteger(tick)&&tick>0&&tick>=bar.startTick&&tick<bar.endTick&&to!==action.from;
 const draft: ActionEdit | null = song.fingerActionRevision ? {contentId:song.contentId,track:action.track,index:action.index,originalTick:action.atTick,atTick:tick,to,baseline:song.fingerActionRevision,rate} : null;
 const key=JSON.stringify(draft);
 const current=review?.key===key&&review.baseline===song.fingerActionRevision&&review.rate===rate?review:null;
 useEffect(()=>setReview(null),[key]);
 const note=song.notes.find(n=>n.track===action.track&&n.index===action.index);
 const bars=song.measures.filter(m=>note&&m.end>note.start&&m.start<note.start+note.duration);
 return <details className="held-action-editor"><summary>调整拍位与接替手指</summary>
  {!draft&&<p role="status">请重新打开曲目，读取当前换指记录后再调整。</p>}
  <label>小节<select aria-label="换指小节" value={measure} disabled={busy} onChange={e=>{setMeasure(Number(e.target.value));setBeat(1);}}>{bars.map(m=><option value={m.number} key={m.number}>第 {m.number} 小节</option>)}</select></label>
  <label>拍位<input aria-label="换指拍位" type="number" min={1} step={0.01} value={beat} disabled={busy} onChange={e=>setBeat(Number(e.target.value))}/></label>
  <label>接替指<select aria-label="换指接替手指" value={to} disabled={busy} onChange={e=>setTo(Number(e.target.value))}>{[1,2,3,4,5].filter(f=>f!==action.from).map(f=><option value={f} key={f}>{f} 指</option>)}</select></label>
  <small>按当前 {Math.round(rate*100)}% 速度核对相关持音段，不改变起音手指。</small>
  {!validInput&&<small>拍位须在所选小节内，接替手指须不同于原指。</small>}
  <div><button disabled={busy||!validInput||!song.fingerActionRevision} onClick={()=>void perform(async()=>{
   if(!draft)return;
   const data=await api.readPractice<{review:string;at:number;unrelatedInvalid?:number}>(song, {type:"reviewHeldActionEdit",request:draft});
   setReview({token:data.review,key,position:musicalActionPosition(song,data.at),unrelatedInvalid:data.unrelatedInvalid??0,baseline:draft.baseline,rate});
  })}>检查调整</button><button className="primary-button" disabled={busy||!current} onClick={()=>void perform(async()=>{
   if(!current||!draft)return;
   await commit({type:"saveHeldActionEdit",request:draft,review:current.token},"换指调整已保存");setReview(null);
  })}>保存换指调整</button></div>
  {current&&<p role="status">{current.position} · {action.from} → {to} 指。相关持音段通过衔接检查，保存前再次核对。{current.unrelatedInvalid>0?`另有 ${current.unrelatedInvalid} 次换指仍需要审阅。`:""}</p>}
 </details>;
}
