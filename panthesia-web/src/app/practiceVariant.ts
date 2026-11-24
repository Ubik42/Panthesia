import type { EngineCommand, LoadedSong } from "../api";
import type { Variant } from "../engine/commands.generated";
import { setDisplay } from "../features/settings/interfaceSettingsStore";

/** Apply the song's practice version (transposition, quantization); the practice grid and the
 * label tonic follow it. */
export async function applyPracticeVariant(run: (command: EngineCommand, changesSong?: boolean) => Promise<boolean>, song: LoadedSong | null, value: Variant) {
  if (!song) return false;
  const ok = await run({ type: "practiceVariant", content_id: song.contentId, score_revision: song.scoreRevision, value }, true);
  if (ok)
    setDisplay((previous) => ({
      ...previous,
      ...(value.quantize ? { gridSubdivision: value.quantize as 8 | 16 | 32 } : {}),
      tonic: ((value.tonic ?? song.practiceVariant?.tonic ?? 0) + (value.transpose ?? 0) + 120) % 12,
    }));
  return ok;
}
