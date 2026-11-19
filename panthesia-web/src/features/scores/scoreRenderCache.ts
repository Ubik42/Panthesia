import type { RendererNoteEvidence } from "./mappingTypes";

export interface RenderedScore {
  pages: string[];
  midi: number[];
  notes: RendererNoteEvidence[];
}

// Cache display artifacts only. Mapping tokens belong to the current engine revision.
const cache = new Map<string, { result: RenderedScore; size: number }>();
const limit = 32 * 1024 * 1024;
let used = 0;
function cleanSvg(source: string) {
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  doc.querySelectorAll("script,foreignObject,image,iframe").forEach(e => e.remove());
  doc.querySelectorAll("*").forEach(e => {
    for (const a of Array.from(e.attributes)) {
      if (a.name.toLowerCase().startsWith("on") ||
        (["href", "xlink:href"].includes(a.name) && !a.value.startsWith("#"))) e.removeAttribute(a.name);
    }
  });
  doc.querySelectorAll("g.note[data-id]").forEach(n => {
    if (!n.id) n.setAttribute("id", n.getAttribute("data-id")!);
  });
  return new XMLSerializer().serializeToString(doc.documentElement);
}

export async function renderScore(
  asset: { bytes: number[]; compressed: boolean },
  signal: AbortSignal,
  progress: (stage: string, page?: number, total?: number) => void,
): Promise<RenderedScore> {
  // Hash the displayed bytes: original source fingerprints can stay the same after transposition.
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(asset.bytes));
  signal.throwIfAborted();
  const key = `a4-v1:${asset.compressed}:${Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("")}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit.result;
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker("/verovio/worker.mjs", { type: "module" });
    const finish = () => { worker.terminate(); signal.removeEventListener("abort", abort); };
    const abort = () => { finish(); reject(signal.reason ?? new DOMException("Aborted", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = e => { finish(); reject(new Error(e.message || "乐谱渲染器启动失败")); };
    worker.onmessage = ({ data }) => {
      if (data.progress) { progress(data.stage, data.page, data.total); return; }
      finish();
      if (data.error) { reject(new Error(data.error)); return; }
      try {
        const result: RenderedScore = {
          pages: data.pages.map(cleanSvg),
          midi: Array.from(atob(data.midi), c => c.charCodeAt(0)),
          notes: data.notes,
        };
        const size = result.pages.reduce((sum, page) => sum + page.length * 2, 0) + result.midi.length * 8 + result.notes.length * 160;
        if (size <= limit) {
          while (cache.size && (used + size > limit || cache.size >= 3)) {
            const oldest = cache.keys().next().value!;
            used -= cache.get(oldest)!.size;
            cache.delete(oldest);
          }
          cache.set(key, { result, size });
          used += size;
        }
        resolve(result);
      } catch (cause) { reject(cause); }
    };
    worker.postMessage({ bytes: asset.bytes, compressed: asset.compressed, progress: true });
  });
}
