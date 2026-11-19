// Verovio 6.1.0's element API searches the document twice per note. Index the
// renderer's own MEI and first-occurrence timemap without changing source IDs.
// Ties, repeated IDs and unfamiliar pitch encodings retain the element API.
const pitchClasses = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const alterations = { n: 0, s: 1, f: -1, ss: 2, x: 2, ff: -2 };
function attributes(source) {
  return Object.fromEntries([...source.matchAll(/([\w.:-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}
function pitch(head, body) {
  const note = attributes(head);
  if (note.pnum !== undefined) {
    const number = Number(note.pnum);
    return Number.isInteger(number) && number >= 0 && number <= 127 ? number : null;
  }
  const step = pitchClasses[note["pname.ges"] ?? note.pname];
  const octave = Number(note["oct.ges"] ?? note.oct);
  if (step === undefined || !Number.isInteger(octave)) return null;
  const accids = [...body.matchAll(/<accid\b([^>]*)\/?\s*>/g)];
  if (accids.length > 1 || /<(?:choice|app|sameas)\b/.test(body)) return null;
  let alteration = 0;
  if (accids.length) {
    const accid = attributes(accids[0][1]);
    const value = accid["accid.ges"] ?? accid.accid;
    if (value !== undefined) {
      if (!(value in alterations)) return null;
      alteration = alterations[value];
    }
  }
  const value = step + (octave + 1) * 12 + alteration;
  return value >= 0 && value <= 127 ? value : null;
}
export function createMidiValueIndex(toolkit) {
  const result = new Map();
  if (!String(toolkit.getVersion()).startsWith("6.1.0")) return result;
  const mei = toolkit.getMEI();
  const excluded = new Set();
  for (const tag of mei.matchAll(/<(?:tie|trill|mordent|turn|arpeg|gliss)\b([^>]*)>/g)) {
    const attrs = attributes(tag[1]);
    for (const name of ["startid", "endid"]) if (attrs[name]) excluded.add(attrs[name].replace(/^#/, ""));
    for (const id of (attrs.plist ?? "").split(/\s+/)) if (id) excluded.add(id.replace(/^#/, ""));
  }
  const events = toolkit.renderToTimemap({ includeMeasures: true });
  // The timemap rounds milliseconds while element queries truncate local note
  // and measure clocks separately. Cache only clocks exactly representable in
  // binary and integer milliseconds; other timing retains the native query.
  let quarter = 0, seconds = 0, tempo = 120;
  const measures = new Map(), exact = new Map();
  for (const event of events) {
    if (!Number.isFinite(event.qstamp) || !Number.isInteger(event.qstamp * 1024) || event.qstamp < quarter) return result;
    seconds += (event.qstamp - quarter) * 60 / tempo;
    const millis = seconds * 1000;
    exact.set(event, Number.isInteger(millis) && millis === event.tstamp);
    if (event.measureOn && !measures.has(event.measureOn)) measures.set(event.measureOn, exact.get(event));
    if (event.tempo !== undefined) {
      tempo = event.tempo;
      if (!(tempo > 0) || !Number.isInteger(Math.log2(60 / tempo))) return result;
    }
    quarter = event.qstamp;
  }
  for (const measure of mei.matchAll(/<measure\b([^>]*?)>([\s\S]*?)<\/measure>/g)) {
    if (measures.get(attributes(measure[1])["xml:id"]) === true) continue;
    for (const note of measure[2].matchAll(/<note\b([^>]*)>/g)) excluded.add(attributes(note[1])["xml:id"]);
  }
  const on = new Map(), off = new Map();
  for (const event of events) {
    if (!exact.get(event)) for (const id of [...(event.on ?? []), ...(event.off ?? [])]) excluded.add(id);
    for (const id of event.on ?? []) { if (on.has(id)) excluded.add(id); else on.set(id, event.tstamp); }
    for (const id of event.off ?? []) { if (off.has(id)) excluded.add(id); else off.set(id, event.tstamp); }
  }
  const seen = new Set();
  for (const match of mei.matchAll(/<note\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/note>)/g)) {
    const attrs = attributes(match[1]), id = attrs["xml:id"];
    if (!id) continue;
    if (seen.has(id)) { result.delete(id); excluded.add(id); }
    seen.add(id);
    if (excluded.has(id) || attrs.tie || attrs.sameas || attrs.grace) continue;
    const time = on.get(id), end = off.get(id), number = pitch(match[1], match[2] ?? "");
    if (number === null || !Number.isInteger(time) || !Number.isInteger(end) || end < time) continue;
    result.set(id, { time, pitch: number, duration: end - time });
  }
  return result;
}
