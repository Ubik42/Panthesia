import { useEffect, useState } from "react";
import { FolderSearch, RefreshCw } from "lucide-react";
import { api } from "../../api";
import type { MetadataDiscovery, MetadataSourceCandidate } from "../../engine/commands.generated";

export function DiscoveredMetadataSources({ paths, engineId, disabled, selected, choose }: {
  paths: string[];
  engineId?: string;
  disabled: boolean;
  selected: string | null;
  choose: (source: MetadataSourceCandidate) => void;
}) {
  const [view, setView] = useState<MetadataDiscovery | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [revision, setRevision] = useState(0), [all, setAll] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);setError("");
    void api.commandForEngine<MetadataDiscovery>(engineId,{type:"discoverSynthesiaMetadata",paths,refresh:revision>0})
      .then(result => {if(active)setView(result);})
      .catch(error => {if(active)setError(error instanceof Error ? error.message : String(error));})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[paths,engineId,revision]);
  const matched = view?.files.filter(file=>file.matchedPaths.length) ?? [];
  const rows = all ? view?.files ?? [] : view?.files.filter(file=>file.matchedPaths.length || file.pending || file.error) ?? [];
  return <section className="metadata-discovery" aria-label="曲库中发现的资料文件" aria-busy={loading}>
    <header><h3><FolderSearch size={17}/>曲库中发现的资料文件</h3>
      <button disabled={disabled||loading} onClick={()=>setRevision(value=>value+1)}><RefreshCw size={14}/>{loading?"正在查找…":"重新查找"}</button></header>
    <p className="parameter-help">查找已登记曲库目录及所选 MIDI 所在目录。仅向本次所选曲目应用资料。</p>
    {loading && <p role="status">正在核对来源文件与所选 MIDI…</p>}
    {error && <p className="dialog-error" role="alert">{error}</p>}
    {view && <>
      <div className="metadata-discovery-filter"><span>发现 {view.files.length} 份 · 匹配所选曲目的 {matched.length} 份</span>
        <label><input type="checkbox" checked={all} disabled={disabled||loading} onChange={event=>setAll(event.target.checked)}/>显示未匹配文件</label></div>
      {!loading&&!rows.length&&<p>{view.files.length?"当前所选曲目没有匹配的资料文件。可切换曲目范围，或手动选择其他文件。":"当前范围未发现 .synthesia 文件。可手动选择文件，或登记包含资料的曲库目录。"}</p>}
      <div className="metadata-discovery-list">{rows.map(file=><article key={file.path} data-selected={selected===file.path+file.sourceId?"":undefined}>
        <div><strong>{file.name}</strong><p className="file-path">{file.path}</p>
          <small>{file.songs} 首来源歌曲 · 匹配所选 {file.matchedPaths.length} 首{file.applied?` · ${file.applied} 首已应用当前版本`:""}{file.updates?` · ${file.updates} 首已有其他来源版本`:""}</small>
          {file.pending&&<p role="status">来源正在建立索引，请稍后重新查找。</p>}
          {file.error&&<p className="dialog-error">{file.error}</p>}
        </div>
        <button disabled={disabled||loading||!file.sourceId||!!file.error||!file.matchedPaths.length} aria-pressed={selected===file.path+file.sourceId} onClick={()=>choose(file)}>
          {selected===file.path+file.sourceId?"已选来源":"使用此来源"}</button>
      </article>)}</div>
      {!!view.errors.length&&<details className="metadata-discovery-errors"><summary>查找范围说明 · {view.errors.length} 项</summary>{view.errors.map((error,index)=><p key={index}>{error}</p>)}</details>}
    </>}
  </section>;
}
