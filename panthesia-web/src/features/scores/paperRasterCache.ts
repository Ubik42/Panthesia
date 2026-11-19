import { api } from "../../api";

type Asset = { id: string; kind: string; available: boolean };
interface Entry {
  key: string;
  asset: Asset;
  pageIndex: number;
  generation: number;
  image?: HTMLImageElement;
  discarded: boolean;
  result: Promise<HTMLImageElement>;
  resolve: (image: HTMLImageElement) => void;
  reject: (error: unknown) => void;
}
/** One reader owns bounded decoded pages and at most two concurrent reads/decodes. */
export function createPaperRasterCache(
  contentId: string,
  book: string,
  previewKind?: string,
) {
  const entries = new Map<string, Entry>(),
    queue: Entry[] = [];
  let disposed = false,
    generation = 0,
    active = 0;
  const obsolete = () => new Error("已选择新的谱页，原页面读取已结束");
  const discard = (entry: Entry) => {
    entry.discarded = true;
    entries.delete(entry.key);
    entry.reject(obsolete());
    const index = queue.indexOf(entry);
    if (index >= 0) queue.splice(index, 1);
  };
  const prune = () => {
    let pixels = 0;
    const rows = [...entries.values()];
    for (let index = rows.length - 1; index >= 0; index--) {
      const entry = rows[index],
        size = entry.image
          ? entry.image.naturalWidth * entry.image.naturalHeight
          : 0;
      if (rows.length - index > 4 || pixels + size > 24_000_000) {
        // A large completed page can still be drawn by its caller without retaining it in the cache.
        if (entry.image) entries.delete(entry.key);
        else discard(entry);
      } else pixels += size;
    }
  };
  const valid = (entry: Entry) =>
    !disposed && !entry.discarded && entry.generation === generation;
  async function run(entry: Entry) {
    try {
      const bytes = await api.readScoreAttachment(
        contentId,
        book,
        entry.pageIndex,
        previewKind,
        entry.asset.id,
      );
      if (!valid(entry)) throw obsolete();
      const url = URL.createObjectURL(
        new Blob([bytes.slice().buffer], { type: `image/${entry.asset.kind}` }),
      );
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        if (!valid(entry)) throw obsolete();
        if (
          !image.naturalWidth ||
          !image.naturalHeight ||
          image.naturalWidth * image.naturalHeight > 64_000_000
        )
          throw new Error(
            "谱页图片过大或尺寸无效，请使用 6400 万像素以内的图片",
          );
        entry.image = image;
        entry.resolve(image);
        prune();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      if (entries.get(entry.key) === entry) entries.delete(entry.key);
      entry.reject(error);
    } finally {
      active--;
      pump();
    }
  }
  function pump() {
    if (disposed) return;
    while (active < 2 && queue.length) {
      const entry = queue.pop()!;
      if (!valid(entry)) {
        entry.reject(obsolete());
        continue;
      }
      active++;
      void run(entry);
    }
  }
  return {
    load(asset: Asset, pageIndex: number) {
      if (disposed) return Promise.reject(new Error("谱页阅读窗口已经关闭"));
      if (!asset.available)
        return Promise.reject(new Error("该谱页副本缺失，请重新添加"));
      const key = JSON.stringify([asset.id, pageIndex, asset.kind]),
        cached = entries.get(key);
      if (cached) {
        entries.delete(key);
        entries.set(key, cached);
        return cached.result;
      }
      let resolve!: Entry["resolve"], reject!: Entry["reject"];
      const result = new Promise<HTMLImageElement>((accept, fail) => {
        resolve = accept;
        reject = fail;
      });
      const entry: Entry = {
        key,
        asset,
        pageIndex,
        generation,
        discarded: false,
        result,
        resolve,
        reject,
      };
      void result.catch(() => {});
      entries.set(key, entry);
      queue.push(entry);
      prune();
      pump();
      return result;
    },
    activate() {
      disposed = false;
      pump();
    },
    dispose() {
      disposed = true;
      generation++;
      for (const entry of [...entries.values()]) discard(entry);
      entries.clear();
      queue.length = 0;
    },
  };
}
