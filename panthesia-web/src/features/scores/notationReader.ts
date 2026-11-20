import {api} from "../../api";
import type {NotationReadWindow} from "./notationReadTypes";
export type NotationInput=Blob|Uint8Array|number[];
const chunkSize=524288;
/** One upload and one immutable background index, released with its owning view. */
export async function openNotationReader(source:NotationInput,signal:AbortSignal,progress:(text:string)=>void){
  signal.throwIfAborted();
  const id=crypto.randomUUID(),size=source instanceof Blob?source.size:source.length;
  let ended=false,heartbeat:ReturnType<typeof setInterval>|undefined;
  const leave=(event:PageTransitionEvent)=>{if(!event.persisted)release();};
  const release=()=>{ended=true;if(heartbeat)clearInterval(heartbeat);signal.removeEventListener("abort",release);window.removeEventListener("pagehide",leave);void api.readNotation({type:"release",id}).catch(()=>{});};
  signal.addEventListener("abort",release,{once:true});
  window.addEventListener("pagehide",leave);
  try{
    await api.readNotation({type:"begin",id,size});signal.throwIfAborted();
    for(let offset=0;offset<size;offset+=chunkSize){
      const bytes=source instanceof Blob?Array.from(new Uint8Array(await source.slice(offset,offset+chunkSize).arrayBuffer())):Array.from(source.slice(offset,offset+chunkSize));
      signal.throwIfAborted();progress(`正在读取谱面 ${Math.round(Math.min(size,offset+bytes.length)/size*100)}%…`);
      const reply=await api.readNotation<{received:number}>({type:"append",id,offset,bytes});
      if(reply.received!==offset+bytes.length)throw Error("谱面读取进度不一致");signal.throwIfAborted();
    }
    progress("正在整理谱面范围…");const initial=await api.readNotation<NotationReadWindow>({type:"prepare",id});signal.throwIfAborted();
    heartbeat=setInterval(()=>{if(!ended)void api.readNotation({type:"touch",id}).catch(()=>{});},60000);
    return {initial,window:async(first:number)=>{signal.throwIfAborted();const result=await api.readNotation<NotationReadWindow>({type:"window",id,first});signal.throwIfAborted();return result;}};
  }catch(error){release();throw signal.aborted?signal.reason:error;}
}
