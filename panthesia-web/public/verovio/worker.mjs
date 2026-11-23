import createModule from "./module.mjs";
import { VerovioToolkit } from "./toolkit.mjs";
import { createMidiValueIndex } from "./midi-value-index.mjs";
let toolkit,
  lineToolkit,
  count = 0,
  lines = [];
/** Line view: the systems of the auto layout at the pane's width, each as its first and last
 * measure and the notes it holds. A line is then laid out alone by a second toolkit that
 * renders only that measure range (breaks "none"), so every line has its own clef and key. */
function computeLines() {
  const out = [];
  for (let page = 1; page <= count; page++) {
    const svg = toolkit.renderToSVG(page);
    for (const tag of svg.matchAll(/<g\b([^>]*)>/g)) {
      const attrs = tag[1];
      const kind = attrs.match(/\bclass="([^"]*)"/)?.[1] ?? "";
      const id = attrs.match(/\bdata-id="([^"]*)"/)?.[1] ?? attrs.match(/\bid="([^"]*)"/)?.[1];
      if (/(^|\s)system(\s|$)/.test(kind)) out.push({ page: page - 1, first: "", last: "", notes: [] });
      else if (!out.length || !id) continue;
      else if (/(^|\s)measure(\s|$)/.test(kind)) {
        const line = out[out.length - 1];
        if (!line.first) line.first = id;
        line.last = id;
      } else if (/(^|\s)note(\s|$)/.test(kind)) out[out.length - 1].notes.push(id);
    }
  }
  return out.filter((line) => line.first);
}
function layoutOptions(pageWidth) {
  return {
    breaks: "auto",
    // A fitted layout (page width given) reflows to the pane: pages are as tall as their systems.
    pageWidth: pageWidth ?? 2100,
    adjustPageHeight: pageWidth != null,
    // The stage shows the title already; a header would make the first system too tall.
    ...(pageWidth != null ? { header: "none", footer: "none" } : {}),
    pageHeight: 2970,
    scale: 40,
    svgHtml5: true,
    svgViewBox: true,
    xmlIdChecksum: true,
    expandNever: true,
  };
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    const progress = (stage, page, total) =>
      self.postMessage({ id, progress: true, stage, page, total });
    if (type === "open") {
      progress("initializing");
      toolkit = new VerovioToolkit(await createModule());
      toolkit.setOptions(layoutOptions(data.pageWidth));
      const bytes = new Uint8Array(data.bytes);
      progress("loading");
      const ok = data.compressed
        ? toolkit.loadZipDataBuffer(bytes.buffer)
        : toolkit.loadData(new TextDecoder().decode(bytes));
      if (!ok) throw new Error("无法读取这份乐谱");
      if (data.alterations?.length) {
        const alterations = new Map(data.alterations);
        const mei = toolkit
          .getMEI()
          .replace(
            /<note\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/note>)/g,
            (whole, head, body = "") => {
              const id = head.match(/\bxml:id="([^"]+)"/)?.[1],
                alter = alterations.get(id);
              if (!alter) return whole;
              const accids = [...body.matchAll(/<accid\b/g)];
              if (accids.length > 1) return whole;
              if (accids.length)
                body = body.replace(
                  /<accid\b([^>]*?)(\/?>)/,
                  (tag, attrs, end) =>
                    `<accid${attrs.replace(/\s+accid\.ges="[^"]*"/g, "")} accid.ges="${alter}"${end}`,
                );
              else body = `<accid accid.ges="${alter}"/>` + body;
              return `<note${head}>${body}</note>`;
            },
          );
        if (!toolkit.loadData(mei)) throw new Error("谱面音高投影无法读取");
      }
      count = toolkit.getPageCount();
      if (!Number.isSafeInteger(count) || count < 1)
        throw new Error("这份文件未生成可显示的谱页");
      if (data.lines) {
        progress("lines");
        lineToolkit = new VerovioToolkit(await createModule());
        lineToolkit.setOptions({
          breaks: "none",
          header: "none",
          footer: "none",
          scale: 40,
          svgHtml5: true,
          svgViewBox: true,
          xmlIdChecksum: true,
          expandNever: true,
          adjustPageWidth: true,
          adjustPageHeight: true,
        });
        if (!lineToolkit.loadData(toolkit.getMEI())) throw new Error("谱面单行排版无法读取");
        lines = computeLines();
      }
      self.postMessage({ id, count, lines: data.lines ? lines : undefined });
    } else if (type === "page") {
      if (
        !toolkit ||
        !Number.isInteger(data.page) ||
        data.page < 0 ||
        data.page >= count
      )
        throw new Error("谱页位置无效");
      self.postMessage({
        id,
        page: data.page,
        svg: toolkit.renderToSVG(data.page + 1),
      });
    } else if (type === "relayout") {
      // The pane changed width: break the score into lines again.
      if (!toolkit || !lineToolkit) throw new Error("谱面尚未排版");
      toolkit.setOptions(layoutOptions(data.pageWidth));
      toolkit.redoLayout();
      count = toolkit.getPageCount();
      lines = computeLines();
      self.postMessage({ id, count, lines });
    } else if (type === "line") {
      const line = lines[data.line];
      if (!lineToolkit || !line) throw new Error("谱面行位置无效");
      lineToolkit.select({ start: line.first, end: line.last });
      lineToolkit.redoLayout();
      self.postMessage({ id, line: data.line, svg: lineToolkit.renderToSVG(1) });
    } else if (type === "evidence") {
      if (!toolkit) throw new Error("谱面尚未排版");
      progress("midi");
      const midi = toolkit.renderToMIDI(),
        notes = [];
      let values;
      try {
        values = createMidiValueIndex(toolkit);
      } catch {
        values = new Map();
      }
      // Page MEI carries the renderer's actual page membership and IDs. SVGs are
      // generated only for requested pages, never to discover note identities.
      for (let page = 1; page <= count; page++) {
        progress("index", page, count);
        const mei = toolkit.getMEI({ pageNo: page });
        for (const tag of mei.matchAll(/<note\b([^>]*)>/g)) {
          const rendererId = tag[1].match(/\bxml:id="([^"]+)"/)?.[1];
          if (!rendererId) continue;
          const value =
            values.get(rendererId) ??
            toolkit.getMIDIValuesForElement(rendererId);
          if ([value.time, value.pitch, value.duration].every(Number.isFinite))
            notes.push({
              renderer_id: rendererId,
              page_index: page - 1,
              onset_millis: value.time,
              pitch: value.pitch,
              duration_millis: value.duration,
            });
        }
        await pause();
      }
      self.postMessage({ id, notes, midi });
    } else throw new Error("未知谱页请求");
  } catch (error) {
    self.postMessage({ id, error: String(error.message || error) });
  }
};
