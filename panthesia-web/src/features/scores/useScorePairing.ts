import { useRef, type ChangeEvent } from "react";
import type { EngineCommand, LoadedSong } from "../../api";
import type { PlaybackStore } from "../practice/playbackStore";
/** File selection carries its original song identity across asynchronous reading. */
export function useScorePairing({
  song,
  playback,
  run,
  setView,
  setError,
}: {
  song: LoadedSong | null;
  playback: PlaybackStore;
  run: (command: EngineCommand, changesSong?: boolean) => Promise<boolean>;
  setView: (view: string) => void;
  setError: (error: string) => void;
}) {
  const scoreInput = useRef<HTMLInputElement>(null);
  const scorePairTarget = useRef<{
    contentId: string;
    title: string;
    engineId?: string | null;
  } | null>(null);
  const change = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0],
      target = scorePairTarget.current;
    scorePairTarget.current = null;
    e.target.value = "";
    if (!file || !target) return;
    if (file.size > 64 * 1024 * 1024) {
      setError("乐谱超过 64 MiB");
      return;
    }
    try {
      if (
        playback.getSnapshot().contentId !== target.contentId ||
        playback.getEngineId() !== target.engineId
      )
        throw new Error(`当前曲目已切换，请重新为“${target.title}”选择乐谱。`);
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      if (
        playback.getSnapshot().contentId !== target.contentId ||
        playback.getEngineId() !== target.engineId
      )
        throw new Error("读取乐谱期间曲目已切换，请重新选择要配对的曲目。");
      const paired = await run(
        {
          type: "pairScore",
          bytes,
          name: file.name,
          content_id: target.contentId,
        },
        true,
      );
      if (paired && playback.getSnapshot().contentId === target.contentId)
        setView("combined");
    } catch (err) {
      setError(String(err));
    }
  };
  return {
    input: scoreInput,
    change,
    request: () => {
      if (song) {
        scorePairTarget.current = {
          contentId: song.contentId,
          title: song.title,
          engineId: song.engineId,
        };
        scoreInput.current?.click();
      }
    },
  };
}
