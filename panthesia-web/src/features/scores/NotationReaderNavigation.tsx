import {useEffect,useState} from "react";
import type {useNotationReader} from "./useNotationReader";
export function NotationReaderNavigation({reader}:{reader:ReturnType<typeof useNotationReader>}){
  const {scope}=reader,[measure,setMeasure]=useState(1);
  useEffect(()=>setMeasure((scope?.first??0)+1),[scope]);
  return <>
    <button type="button" disabled={!reader.canPrevious} onClick={reader.previous}>上一页</button>
    <output aria-live="polite">{scope?`第 ${scope.firstNumber}–${scope.lastNumber} 小节 · ${reader.page+1} / ${reader.pages.length} 页`:"乐谱"}</output>
    <button type="button" disabled={!reader.canNext} onClick={reader.next}>下一页</button>
    {scope&&scope.count<scope.total&&<label>前往小节 <input type="number" aria-label="查看原谱小节" min={1} max={scope.total} value={measure} disabled={reader.busy} style={{width:80}} onChange={e=>setMeasure(Number(e.target.value))} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();reader.jump(measure);}}}/><button type="button" disabled={reader.busy||!Number.isInteger(measure)||measure<1||measure>scope.total} onClick={()=>reader.jump(measure)}>查看</button></label>}
  </>;
}
