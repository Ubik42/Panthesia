import { useRef, useState } from "react";
import { X, FileUp } from "lucide-react";
import { api } from "../../api";
import type { ImportOptions, ImportPreview } from "../../engine/commands.generated";
import type { SongRow } from "../../engine/sessionTypes";
import { TaskActivity } from "../../engine/TaskActivity";

export function SynthesiaImportDialog({ songs, engineId, close, changed }: {
  songs: readonly SongRow[]; engineId?: string; close: () => void; changed: () => Promise<unknown>;
}) {
  const paths = useRef(songs.map((song) => song.path)).current;
  const [source, setSource] = useState<{name: string; bytes: number[]} | null>(null);
  const [options, setOptions] = useState<ImportOptions>({overwrite:false,fingers:true,hands:true,groups:true});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [saved, setSaved] = useState<{matched:number;sourcePath:string} | null>(null);
  const [refreshError, setRefreshError] = useState("");
  const selection = useRef<HTMLInputElement>(null);
  const changeOptions = (patch: Partial<ImportOptions>) => {setOptions((old)=>({...old,...patch}));setPreview(null);setError("");};
  async function inspect() {
    if(!source || busy) return;
    setBusy(true);setError("");setPreview(null);
    try {setPreview(await api.commandForEngine<ImportPreview>(engineId,{type:"previewSynthesiaMetadata",bytes:source.bytes,paths,options}));}
    catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }
  async function apply() {
    if(!source || !preview || busy) return;
    setBusy(true);setError("");
    try {
      const result=await api.commandForEngine<{matched:number;sourcePath:string}>(engineId,{type:"importSynthesiaMetadata",bytes:source.bytes,paths,options,expected:preview.proof});
      setSaved(result);
      try{await changed();}catch(e){setRefreshError(e instanceof Error?e.message:String(e));}
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }
  return <div className="modal-backdrop" onClick={()=>{if(!busy)close();}}>
    <section className="settings-dialog synthesia-import-dialog" role="dialog" aria-modal="true" aria-labelledby="synthesia-import-title" onClick={(e)=>e.stopPropagation()}>
      <header className="dialog-heading"><div><h2 id="synthesia-import-title">导入 Synthesia 资料</h2><p>为所选 {paths.length} 首 MIDI 匹配曲目信息、指法、分手和分组。</p></div><button aria-label="关闭 Synthesia 资料导入" disabled={busy} onClick={close}><X size={18}/></button></header>
      <TaskActivity label={["预览 Synthesia 资料","导入 Synthesia 资料"]}/>
      {saved ? <>
        <p role="status">已为 {saved.matched} 首曲目保存资料。重新打开曲目后，指法与分手会用于演奏。</p>
        <p className="parameter-help">原始文件和未应用信息已保留在本地资料目录。</p><p className="file-path">{saved.sourcePath}</p>
        {refreshError && <p role="alert">资料已保存，曲库刷新失败：{refreshError}</p>}
        {refreshError && <button disabled={busy} onClick={async()=>{setBusy(true);try{await changed();setRefreshError("");}catch(e){setRefreshError(String(e));}finally{setBusy(false);}}}>重新读取已保存结果</button>}
        <button className="primary" disabled={busy} onClick={close}>完成</button>
      </> : <>
        <p className="parameter-help">按原始 MIDI 内容匹配歌曲。默认保留已有个人资料，并补入缺少的信息。原 MIDI 和原谱保持原文件。</p>
        <input ref={selection} type="file" hidden accept=".synthesia,application/xml,text/xml" aria-label="选择 Synthesia 元数据文件" disabled={busy} onChange={async(e)=>{
          const file=e.target.files?.[0];setSource(null);setPreview(null);setError("");if(!file)return;
          if(file.size>2_000_000){setError("元数据文件最大 2 MB。");return;}
          setBusy(true);try{setSource({name:file.name,bytes:Array.from(new Uint8Array(await file.arrayBuffer()))});}catch(e){setError(String(e));}finally{setBusy(false);}
        }}/>
        <div className="synthesia-import-file"><button disabled={busy} onClick={()=>selection.current?.click()}><FileUp size={17}/>选择元数据文件</button><span>{source?.name ?? "支持 .synthesia 文件，最大 2 MB"}</span></div>
        <fieldset disabled={busy} className="synthesia-import-options"><legend>导入内容</legend>
          <label><input type="checkbox" checked={options.fingers} onChange={(e)=>changeOptions({fingers:e.target.checked})}/>指法与指法中的左右手</label>
          <label><input type="checkbox" checked={options.hands} onChange={(e)=>changeOptions({hands:e.target.checked})}/>来源中的分手与逐音播放规则</label>
          <label><input type="checkbox" checked={options.groups} onChange={(e)=>changeOptions({groups:e.target.checked})}/>歌曲分组</label>
          <label><input type="checkbox" checked={options.overwrite} onChange={(e)=>changeOptions({overwrite:e.target.checked})}/>允许使用来源值替换已有个人资料、指法和分手</label>
        </fieldset>
        <button disabled={!source || busy} onClick={()=>void inspect()}><FileUp size={16}/>{busy?"正在处理…":"预览匹配"}</button>
        {preview && <div className="synthesia-import-results">
          <p role="status">文件含 {preview.sourceSongs} 首歌曲；所选曲目匹配 {preview.matched} / {paths.length} 首。</p>
          {preview.rows.map((row)=><article key={row.path} className="synthesia-import-row"><strong>{row.title}</strong><p>{row.matched?`资料 ${row.fields.length} 项 · 指法 ${row.fingers} 音 · 分手 ${row.hands} 音${options.groups?` · 分组 ${row.groups.length} 个`:""}`:"内容未匹配，保留当前资料"}</p>
            {row.sourceUpdated && <p className="parameter-help">来源默认资料将更新，未勾选替换时保留已有个人修改。</p>}
            {row.warnings.map((warning,index)=><p key={index} className="parameter-help">{warning}</p>)}
          </article>)}
          <button className="primary" disabled={busy || !preview.matched || preview.rows.some((row)=>row.blocked)} onClick={()=>void apply()}>应用匹配资料</button>
        </div>}
        {error && <p role="alert" className="dialog-error">{error}</p>}
      </>}
    </section>
  </div>;
}
