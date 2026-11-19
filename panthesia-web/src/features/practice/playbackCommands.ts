import type { EngineCommand } from "../../engine/commands.generated";
import type { Snapshot } from "../../api";

const commands = [
  "play",
  "restart",
  "seek",
  "seekMeasure",
  "seekBeat",
  "stepBeat",
  "speed",
  "volume",
  "metronome",
  "loop",
  "mode",
  "measureLoop",
  "track",
] as const satisfies readonly EngineCommand["type"][];
export type PlaybackAdjustmentCommand = Extract<
  EngineCommand,
  { type: (typeof commands)[number] }
>;
export type PlaybackAdjustmentSource = Pick<
  Snapshot,
  "contentId" | "scoreRevision" | "stateOrder"
>;
const commandNames = new Set<string>(commands);
export const isPlaybackAdjustment = (
  command: EngineCommand,
): command is PlaybackAdjustmentCommand => commandNames.has(command.type);
export const capturePlaybackSource = (
  state: Snapshot,
): PlaybackAdjustmentSource => ({
  contentId: state.contentId,
  scoreRevision: state.scoreRevision,
  stateOrder: state.stateOrder,
});
export const samePlaybackSource = (
  left: PlaybackAdjustmentSource,
  right: PlaybackAdjustmentSource,
) =>
  left.contentId === right.contentId &&
  left.scoreRevision === right.scoreRevision &&
  left.stateOrder?.engineId === right.stateOrder?.engineId;
