/** Real parsing/alignment workload; production code has no test delay. */
export function largeScore(title: string) {
  const measures = Array.from({ length: 5500 }, (_, measure) => {
    const notes = Array.from({ length: 4 }, (_, index) => {
      const pitch = (measure * 4 + index) % 28;
      return `<note><pitch><step>${"CDEFGAB"[pitch % 7]}</step><octave>${3 + Math.floor(pitch / 7)}</octave></pitch><duration>1</duration><type>quarter</type></note>`;
    }).join("");
    return `<measure number="${measure + 1}">${measure === 0 ? "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>" : ""}${notes}</measure>`;
  }).join("");
  return Buffer.from(`<score-partwise version="4.0"><work><work-title>${title}</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`);
}
