import { rendererInput } from "./rendererInput";
import type { RendererNoteEvidence } from "./mappingTypes";
export interface ScorePages {
  readonly length: number;
  readonly key: string;
  get(index: number, signal?: AbortSignal): Promise<string>;
}
export const emptyScorePages: ScorePages = {
  length: 0,
  key: "",
  get: async () => "",
};
export interface RenderedScore {
  pages: ScorePages;
  evidence(): Promise<{ midi: number[]; notes: RendererNoteEvidence[] }>;
}
// Only visible page artifacts survive a view. WASM layouts are leased and
// released with their owning screen; no full-score SVG array is retained.
const pages = new Map<string, string>();
const pageBudget = 32 * 1024 * 1024;
let pageBytes = 0;
function retain(key: string, svg: string) {
  const size = svg.length * 2;
  if (size > pageBudget) return;
  while (pages.size && (pageBytes + size > pageBudget || pages.size >= 16)) {
    const oldest = pages.keys().next().value!;
    pageBytes -= pages.get(oldest)!.length * 2;
    pages.delete(oldest);
  }
  pages.set(key, svg);
  pageBytes += size;
}
function cleanSvg(source: string) {
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  if (doc.documentElement.localName !== "svg")
    throw new Error("谱页内容无法读取");
  doc
    .querySelectorAll("script,foreignObject,image,iframe")
    .forEach((e) => e.remove());
  doc.querySelectorAll("*").forEach((e) => {
    for (const a of Array.from(e.attributes))
      if (
        a.name.toLowerCase().startsWith("on") ||
        (["href", "xlink:href"].includes(a.name) && !a.value.startsWith("#"))
      )
        e.removeAttribute(a.name);
  });
  doc.querySelectorAll("g.note[data-id]").forEach((n) => {
    if (!n.id) n.setAttribute("id", n.getAttribute("data-id")!);
  });
  return new XMLSerializer().serializeToString(doc.documentElement);
}
type Response = {
  count?: number;
  svg?: string;
  midi?: string;
  notes?: RendererNoteEvidence[];
};
type Pending = {
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
  progress?: (stage: string, page?: number, total?: number) => void;
};
class Layout {
  private worker = new Worker("/verovio/worker.mjs", { type: "module" });
  private pending = new Map<number, Pending>();
  private inFlight = new Map<number, Promise<string>>();
  private serial = 0;
  private ended = false;
  readonly ready: Promise<number>;
  private indexed?: ReturnType<RenderedScore["evidence"]>;
  constructor(
    readonly key: string,
    asset: {
      bytes: number[];
      compressed: boolean;
      alterations?: [string, string][];
    },
    progress: Pending["progress"],
    pageWidth: number,
  ) {
    this.worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.id);
      if (!request) return;
      if (data.progress) {
        request.progress?.(data.stage, data.page, data.total);
        return;
      }
      this.pending.delete(data.id);
      data.error
        ? request.reject(new Error(data.error))
        : request.resolve(data);
    };
    this.worker.onerror = (e) =>
      this.close(new Error(e.message || "乐谱渲染器启动失败"));
    const bytes = new Uint8Array(asset.bytes);
    this.ready = this.request(
      {
        type: "open",
        bytes: bytes.buffer,
        compressed: asset.compressed,
        alterations: asset.alterations,
        pageWidth,
      },
      progress,
      [bytes.buffer],
    ).then((r) => r.count!);
    void this.ready.catch(() => {});
  }
  private request(
    message: object,
    progress?: Pending["progress"],
    transfer: Transferable[] = [],
  ) {
    if (this.ended)
      return Promise.reject<Response>(
        new DOMException("谱面已关闭", "AbortError"),
      );
    const id = ++this.serial;
    return new Promise<Response>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, progress });
      this.worker.postMessage({ ...message, id }, transfer);
    });
  }
  close(reason: unknown = new DOMException("谱面已关闭", "AbortError")) {
    if (this.ended) return;
    this.ended = true;
    this.worker.terminate();
    for (const request of this.pending.values()) request.reject(reason);
    this.pending.clear();
    this.inFlight.clear();
    if (layouts.get(this.key)?.layout === this) layouts.delete(this.key);
  }
  async page(index: number, signal?: AbortSignal): Promise<string> {
    if (this.ended) throw new DOMException("谱面已关闭", "AbortError");
    signal?.throwIfAborted();
    const count = await this.ready;
    signal?.throwIfAborted();
    if (!Number.isInteger(index) || index < 0 || index >= count)
      throw new Error("谱页位置无效");
    const key = `${this.key}:${index}`,
      hit = pages.get(key);
    if (hit !== undefined) {
      pages.delete(key);
      pages.set(key, hit);
      return hit;
    }
    let work = this.inFlight.get(index);
    if (!work) {
      work = this.request({ type: "page", page: index })
        .then((result) => {
          const svg = cleanSvg(result.svg!);
          retain(key, svg);
          return svg;
        })
        .finally(() => this.inFlight.delete(index));
      this.inFlight.set(index, work);
    }
    const result = await work;
    signal?.throwIfAborted();
    return result;
  }
  evidence(progress: Pending["progress"]) {
    return (this.indexed ??= this.request({ type: "evidence" }, progress).then(
      (r) => ({
        midi: Array.from(atob(r.midi!), (c) => c.charCodeAt(0)),
        notes: r.notes!,
      }),
    ));
  }
}
type LayoutLease = {
  ready: Promise<Layout>;
  layout?: Layout;
  references: number;
};
const layouts = new Map<string, LayoutLease>();
export async function renderScore(
  asset: { bytes: number[]; compressed: boolean },
  signal: AbortSignal,
  progress: (stage: string, page?: number, total?: number) => void,
  /** Verovio page width in its own units; 2100 is A4 portrait. */
  pageWidth = 2100,
): Promise<RenderedScore> {
  signal.throwIfAborted();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(asset.bytes),
  );
  signal.throwIfAborted();
  const key = `pages-v4:${pageWidth}:${asset.compressed}:${Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("")}`;
  let lease = layouts.get(key);
  if (!lease) {
    const created = { references: 0 } as LayoutLease;
    created.ready = rendererInput(asset)
      .then((input) => {
        if (!created.references)
          throw new DOMException("谱面已关闭", "AbortError");
        const layout = new Layout(key, input, progress, pageWidth);
        created.layout = layout;
        return layout;
      })
      .catch((error) => {
        if (layouts.get(key) === created) layouts.delete(key);
        throw error;
      });
    layouts.set(key, created);
    lease = created;
  }
  const ownedLease = lease;
  ownedLease.references++;
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      if (--ownedLease.references === 0) {
        if (layouts.get(key) === ownedLease) layouts.delete(key);
        void ownedLease.ready.then(
          (layout) => layout.close(),
          () => {},
        );
      }
    }
    signal.removeEventListener("abort", release);
  };
  signal.addEventListener("abort", release, { once: true });
  if (signal.aborted) release();
  try {
    const owned = await ownedLease.ready;
    const count = await owned.ready;
    signal.throwIfAborted();
    // Make the initial reading page available before mapping preparation starts.
    await owned.page(0, signal);
    signal.throwIfAborted();
    return {
      pages: {
        length: count,
        key,
        get: (index, requestSignal) => {
          signal.throwIfAborted();
          return owned.page(index, requestSignal ?? signal);
        },
      },
      evidence: () => {
        signal.throwIfAborted();
        return owned.evidence(progress);
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}
