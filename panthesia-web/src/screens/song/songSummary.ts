import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";

/** The engine's song summary (`panthesia-engine/src/song_summary.rs`, `song_generate.rs`). */
export type ItemState = "current" | "present" | "missing" | "found" | "registered";
export type MaterialItem = {
  id: string | null;
  path: string | null;
  relative: string;
  label: string | null;
  state: ItemState;
  origin: "human" | "imported" | "generated" | null;
  paired?: boolean;
  stem?: string | null;
  role?: string;
  reason?: string;
};
export type Generator = { id: string; label: string; external: boolean; available: boolean; reason?: string | null };
export type MaterialKind = "performance" | "musicxml" | "abc" | "paper" | "source" | "vocals" | "accompaniment" | "stems";
export type Material = { kind: MaterialKind; label: string; items: MaterialItem[]; generators: Generator[] };
export type Layer = { name: string; label: string; origin: "human" | "imported" | "generated" | null; count: number };
export type SongFacts = {
  title: string | null;
  artist: string | null;
  durationSeconds: number;
  bpm: number | null;
  bpmSource: string;
  timeSignature: string | null;
  key: string | null;
  keySource: string;
  measures: number;
  tracks: number;
  notes: number;
  pitchRange: [number, number] | null;
};
export type SongSummary = {
  path: string;
  kind: "midi" | "musicxml" | "abc" | "manifest";
  performancePath: string;
  facts: SongFacts;
  materials: Material[];
  layers: Layer[];
  manifest: { path: string; readOnly: boolean } | null;
  warnings: string[];
  tool: { available: boolean; path: string | null; message?: string };
};

const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const noteName = (midi: number) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
/** "3:42" */
export function formatDuration(seconds: number | null | undefined) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
/** Harte key ("Eb:min") as a reader sees it ("Eb 小调"). */
export function keyLabel(key: string | null | undefined) {
  if (!key) return null;
  const [tonic, mode] = key.split(":");
  return `${tonic} ${mode === "min" ? "小调" : "大调"}`;
}
export const SOURCE_NAMES: Record<string, string> = { manifest: "清单", midi: "文件", filename: "文件名", estimated: "估计" };
export const ORIGIN_NAMES: Record<string, string> = { human: "人工", imported: "导入", generated: "生成" };

/** The summary of `path` (or of the current song), reloaded when `key` changes. */
export function useSongSummary(key: string, path?: string) {
  const [summary, setSummary] = useState<SongSummary | null>(null);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++sequence.current;
    try {
      const value = await api.command<SongSummary>({ type: "songSummary", path: path ?? null });
      if (mine === sequence.current) {
        setSummary(value);
        setError("");
      }
    } catch (failure) {
      if (mine === sequence.current) setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload, key]);
  return { summary, error, reload, setSummary };
}
