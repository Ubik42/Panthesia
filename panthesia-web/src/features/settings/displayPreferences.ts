import { normalizeKeyboardViewport, normalizePreviewBars, type KeyboardViewport, normalizeDeviceRanges, type KeyboardRangeMode, type KeyboardRange } from "../practice/keyboardViewport";
import {
  normalizeShortcuts,
  shortcutDefaults,
  type Shortcuts,
} from "../../lib/shortcuts";
import { pitchName, keyPitchName } from "../../engine/musicFormatting";
export type LabelMode = "none" | "octaves" | "finger" | "mapping" | "english" | "degree" | "fixed" | "movable" | "simple" | "legacy";
export const labelModes: LabelMode[] = ["none", "octaves", "finger", "mapping", "english", "degree", "fixed", "movable", "simple", "legacy"];
export type DisplayPreferences = {
  keyLabelMode: LabelMode;
  noteLabelMode: LabelMode;
  keyLabelsOwnOnly: boolean;
  noteLabelsOwnOnly: boolean;
  practiceLayoutVersion: number;
  practiceFocus: boolean;
  practiceView: "keyboard" | "paper" | "combined";
  practiceSplitAxis: "auto" | "rows" | "columns";
  practiceSplitRatio: number;
  /** Score background on the stage: none (ink in the interface text colour) or a white page. */
  scorePaper: "transparent" | "paper";
  /** Card size of the start page grid (the number of columns follows the window). */
  homeGrid: "compact" | "normal" | "roomy";
  /** Interface theme. */
  theme: "light" | "dark";
  /** Background colour of the waterfall (hex). */
  stageColor: string;
  pianoMaterial: "ivory" | "porcelain" | "glass";
  effectStyle: "bloom" | "ripple" | "comet";
  barOpacity: number;
  beatOpacity: number;
  subdivisionOpacity: number;
  gridSubdivision: 4 | 8 | 16 | 32;
  virtualHands: boolean;
  virtualHandOpacity: number;
  effectsEnabled: boolean;
  effectsPreset: "practice" | "performance";
  effectsPalette: "aurora" | "ember" | "violet";
  effectsIntensity: number;
  reduceMotion: boolean;
  shortcuts: Shortcuts;
  uiScale: number;
  notation: "pitch" | "solfege" | "degree";
  noteLabels: "auto" | "name" | "finger" | "both" | "none";
  keyLabels: "c" | "white" | "all" | "none";
  tonic: number;
  octave: boolean;
  fontSize: number;
  /** Note colours: by track and hand, a blue / orange pair for colour-blind players, or one colour per pitch class. */
  palette: "standard" | "accessible" | "pitch";
  /** How much of the waterfall backdrop covers the background image (0 shows only the image). */
  backgroundOpacity: number;
  /** A light strip along the top edge of the keys, lit in the colours of the sounding notes. */
  ledStrip: boolean;
  range: KeyboardRangeMode;
  keyboardViewport: KeyboardViewport | null;
  keyboardLow: number;
  keyboardHigh: number;
  keyboardDeviceRanges: Record<string, KeyboardRange>;
  previewBars: number;
  loopPreview:boolean;
  /** Chord layer on the stage: off, degrees, chord names or both. */
  chordLabels: "off" | "degree" | "name" | "both";
  /** The current lyric line above the keys, when the song has lyrics. */
  lyrics: boolean;
  /** Section names (前奏 / 主歌 / 副歌 …) at their starting lines. */
  sections: boolean;
  /** Time signatures on the waterfall's bar lines, where the meter starts or changes. */
  meterLabels: boolean;
  /** Free-play takes: tempo they are written at, and whether a metronome clicks its beats. */
  recordBpm: number;
  recordClick: boolean;
  inspector: boolean;
  keyboardEnabled: boolean;
  keyboardOctave: number;
  keyCodes: string[];
  inspectorWidth: number;
  keyboardHeight: number;
  paperPreviewHeight: number;
};
export const asdfCodes = [
  "KeyA",
  "KeyW",
  "KeyS",
  "KeyE",
  "KeyD",
  "KeyF",
  "KeyT",
  "KeyG",
  "KeyY",
  "KeyH",
  "KeyU",
  "KeyJ",
  "KeyK",
];
export const zxcvCodes = [
  "KeyZ",
  "KeyS",
  "KeyX",
  "KeyD",
  "KeyC",
  "KeyV",
  "KeyG",
  "KeyB",
  "KeyH",
  "KeyN",
  "KeyJ",
  "KeyM",
  "Comma",
];
export const displayDefaults: DisplayPreferences = {
  keyLabelMode: "octaves", noteLabelMode: "finger", keyLabelsOwnOnly: false, noteLabelsOwnOnly: false,
  practiceLayoutVersion: 3,
  practiceFocus: false,
  practiceView: "combined", practiceSplitAxis: "auto", practiceSplitRatio: 55, scorePaper: "transparent", homeGrid: "normal", theme: "light", stageColor: "#ffffff",
  pianoMaterial: "ivory", effectStyle: "bloom",
  barOpacity: 45, beatOpacity: 18, subdivisionOpacity: 12, gridSubdivision: 8,
  virtualHands: false, virtualHandOpacity: 100,
  effectsEnabled: true,
  effectsPreset: "practice",
  effectsPalette: "aurora",
  effectsIntensity: 70,
  reduceMotion: false,
  shortcuts: { ...shortcutDefaults },
  uiScale: 100,
  inspectorWidth: 218,
  keyboardHeight: 100,
  paperPreviewHeight: 150,
  notation: "pitch",
  noteLabels: "auto",
  keyLabels: "c",
  tonic: 0,
  octave: true,
  fontSize: 10,
  palette: "standard",
  backgroundOpacity: 100,
  ledStrip: true,
  range: "song",
  keyboardViewport: null, keyboardLow: 36, keyboardHigh: 84, keyboardDeviceRanges: {},
  previewBars: 4,
  loopPreview:true,
  chordLabels: "off",
  lyrics: true,
  sections: true,
  meterLabels: false,
  recordBpm: 100,
  recordClick: false,
  inspector: false,
  keyboardEnabled: true,
  keyboardOctave: 4,
  keyCodes: asdfCodes,
};
export const displayStorage = "neothesia-display-v1";
export const allowedCode = (code: string) =>
  /^(Key[A-Z]|Digit[0-9]|Comma|Period|Semicolon)$/.test(code);
export const codeLabel = (code: string) =>
  ({ Comma: ",", Period: ".", Semicolon: ";" })[code] ??
  code.replace(/^(Key|Digit)/, "");
export function readDisplayPreferences(): DisplayPreferences {
  let raw: Partial<DisplayPreferences> = {};
  try {
    raw = JSON.parse(localStorage.getItem(displayStorage) ?? "{}") ?? {};
  } catch {}
  return normalizeDisplayPreferences(raw);
}
export function normalizeDisplayPreferences(
  raw: Partial<DisplayPreferences>,
): DisplayPreferences {
  const size = (value: unknown, low: number, high: number, fallback: number) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(low, Math.min(high, Math.round(value)))
      : fallback;
  const keys =
    Array.isArray(raw.keyCodes) &&
    raw.keyCodes.length === 13 &&
    raw.keyCodes.every(
      (code) => typeof code === "string" && allowedCode(code),
    ) &&
    new Set(raw.keyCodes).size === 13
      ? raw.keyCodes
      : [...asdfCodes];
  return {
    ...displayDefaults,
    keyLabelMode: labelModes.includes(raw.keyLabelMode!) ? raw.keyLabelMode! : raw.keyLabels===undefined?displayDefaults.keyLabelMode:"legacy",
    noteLabelMode: labelModes.includes(raw.noteLabelMode!) ? raw.noteLabelMode! : raw.noteLabels===undefined?displayDefaults.noteLabelMode:"legacy",
    keyLabelsOwnOnly: raw.keyLabelsOwnOnly === true,
    noteLabelsOwnOnly: raw.noteLabelsOwnOnly === true,
    pianoMaterial: raw.pianoMaterial === "porcelain" || raw.pianoMaterial === "glass" ? raw.pianoMaterial : "ivory",
    effectStyle: raw.effectStyle === "ripple" || raw.effectStyle === "comet" ? raw.effectStyle : "bloom",
    barOpacity: size(raw.barOpacity, 0, 100, 45),
    beatOpacity: size(raw.beatOpacity, 0, 100, 18),
    subdivisionOpacity: size(raw.subdivisionOpacity, 0, 100, 12),
    gridSubdivision: raw.gridSubdivision === 4 || raw.gridSubdivision === 16 || raw.gridSubdivision === 32 ? raw.gridSubdivision : 8,
    virtualHands: raw.virtualHands === true,
    virtualHandOpacity: size(raw.virtualHandOpacity,20,100,100),
    effectsEnabled: typeof raw.effectsEnabled === "boolean" ? raw.effectsEnabled : true,
    effectsPreset: raw.effectsPreset === "performance" ? "performance" : "practice",
    effectsPalette: raw.effectsPalette === "ember" || raw.effectsPalette === "violet" ? raw.effectsPalette : "aurora",
    effectsIntensity: size(raw.effectsIntensity, 0, 100, 70),
    loopPreview: typeof raw.loopPreview === "boolean" ? raw.loopPreview : true,
    chordLabels: raw.chordLabels === "degree" || raw.chordLabels === "name" || raw.chordLabels === "both" ? raw.chordLabels : "off",
    lyrics: typeof raw.lyrics === "boolean" ? raw.lyrics : true,
    sections: typeof raw.sections === "boolean" ? raw.sections : true,
    meterLabels: raw.meterLabels === true,
    recordBpm: size(raw.recordBpm, 30, 300, 100),
    recordClick: raw.recordClick === true,
    reduceMotion: typeof raw.reduceMotion === "boolean" ? raw.reduceMotion : false,
    practiceFocus: raw.practiceFocus === true,
    // The score-only view became the combined view (the score over the waterfall).
    practiceView: raw.practiceView === "keyboard" || raw.practiceView === "paper" ? raw.practiceView : "combined",
    practiceSplitAxis: raw.practiceSplitAxis === "rows" || raw.practiceSplitAxis === "columns" ? raw.practiceSplitAxis : "auto",
    practiceSplitRatio: size(raw.practiceSplitRatio, 25, 75, 55),
    scorePaper: raw.scorePaper === "paper" ? "paper" : "transparent",
    homeGrid: raw.homeGrid === "compact" || raw.homeGrid === "roomy" ? raw.homeGrid : "normal",
    theme: raw.theme === "dark" ? "dark" : "light",
    stageColor: typeof raw.stageColor === "string" && /^#[0-9a-f]{6}$/i.test(raw.stageColor) ? raw.stageColor : "#ffffff",
    keyCodes: keys,
    uiScale: size(raw.uiScale, 80, 150, 100),
    shortcuts: normalizeShortcuts(raw.shortcuts, keys),
    inspectorWidth: size(raw.inspectorWidth, 180, 360, 218),
    keyboardHeight: size(raw.keyboardHeight, 60, 220, 100),
    paperPreviewHeight: size(raw.paperPreviewHeight, 100, 360, 150),
    notation: ["pitch", "solfege", "degree"].includes(raw.notation ?? "")
      ? raw.notation!
      : "pitch",
    noteLabels: ["auto", "name", "finger", "both", "none"].includes(
      raw.noteLabels ?? "",
    )
      ? raw.noteLabels!
      : "auto",
    keyLabels: ["c", "white", "all", "none"].includes(raw.keyLabels ?? "")
      ? raw.keyLabels!
      : "c",
    palette: raw.palette === "accessible" || raw.palette === "pitch" ? raw.palette : "standard",
    backgroundOpacity: size(raw.backgroundOpacity, 0, 100, 100),
    ledStrip: typeof raw.ledStrip === "boolean" ? raw.ledStrip : true,
    tonic:
      Number.isInteger(raw.tonic) && raw.tonic! >= 0 && raw.tonic! < 12
        ? raw.tonic!
        : 0,
    octave: typeof raw.octave === "boolean" ? raw.octave : true,
    fontSize: [10, 12, 14, 16].includes(raw.fontSize ?? 0) ? raw.fontSize! : 10,
    range: raw.range === 49 || raw.range === 88 || raw.range === "device" || raw.range === "custom" ? raw.range : "song",
    keyboardViewport: normalizeKeyboardViewport(raw.keyboardViewport),
    keyboardLow: size(raw.keyboardLow, 0, 116, 36),
    keyboardHigh: Math.max(size(raw.keyboardLow, 0, 116, 36) + 11, size(raw.keyboardHigh, 11, 127, 84)),
    keyboardDeviceRanges: normalizeDeviceRanges(raw.keyboardDeviceRanges),
    previewBars: normalizePreviewBars(raw.previewBars ?? 4),
    practiceLayoutVersion: 3,
    inspector: raw.practiceLayoutVersion === 3 && typeof raw.inspector === "boolean" ? raw.inspector : false,
    keyboardEnabled:
      typeof raw.keyboardEnabled === "boolean" ? raw.keyboardEnabled : true,
    keyboardOctave:
      Number.isInteger(raw.keyboardOctave) &&
      raw.keyboardOctave! >= 2 &&
      raw.keyboardOctave! <= 6
        ? raw.keyboardOctave!
        : 4,
  };
}
export function displayPitch(pitch: number, prefs: DisplayPreferences) {
  const pc = ((pitch % 12) + 12) % 12,
    register = Math.floor(pitch / 12) - 1;
  const name =
    prefs.notation === "pitch"
      ? pitchName(pitch)
          .replace(/-?\d+$/, " ")
          .trim()
      : prefs.notation === "solfege"
        ? [
            "Do",
            "Do♯",
            "Re",
            "Re♯",
            "Mi",
            "Fa",
            "Fa♯",
            "Sol",
            "Sol♯",
            "La",
            "La♯",
            "Si",
          ][pc]
        : ["1", "♯1", "2", "♯2", "3", "4", "♯4", "5", "♯5", "6", "♯6", "7"][
            (pc - prefs.tonic + 12) % 12
          ];
  const suffix =
    prefs.notation === "degree"
      ? String(register).replace(
          /[0-9-]/g,
          (digit) =>
            ({
              "-": "₋",
              "0": "₀",
              "1": "₁",
              "2": "₂",
              "3": "₃",
              "4": "₄",
              "5": "₅",
              "6": "₆",
              "7": "₇",
              "8": "₈",
              "9": "₉",
            })[digit]!,
        )
      : String(register);
  return name + (prefs.octave ? suffix : "");
}
export function noteLabel(
  pitch: number,
  finger: number | null | undefined,
  prefs: DisplayPreferences,
) {
  const name = displayPitch(pitch, prefs);
  return prefs.noteLabels === "none"
    ? ""
    : prefs.noteLabels === "finger"
      ? finger
        ? String(finger)
        : ""
      : prefs.noteLabels === "both"
        ? finger
          ? `${finger} · ${name}`
          : name
        : prefs.noteLabels === "auto" && finger
          ? String(finger)
          : name;
}
export const handColor = (part: string, prefs: DisplayPreferences) =>
  prefs.palette === "accessible"
    ? part === "left"
      ? "#56b4e9"
      : part === "right"
        ? "#e69f00"
        : "#cccccc"
    : part === "left"
      ? "#6cb7f3"
      : "#a9df74";
export const keyboardMap = (prefs: DisplayPreferences) =>
  Object.fromEntries(
    prefs.keyCodes.map((code, index) => [
      code,
      12 * (prefs.keyboardOctave + 1) + index,
    ]),
  );

/** A label is presentation only. Ownership comes from source hand and playback assignment. */
export type LabelContext = { own?: boolean; tonic?: number; minor?: boolean; fifths?:number; finger?: number | null };
export function ownsPracticeNote(part: string, playbackMode: string | undefined, hands: string) {
  return playbackMode !== "Auto" && playbackMode !== "Mute" &&
    ((part === "left" && (hands === "both" || hands === "custom" || hands === "left")) ||
     (part === "right" && (hands === "both" || hands === "custom" || hands === "right")));
}
const solfegeNames = ["Do", "Do♯", "Re", "Re♯", "Mi", "Fa", "Fa♯", "Sol", "Sol♯", "La", "La♯", "Si"];
export function productLabel(pitch: number, target: "key" | "note", prefs: DisplayPreferences, context: LabelContext = {}) {
  if ((target === "key" ? prefs.keyLabelsOwnOnly : prefs.noteLabelsOwnOnly) && !context.own) return "";
  const mode = target === "key" ? prefs.keyLabelMode : prefs.noteLabelMode;
  const pc = ((pitch % 12) + 12) % 12, register = Math.floor(pitch / 12) - 1;
  const tonic = context.tonic ?? prefs.tonic, relative = (pc - tonic + 12) % 12;
  switch (mode) {
    case "none": return "";
    case "octaves": return pc === 0 ? `C${register}` : "";
    case "finger": return context.finger ? String(context.finger) : "";
    case "mapping": {
      if (!context.own || !prefs.keyboardEnabled) return "";
      const index = pitch - 12 * (prefs.keyboardOctave + 1);
      return index >= 0 && index < prefs.keyCodes.length ? codeLabel(prefs.keyCodes[index]) : "";
    }
    case "simple": return [0, 2, 4, 5, 7, 9, 11].includes(pc) ? displayPitch(pitch, {...prefs, notation: "pitch", octave: false}) : "";
    case "english": {const name=keyPitchName(pitch,tonic,context.minor,context.fifths);return prefs.octave?name:name.replace(/-?\d+$/,"");}
    case "fixed": return solfegeNames[pc] + (prefs.octave ? register : "");
    case "movable": return solfegeNames[relative] + (prefs.octave ? register : "");
    case "degree": {
      const scale = context.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
      const degree = scale.indexOf(relative);
      return degree < 0 ? "" : String(degree + 1);
    }
    default:
      return target === "note" ? noteLabel(pitch, context.finger, prefs) :
        prefs.keyLabels === "none" || (prefs.keyLabels === "c" && pc !== 0) || (prefs.keyLabels === "white" && [1,3,6,8,10].includes(pc)) ? "" : displayPitch(pitch, prefs);
  }
}
