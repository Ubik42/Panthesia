// Pure presentation helpers. Importing these must not initialize a transport.
export const pitchName = (pitch: number) =>
  `${["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][pitch % 12]}${Math.floor(pitch / 12) - 1}`;

export const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** MIDI has sounding pitches. Use the current key to choose their written letter names. */
export function keyPitchName(
  pitch: number,
  tonic = 0,
  minor = false,
  fifths?: number,
) {
  const pc = ((pitch % 12) + 12) % 12;
  if (fifths === undefined)
    fifths =
      Array.from({ length: 15 }, (_, i) => i - 7)
        .filter((f) => (((f * 7 + (minor ? 9 : 0)) % 12) + 12) % 12 === tonic)
        .sort((a, b) => Math.abs(a) - Math.abs(b))[0] ?? 0;
  const natural = [0, 2, 4, 5, 7, 9, 11],
    letters = ["C", "D", "E", "F", "G", "A", "B"],
    alterations = [0, 0, 0, 0, 0, 0, 0];
  const order = fifths < 0 ? [6, 2, 5, 1, 4, 0, 3] : [3, 0, 4, 1, 5, 2, 6];
  for (let i = 0; i < Math.min(7, Math.abs(fifths)); i++)
    alterations[order[i]] = fifths < 0 ? -1 : 1;
  let letter = natural.findIndex(
    (n, i) => (n + alterations[i] + 12) % 12 === pc,
  );
  let alteration = letter >= 0 ? alterations[letter] : 0;
  if (letter < 0 && minor && (pc - tonic + 12) % 12 === 11) {
    const root = natural.findIndex(
      (n, i) => (n + alterations[i] + 12) % 12 === tonic,
    );
    if (root >= 0) {
      letter = (root + 6) % 7;
      alteration = alterations[letter] + 1;
    }
  }
  if (letter < 0) {
    const choices = natural
      .map((n, i) => {
        let a = (pc - n + 12) % 12;
        if (a > 6) a -= 12;
        return {
          letter: i,
          alteration: a,
          cost:
            Math.abs(a) * 2 +
            Math.abs(a - alterations[i]) +
            ((fifths! < 0 && a > 0) || (fifths! >= 0 && a < 0) ? 0.25 : 0),
        };
      })
      .filter((c) => Math.abs(c.alteration) <= 2)
      .sort((a, b) => a.cost - b.cost);
    ({ letter, alteration } = choices[0]);
  }
  const octave = Math.floor((pitch - natural[letter] - alteration) / 12) - 1;
  return `${letters[letter]}${alteration === 2 ? "𝄪" : alteration === -2 ? "𝄫" : alteration === 1 ? "♯" : alteration === -1 ? "♭" : ""}${octave}`;
}
