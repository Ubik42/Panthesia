import { SongOptionsDialog } from "./SongOptionsDialog";
import { PracticeVariantPanel } from "../practice/PracticeVariantPanel";
import { SongEditionBar } from "../practice/SongEditionBar";
import { ScoresDialog } from "../../ScoresDialog";
import { MeterDialog } from "../../MeterDialog";
import { HandsDialog } from "../../HandsDialog";
import type { LoadedSong, EngineCommand } from "../../api";
import type { Variant } from "../../engine/commands.generated";
import type { createScoreWorkspaceStore } from "../scores/scoreWorkspaceStore";
import type { useSongEditors } from "./useSongEditors";
export function SongEditorHost({
  song,
  editors,
  disabled,
  scoreWorkspace,
  configureDuet,
  openScorePractice,
  paperChanged,
  changed,
  loopStart,
  loopEnd,
  applyVariant,
  execute,
  openPerformance,
}: {
  song: LoadedSong | null;
  editors: ReturnType<typeof useSongEditors>;
  disabled: boolean;
  scoreWorkspace: ReturnType<typeof createScoreWorkspaceStore>;
  configureDuet: () => void;
  openScorePractice: () => Promise<void>;
  paperChanged: () => void;
  changed: (kind: "scores" | "meter" | "hands") => Promise<void>;
  loopStart: number;
  loopEnd: number;
  applyVariant: (value: Variant) => Promise<boolean>;
  execute: (command: EngineCommand) => Promise<boolean>;
  openPerformance: (
    path: string,
    contentId: string,
    title: string,
  ) => Promise<boolean>;
}) {
  const {
    songOptions,
    setSongOptions,
    scoresDialog,
    setScoresDialog,
    meterDialog,
    setMeterDialog,
    handsDialog,
    setHandsDialog,
  } = editors;
  return (
    <>
      {" "}
      {songOptions && song && (
        <SongOptionsDialog close={() => setSongOptions(false)}>
          {song && (
            <PracticeVariantPanel
              song={song}
              disabled={disabled}
              apply={applyVariant}
            />
          )}
          {song && (
            <SongEditionBar
              song={song}
              active={songOptions}
              disabled={disabled}
              execute={execute}
              openPerformance={openPerformance}
              manage={() => setScoresDialog(true)}
            />
          )}
        </SongOptionsDialog>
      )}
      {scoresDialog && song && (
        <ScoresDialog
          workspace={scoreWorkspace}
          configureDuet={configureDuet}
          song={song}
          openPractice={openScorePractice}
          close={() => {
            setScoresDialog(false);
            paperChanged();
          }}
          changed={() => changed("scores")}
        />
      )}
      {meterDialog && song && (
        <MeterDialog
          song={song}
          close={() => setMeterDialog(false)}
          changed={() => changed("meter")}
        />
      )}
      {handsDialog && song && (
        <HandsDialog
          song={song}
          start={loopStart}
          end={loopEnd}
          close={() => setHandsDialog(false)}
          changed={() => changed("hands")}
        />
      )}
    </>
  );
}
