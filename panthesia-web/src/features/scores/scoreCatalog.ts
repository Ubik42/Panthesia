import { api } from "../../api";
import type { ScoreWorkspaceSlot, ScoreCatalog } from "./scoreWorkspaceStore";

const reads = new WeakMap<ScoreWorkspaceSlot, Promise<void>>();
/** A source owns its listing and in-flight read, including while its dialog is closed. */
export async function readScoreCatalog(
  slot: ScoreWorkspaceSlot,
  fresh = false,
): Promise<void> {
  const previous = reads.get(slot);
  if (previous) {
    if (!fresh) return previous;
    try {
      await previous;
    } catch {
      /* A completed mutation still requires its own read. */
    }
    return readScoreCatalog(slot);
  }
  const source = slot.getSnapshot().source;
  slot.update({ catalogReading: true, catalogError: "" });
  const task = (async () => {
    try {
      const data = await api.commandForEngine<{
        contentId?: string;
        versions: ScoreCatalog["versions"];
      }>(source.engineId, { type: "scoreVersions" });
      if (data.contentId && data.contentId !== source.contentId)
        throw new Error("版本列表属于另一首曲目，请返回原曲目后继续读取。");
      let originals: ScoreCatalog["originals"] = [],
        originalIssue: string | undefined;
      if (api.desktop) {
        try {
          const original = await api.commandForEngine<{
            entries: ScoreCatalog["originals"];
          }>(source.engineId, {
            type: "scoreSources",
            content_id: source.contentId,
          });
          originals = original.entries;
        } catch (error) {
          originalIssue =
            error instanceof Error ? error.message : String(error);
        }
      }
      slot.update({
        catalog: {
          versions: data.versions,
          originals,
          originalIssue,
        },
      });
    } catch (error) {
      slot.update({
        catalogError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      slot.update({ catalogReading: false });
    }
  })();
  reads.set(slot, task);
  try {
    await task;
  } finally {
    if (reads.get(slot) === task) reads.delete(slot);
  }
}
