import {useEffect,useRef,useState} from "react";
import {emptyScorePages,renderScore} from "./scoreRenderCache";
import {useScorePage} from "./useScorePage";
import {openNotationReader,type NotationInput} from "./notationReader";
import type {NotationReadWindow} from "./notationReadTypes";
export function useNotationReader(source:NotationInput|null){
  const [pages,setPages]=useState(emptyScorePages),[page,setPage]=useState(0),[scope,setScope]=useState<NotationReadWindow["range"]|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[status,setStatus]=useState("正在读取谱面…"),[retry,setRetry]=useState(0);
  const reader=useRef<Awaited<ReturnType<typeof openNotationReader>>|null>(null),owner=useRef<AbortController|null>(null),layout=useRef<AbortController|null>(null),sequence=useRef(0);
  const display=async(data:NotationReadWindow,ticket:number,last=false)=>{
    const currentOwner=owner.current;if(!currentOwner||currentOwner.signal.aborted||ticket!==sequence.current)return;
    const next=new AbortController(),abort=()=>next.abort();currentOwner.signal.addEventListener("abort",abort,{once:true});
    try{
      const rendered=await renderScore(data,next.signal,()=>{});
      if(currentOwner.signal.aborted||ticket!==sequence.current){next.abort();return;}
      layout.current?.abort();layout.current=next;setPages(rendered.pages);setScope(data.range);setPage(last?rendered.pages.length-1:0);setError("");setStatus("");
    }catch(error){next.abort();throw error;}
    finally{currentOwner.signal.removeEventListener("abort",abort);}
  };
  useEffect(()=>{
    const controller=new AbortController(),ticket=++sequence.current;owner.current=controller;reader.current=null;
    setPages(emptyScorePages);setScope(null);setPage(0);setError("");setStatus("正在读取谱面…");setBusy(!!source);
    if(source)void openNotationReader(source,controller.signal,text=>{if(!controller.signal.aborted)setStatus(text);}).then(async prepared=>{if(controller.signal.aborted)return;reader.current=prepared;await display(prepared.initial,ticket);}).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:String(error));}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>{sequence.current++;controller.abort();layout.current?.abort();layout.current=null;};
  },[source,retry]);
  const load=async(first:number,last=false)=>{
    if(busy||!reader.current)return;const ticket=++sequence.current;setBusy(true);setError("");setStatus("正在读取谱面范围…");
    try{await display(await reader.current.window(first),ticket,last);}catch(error){if(!owner.current?.signal.aborted&&ticket===sequence.current)setError(error instanceof Error?error.message:String(error));}
    finally{if(!owner.current?.signal.aborted&&ticket===sequence.current)setBusy(false);}
  };
  return {pages,page,scope,busy,error,status,pageView:useScorePage(pages,page),
    canPrevious:!busy&&(page>0||scope?.previous!=null),canNext:!busy&&(page+1<pages.length||scope?.next!=null),
    previous:()=>{if(page>0)setPage(page-1);else if(scope?.previous!=null)void load(scope.previous,true);},
    next:()=>{if(page+1<pages.length)setPage(page+1);else if(scope?.next!=null)void load(scope.next);},
    jump:(measure:number)=>{if(Number.isInteger(measure)&&measure>=1&&scope&&measure<=scope.total)void load(measure-1);},
    retry:()=>setRetry(value=>value+1)};
}
