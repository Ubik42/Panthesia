import { ScreenHeader } from "../screens/ScreenHeader";
import { Folder } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api";
import type { LibraryFolder } from "./useLibraryReads";

export function FolderManager({
  close,
  changed,
  backLabel="歌曲",
}: {
  close: () => void;
  backLabel?: string;
  changed: () => Promise<unknown>;
}) {
  const [folders, setFolders] = useState<LibraryFolder[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const read = async () => {
    const result = await api.command<{ folders: LibraryFolder[] }>({
      type: "libraryFolders",
    });
    setFolders(result.folders);
  };
  useEffect(() => {
    void read().catch((e) => setError(String(e)));
  }, []);
  const execute = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await read();
      await changed();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return <main className="product-page product-folders"><ScreenHeader title="歌曲文件夹" back={close} backLabel={backLabel} backDisabled={busy}/><section className="product-folder-list" aria-label="已登记歌曲目录">{!folders.length&&<p>还没有歌曲文件夹。</p>}{folders.map(folder=><article key={folder.path}><Folder size={35}/><div><strong>{folder.kind==="catalog"?"默认曲库":folder.path.replaceAll("\\","/").split("/").filter(Boolean).at(-1)||folder.path}</strong><span>{folder.path}</span></div><small>{folder.available?"已连接":"未连接"}</small>{folder.kind==="folder"&&<button disabled={busy} onClick={()=>void execute(()=>api.command({type:"removeLibraryFolder",path:folder.path}))}>移除</button>}</article>)}</section>{error&&<p className="product-inline-error" role="status">目录操作未能完成。<button onClick={()=>void api.openLogs().catch(()=>{})}>打开日志</button></p>}<footer className="product-page-footer"><span>移除目录后，原文件保持原状。</span><button disabled={busy||!api.desktop} onClick={()=>void execute(()=>api.importFolder())}>添加文件夹…</button><button disabled={busy} onClick={()=>void execute(()=>api.command({type:"refreshLibrary"}))}>{busy?"正在更新…":"重新扫描"}</button></footer></main>;
}
