import { api, type LoadedSong } from "../../api";
import type { PackagePolicy } from "../../engine/commands.generated";
import type { MusicPreparationOptions } from "./musicImportClient";
import { prepareSongOperation } from "./preparedSongClient";

export function importPreparedPackage(
  token: string,
  policy: PackagePolicy,
  options: MusicPreparationOptions & { previewEngineId?: string } = {},
) {
  if (!/^[a-f0-9]{64}$/i.test(token))
    throw new Error("曲目包预览已失效，请重新选择文件。");
  return prepareSongOperation(
    {
      kind: "package",
      name: "曲目包",
      expectedEngineId: options.previewEngineId,
      supported: (state) => !!state.packageImportVersion,
      submit: (engineId, requestId, createdAtMs) =>
        api.preparePackage({ engineId, requestId, createdAtMs, token, policy }),
      legacy: (engineId) =>
        api.commandForEngine<LoadedSong>(engineId, {
          type: "importStagedPackage",
          token,
          policy,
        }),
    },
    options,
  );
}
