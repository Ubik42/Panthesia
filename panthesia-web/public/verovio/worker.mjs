import createModule from "./module.mjs";
import { VerovioToolkit } from "./toolkit.mjs";
import { createMidiValueIndex } from "./midi-value-index.mjs";
let toolkit,
  count = 0,
  lines = [],
  pageSvgs = [];
/** Line view: the systems of the auto layout at the pane's width, each as its first and last
 * measure and the notes it holds. A line is shown as its system cut out of the rendered page
 * (`systemSvg`): systems are justified to the full width and each starts with its clef and key,
 * so every line fills the pane's width. */
function computeLines() {
  const out = [];
  pageSvgs = [];
  for (let page = 1; page <= count; page++) {
    const svg = toolkit.renderToSVG(page);
    pageSvgs.push(svg);
    let system = 0;
    for (const tag of svg.matchAll(/<g\b([^>]*)>/g)) {
      const attrs = tag[1];
      const kind = attrs.match(/\bclass="([^"]*)"/)?.[1] ?? "";
      const id = attrs.match(/\bdata-id="([^"]*)"/)?.[1] ?? attrs.match(/\bid="([^"]*)"/)?.[1];
      if (/(^|\s)system(\s|$)/.test(kind)) out.push({ page: page - 1, system: system++, first: "", last: "", notes: [] });
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
/** The `index`-th system of a rendered page as its own SVG, cropped to what it draws. The crop
 * is computed from the coordinates in its markup (glyph positions, paths, text), with room above
 * and below for stems and slurs; the viewBox keeps the page's outer units. */
function systemSvg(page, index) {
  const outer = page.match(/^<svg\b[^>]*>/)?.[0] ?? "<svg>";
  const outerBox = outer.match(/viewBox="([^"]+)"/)?.[1].split(/\s+/).map(Number);
  const innerBox = page.match(/class="definition-scale"[^>]*viewBox="([^"]+)"/)?.[1].split(/\s+/).map(Number);
  const k = outerBox && innerBox && innerBox[2] ? outerBox[2] / innerBox[2] : 1;
  const starts = [...page.matchAll(/<g\b[^>]*class="system"[^>]*>/g)];
  const start = starts[index]?.index;
  if (start === undefined) throw new Error("谱面行位置无效");
  // The system's own markup: from its opening tag to the matching close.
  const tag = /<(\/?)g\b[^>]*?(\/?)>/g;
  tag.lastIndex = start;
  let depth = 0,
    end = page.length,
    m;
  while ((m = tag.exec(page))) {
    if (m[1]) depth--;
    else if (!m[2]) depth++;
    if (depth === 0) {
      end = m.index + m[0].length;
      break;
    }
  }
  // Part names (label, labelAbbr) stand left of the staff: a stage line has none.
  const system = page.slice(start, end).replace(/<g\b[^>]*class="label(?:Abbr)?"[^>]*>[\s\S]*?<\/g>/g, "");
  const xs = [],
    ys = [];
  for (const t of system.matchAll(/translate\((-?[\d.]+)[ ,]+(-?[\d.]+)\)/g)) xs.push(+t[1]), ys.push(+t[2]);
  for (const d of system.matchAll(/\sd="([^"]+)"/g)) {
    const n = d[1].match(/-?[\d.]+/g)?.map(Number) ?? [];
    for (let i = 0; i + 1 < n.length; i += 2) xs.push(n[i]), ys.push(n[i + 1]);
  }
  for (const t of system.matchAll(/<text\b[^>]*\bx="(-?[\d.]+)"[^>]*\by="(-?[\d.]+)"/g)) xs.push(+t[1]), ys.push(+t[2]);
  if (!xs.length) throw new Error("谱面行为空");
  const left = Math.min(...xs),
    right = Math.max(...xs),
    top = Math.min(...ys),
    bottom = Math.max(...ys);
  const pad = Math.max(300, (bottom - top) * 0.12);
  const box = [left - 120, top - pad, right - left + 240, bottom - top + 2 * pad].map((v) => +(v * k).toFixed(1));
  const defs = page.match(/<defs>[\s\S]*?<\/defs>/)?.[0] ?? "";
  // Every style block: one holds the music font (@font-face) for tempo marks and text glyphs.
  const style = (page.match(/<style\b[\s\S]*?<\/style>/g) ?? []).join("");
  const id = outer.match(/\bid="([^"]+)"/)?.[1] ?? "";
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" id="${id}" class="definition-scale" color="black" font-family="Times, serif" overflow="visible" viewBox="${box.join(" ")}">${defs}${style}<g class="page-margin" transform="scale(${k})">${system}</g></svg>`;
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
      if (!toolkit) throw new Error("谱面尚未排版");
      toolkit.setOptions(layoutOptions(data.pageWidth));
      toolkit.redoLayout();
      count = toolkit.getPageCount();
      lines = computeLines();
      self.postMessage({ id, count, lines });
    } else if (type === "line") {
      const line = lines[data.line];
      if (!line || !pageSvgs[line.page]) throw new Error("谱面行位置无效");
      self.postMessage({ id, line: data.line, svg: systemSvg(pageSvgs[line.page], line.system) });
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
