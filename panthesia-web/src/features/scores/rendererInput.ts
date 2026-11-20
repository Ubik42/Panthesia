import { api } from "../../api";
/** Written accidentals and sounding alteration are separate MusicXML fields.
 * Verovio 6.1's import can omit the latter. Pass gestures separately without
 * adding or removing any written sign, and keep the original document intact.
 */
export async function rendererInput(asset: {
  bytes: number[];
  compressed: boolean;
}) {
  const bytes = asset.compressed
    ? await api.notationDocument(asset.bytes)
    : asset.bytes;
  const doc = new DOMParser().parseFromString(
    new TextDecoder().decode(new Uint8Array(bytes)),
    "application/xml",
  );
  if (doc.getElementsByTagName("parsererror").length)
    throw new Error("谱面 XML 无法读取");
  const child = (e: Element, name: string) =>
    Array.from(e.children).find((n) => n.localName === name);
  const notes = Array.from(doc.getElementsByTagNameNS("*", "note"));
  const ids = new Set(
    Array.from(doc.getElementsByTagName("*"))
      .map(
        (e) =>
          e.getAttribute("id") ??
          e.getAttributeNS("http://www.w3.org/XML/1998/namespace", "id"),
      )
      .filter((id): id is string => id !== null),
  );
  const entries = new Map<string, string | null>();
  const names: Record<string, string> = {
    "-2": "ff",
    "-1": "f",
    "0": "n",
    "1": "s",
    "2": "ss",
  };
  for (let index = 0; index < notes.length; index++) {
    const note = notes[index],
      pitch = child(note, "pitch");
    if (!pitch) continue;
    const alter = (child(pitch, "alter")?.textContent ?? "0").trim();
    if (!(alter in names)) continue;
    let id =
      note.getAttribute("id") ??
      note.getAttributeNS("http://www.w3.org/XML/1998/namespace", "id");
    if (!id) {
      id = `panthesia-render-n${index}`;
      while (ids.has(id)) id += "x";
      ids.add(id);
      note.setAttribute("id", id);
    }
    entries.set(id, entries.has(id) ? null : names[alter]);
  }
  const alterations = [...entries].filter(
    (e): e is [string, string] => e[1] !== null,
  );
  return {
    bytes: Array.from(
      new TextEncoder().encode(new XMLSerializer().serializeToString(doc)),
    ),
    compressed: false,
    alterations,
  };
}
