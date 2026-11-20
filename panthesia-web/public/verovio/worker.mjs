import createModule from "./module.mjs";
import { VerovioToolkit } from "./toolkit.mjs";
import { createMidiValueIndex } from "./midi-value-index.mjs";
let toolkit,
  count = 0;
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    const progress = (stage, page, total) =>
      self.postMessage({ id, progress: true, stage, page, total });
    if (type === "open") {
      progress("initializing");
      toolkit = new VerovioToolkit(await createModule());
      toolkit.setOptions({
        breaks: "auto",
        pageWidth: 2100,
        pageHeight: 2970,
        scale: 40,
        svgHtml5: true,
        svgViewBox: true,
        xmlIdChecksum: true,
        expandNever: true,
      });
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
      self.postMessage({ id, count });
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
