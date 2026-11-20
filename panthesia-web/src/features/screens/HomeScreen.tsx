import { useMemo, useState } from "react";
import type { CollectionSong, SongRow } from "../../api";
import { pathKey } from "../../engine/pathIdentity";
import { product } from "../../product.generated";
import { useSongCatalog } from "../library/useSongCatalog";
export function HomeScreen({
  rows,
  collection,
  disabled,
  choose,
  freePlay,
  settings,
  open,
}: {
  rows: readonly SongRow[];
  collection: readonly CollectionSong[];
  disabled: boolean;
  choose: () => void;
  freePlay: () => void;
  settings: () => void;
  open: (row: SongRow) => Promise<boolean>;
}) {
  const [pending, setPending] = useState(false);
  const { catalog } = useSongCatalog(rows);
  const recent = useMemo(() => {
    const byId = new Map(
      rows.filter((r) => r.contentId).map((r) => [r.contentId, r]),
    );
    const byPath = new Map(rows.map((r) => [pathKey(r.path), r]));
    const performances = new Map(
      catalog?.performances.map((p) => [p.contentId, p]) ?? [],
    );
    const seen = new Set<string>();
    const result: SongRow[] = [];
    for (const item of [...collection]
      .filter((r) => r.lastUsed > 0)
      .sort((a, b) => b.lastUsed - a.lastUsed)) {
      const row =
        byId.get(item.contentId) ??
        (item.path ? byPath.get(pathKey(item.path)) : undefined);
      const performance = performances.get(item.contentId);
      const key = performance?.workId ?? item.contentId;
      if (!row || seen.has(key)) continue;
      seen.add(key);
      result.push({
        ...row,
        title: performance?.title || item.title || row.title,
      });
      if (result.length === 8) break;
    }
    return result;
  }, [rows, collection, catalog]);
  return (
    <main className="product-home" aria-label="主页">
      <header className="product-home-brand">
        <img src="/brand.svg" alt="" />
        <h1>{product.name}</h1>
      </header>
      <div className="product-home-body">
        <nav className="product-home-actions" aria-label="主菜单">
          <button disabled={disabled || pending} onClick={choose}>
            选择歌曲
          </button>
          <button disabled={disabled || pending} onClick={freePlay}>
            自由演奏
          </button>
          <button
            className="product-home-settings"
            disabled={disabled || pending}
            onClick={settings}
          >
            设置
          </button>
        </nav>
        <section className="product-home-recent">
          <h2>最近演奏</h2>
          <div className="product-recent-list">
            {recent.map((row) => (
              <button
                key={row.contentId ?? row.path}
                disabled={disabled || pending}
                onClick={async () => {
                  setPending(true);
                  try {
                    await open(row);
                  } finally {
                    setPending(false);
                  }
                }}
              >
                {row.title}
              </button>
            ))}
            {!recent.length && <p>从“选择歌曲”开始演奏。</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
