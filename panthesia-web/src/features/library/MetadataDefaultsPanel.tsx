import { useEffect, useState } from "react";
import { metadataFields } from "./metadataFields";
import type { Metadata, MetadataDefaults, MetadataField } from "./metadataTypes";
import "./metadataDefaults.css";

const display = (value: Metadata[MetadataField]) =>
  Array.isArray(value) ? value.join("，") || "（空）" : value || "（空）";

export function MetadataDefaultsPanel({ read, revision, base, disabled, reset }: {
  read: () => Promise<MetadataDefaults>;
  revision: number;
  base: Metadata;
  disabled: boolean;
  reset: (view: MetadataDefaults, fields: MetadataField[]) => Promise<void>;
}) {
  const [view, setView] = useState<MetadataDefaults | null>(null);
  const [selected, setSelected] = useState<MetadataField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void read().then(value => {
      if (active) { setView(value); setSelected([]); }
    }).catch(failure => {
      if (active) { setView(null); setError(failure instanceof Error ? failure.message : String(failure)); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [read, revision, refresh]);
  const layers = view?.layers;
  const matches = view && metadataFields.every(([field]) =>
    JSON.stringify(view.value[field]) === JSON.stringify(base[field]));
  const blocked = disabled || loading || !matches;
  return <details className="metadata-defaults">
    <summary>资料来源与个人修改{layers ? <span>{layers.overridden.length} 项个人覆盖</span> : null}</summary>
    {loading ? <p role="status">正在读取资料来源…</p> : error ?
      <div role="alert"><p>{error}</p><button disabled={disabled} onClick={() => setRefresh(value => value + 1)}>重新读取来源</button></div> :
      !layers ? <p>这首曲目尚未导入来源默认资料。当前填写的内容作为个人资料保存。</p> : <>
        <p>来源：Synthesia 资料文件。个人修改会在下次导入时保留；恢复后，该字段随来源资料更新。</p>
        {!matches && <p role="status">资料已变化，请先读取最新资料并审阅。</p>}
        <div className="metadata-defaults-scroll"><table>
          <thead><tr><th>恢复</th><th>字段</th><th>当前采用</th><th>来源默认值</th></tr></thead>
          <tbody>{metadataFields.map(([field, label]) => {
            const personal = layers.overridden.includes(field);
            return <tr key={field}>
              <td><input type="checkbox" aria-label={`恢复${label}的来源默认值`}
                disabled={blocked || !personal} checked={selected.includes(field)}
                onChange={event => setSelected(previous => event.target.checked ? [...previous, field] : previous.filter(value => value !== field))}/></td>
              <th scope="row">{label}<small>{personal ? "个人修改" : "随来源更新"}</small></th>
              <td>{display(view.value[field])}</td><td>{display(layers.defaults[field])}</td>
            </tr>;
          })}</tbody>
        </table></div>
        <div className="metadata-defaults-actions">
          <button disabled={blocked || !layers.overridden.length} onClick={() => setSelected([...layers.overridden])}>选择全部个人修改</button>
          <button className="primary-button" disabled={blocked || !selected.length} onClick={() => void reset(view, selected)}>恢复所选来源默认值{selected.length ? `（${selected.length}）` : ""}</button>
        </div>
        {disabled && <p className="parameter-help">请先保存或处理当前输入，再恢复来源默认值。</p>}
      </>}
  </details>;
}
