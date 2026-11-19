import { api } from "../../api";
import type { EngineCommand } from "../../engine/commands.generated";
import type {
  ScoreSource,
  ScoreSourcePreview,
  AppliedSource,
  SourceApplyMode,
} from "./sourceTypes";

/** One source-management visit keeps the engine that supplied its previews. */
export function createScoreSourceClient(expectedEngine?: string) {
  let engineId = expectedEngine;
  let binding: Promise<string | undefined> | undefined;
  const bind = (): Promise<string | undefined> => {
    if (engineId) return Promise.resolve(engineId);
    return (binding ??= api
      .state()
      .then((state) => {
        engineId = state.stateOrder?.engineId;
        return engineId;
      })
      .catch((failure) => {
        binding = undefined;
        throw failure;
      }));
  };
  const command = async <T = { ok: boolean }>(
    request: EngineCommand,
  ): Promise<T> => api.commandForEngine<T>(await bind(), request);
  return {
    command,
    read: (contentId?: string) =>
      command<{ entries: ScoreSource[] }>({
        type: "scoreSources",
        content_id: contentId ?? null,
      }),
    preview: (id: string, fingerprint: string) =>
      command<ScoreSourcePreview>({
        type: "previewScoreSource",
        id,
        fingerprint,
      }),
    apply: (id: string, fingerprint: string, mode: SourceApplyMode) =>
      command<AppliedSource>({
        type: "applyScoreSource",
        id,
        fingerprint,
        mode,
      }),
    keep: (id: string, fingerprint: string) =>
      command<{ kept: boolean }>({
        type: "acknowledgeScoreSource",
        id,
        fingerprint,
      }),
    link: async (midiPath: string, contentId: string, versionId: string) =>
      api.linkScoreSource(midiPath, contentId, versionId, await bind()),
  };
}
export type ScoreSourceClient = ReturnType<typeof createScoreSourceClient>;
