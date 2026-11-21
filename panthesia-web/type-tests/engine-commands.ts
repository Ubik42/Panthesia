import type { EngineCommand, CommandOf } from "../src/engine/commands.generated";
declare const send: (command: EngineCommand) => void;

send({ type: "play" });
send({ type: "speed", value: 0.75 });
send({ type: "note", pitch: 60, active: true, velocity: 90 });
send({ type: "prepareMeasurePart", contentId: "song", measure: 1, part: "RightHand", trackId: 0 });
const open: CommandOf<"openFile"> = { type: "openFile", path: "song.mid" };
send(open);

// @ts-expect-error Unknown command names must fail at the caller.
send({ type: "paly" });
// @ts-expect-error Speed requires a numeric value.
send({ type: "speed", value: "0.75" });
// @ts-expect-error A UI-only alias must not replace the wire field name.
send({ type: "forgetRecentFile", filePath: "song.mid" });
// @ts-expect-error Required paths cannot be null.
send({ type: "openFile", path: null });

const exercise: CommandOf<"generate">["spec"] = {
  tonic: 0, tonality: "Major", pattern: "Scale", direction: "UpAndDown", hands: "Both", octaves: 1, tempo_bpm: 60,
};
send({ type: "generate", spec: exercise }); // Rust defaults allow omitted minor_form and repetitions.
send({ type: "trackSound", id: 1, sound: { volume: 100 } }); // Option fields can be omitted.
send({ type: "trackAppearance", id: 1, appearance: { color: null } });
send({ type: "applyHands", content_id: "song", hints: [{ track_id: 1, note_index: 0, part: "LeftHand" }], clear: [] });
send({ type: "saveMeterMap", content_id: "song", value: { pickup_ticks: 0, segments: [{ measure: 1, numerator: 3, denominator: 4 }] }, proof: "checked" });
// @ts-expect-error Exercise enum names must follow Rust serde exactly.
send({ type: "generate", spec: { ...exercise, hands: "left" } });
// @ts-expect-error Nested numeric fields cannot be text.
send({ type: "generate", spec: { ...exercise, tonic: "C" } });
// @ts-expect-error Required nested fields cannot be omitted.
send({ type: "generate", spec: { tonic: 0 } });
// @ts-expect-error Rust defaulted numbers accept omission, not null.
send({ type: "generate", spec: { ...exercise, repetitions: null } });
// @ts-expect-error UI inheritance is represented through clear, not a hand hint.
send({ type: "applyHands", content_id: "song", hints: [{ track_id: 1, note_index: 0, part: "Inherit" }], clear: [] });
// @ts-expect-error Numeric hand hints are not accepted.
send({ type: "applyHands", content_id: "song", hints: [{ track_id: 1, note_index: 0, part: 1 }], clear: [] });
// @ts-expect-error Sound settings retain their nested numeric contract.
send({ type: "trackSound", id: 1, sound: { volume: "100" } });
// @ts-expect-error The sound object requires a volume.
send({ type: "trackSound", id: 1, sound: {} });
// @ts-expect-error Appearance fields use their actual wire names.
send({ type: "trackAppearance", id: 1, appearance: { label: "左手" } });
// @ts-expect-error Hand spans use the Rust profile enum.
send({ type: "handSpan", track: 1, hand: "LeftHand", profile: "Small" });
// @ts-expect-error Meter segments require numeric time signatures.
send({ type: "saveMeterMap", content_id: "song", value: { pickup_ticks: 0, segments: [{ measure: 1, numerator: "3", denominator: 4 }] }, proof: "checked" });

const planRequest: CommandOf<"suggestFingerPlans">["request"] = {
  content_id: "song", track: 1, index: 0, profile: "Standard", hand: "RightHand", keep_saved: true,
};
send({ type: "suggestFingerPlans", request: planRequest });
send({ type: "fingerPair", parts: [{ request: planRequest, fingerprint: "checked", edits: [{ track_id: 1, note_index: 0, finger: null }] }], proof: null, acknowledged: false });
send({ type: "acceptHeldFingerPlan", request: planRequest, fingerprint: "checked", edits: [], actions: [{ track: 1, index: 0, beforeTrack: 1, beforeIndex: 1, at: 0.5, from: 1, to: 2 }] });
// @ts-expect-error Plan requests require a stable song identity.
send({ type: "suggestFingerPlans", request: { track: 1, index: 0 } });
// @ts-expect-error Plan request profiles are enum values.
send({ type: "suggestFingerPlans", request: { ...planRequest, profile: "Small" } });
// @ts-expect-error Nested pins require a numeric finger.
send({ type: "suggestFingerPlans", request: { ...planRequest, pins: [{ index: 0, finger: "1" }] } });
// @ts-expect-error Practice ranges have exactly two numeric endpoints.
send({ type: "suggestFingerPlans", request: { ...planRequest, range: [1] } });
// @ts-expect-error Pair parts require a complete request and fingerprint.
send({ type: "fingerPair", parts: [{}], proof: null, acknowledged: false });
// @ts-expect-error Nullable finger edits accept null, not arbitrary text.
send({ type: "editFingersFor", content_id: "song", edits: [{ track_id: 1, note_index: 0, finger: "clear" }] });
// @ts-expect-error Held action edits require a baseline to prevent stale writes.
send({ type: "reviewHeldActionEdit", request: { contentId: "song", track: 1, index: 0, originalTick: 1, atTick: 2, to: 2, rate: 1 } });
// @ts-expect-error Held action inputs follow camelCase wire names.
send({ type: "acceptHeldFingerPlan", request: planRequest, fingerprint: "checked", edits: [], actions: [{ track: 1, index: 0, before_track: 1, beforeIndex: 1, at: 0.5, from: 1, to: 2 }] });
declare const planResponse: import("../src/engine/commands.generated").PlanResult;
const knownSavedFinger: number | null = planResponse.context[0].saved;
planResponse.plans[0].oppositeContextFingers = [null, 1];
// @ts-expect-error Current-hand plan fingers are always numbers.
planResponse.plans[0].contextFingers = [null];
// @ts-expect-error A returned nullable finger is not optional.
const absentFinger: undefined = planResponse.context[0].saved;
// @ts-expect-error Output positions always include their saved finger, even when null.
const incompletePosition: import("../src/engine/commands.generated").Position = { track: 1, index: 0, pitch: 60, measure: 1, target: true, onset: 0, end: 1 };
void knownSavedFinger;

declare const acceptance: import("../src/engine/commands.generated").AcceptanceReview;
declare const pairReview: import("../src/engine/commands.generated").PairReview;
const nullableNeighbor: import("../src/engine/commands.generated").CoverageNote["before"] = null;
const definiteCount: number = acceptance.tracks[0].new;
const knownKind: "sameKeyHandoff" | "crossedRange" = pairReview.interactions.items[0].kind;
// @ts-expect-error Review flags are boolean values from the engine.
acceptance.valid = "yes";
// @ts-expect-error Unmarked positions preserve explicit nulls.
acceptance.contextFingers = [undefined];
// @ts-expect-error Coverage neighbors include note identity and a known finger.
acceptance.coverage[0].before = {};
// @ts-expect-error Nullable output neighbor fields remain required.
const missingNeighbors: import("../src/engine/commands.generated").CoverageNote = { track: 1, index: 0, measure: 1, pitch: 60, contextIndex: 0, target: true };
// @ts-expect-error The serialized track count is named new.
acceptance.tracks[0].newMarks;
// @ts-expect-error Interaction kinds match the Rust enum.
pairReview.interactions.items[0].kind = "sameKey";
// @ts-expect-error Accepted motion reviews do not claim plan-only source indexes.
acceptance.review[0].fromIndex;
void nullableNeighbor; void definiteCount; void knownKind;

// @ts-expect-error The save facade's pair selection requires a concrete proof.
const missingSaveProof: Pick<CommandOf<"startPairFingerDemo">, "parts" | "proof" | "acknowledged"> = { parts: [], proof: undefined, acknowledged: false };

declare const demoState: import("../src/engine/commands.generated").DemoState;
const idleDemo: import("../src/engine/commands.generated").DemoState = { id: null, active: false };
const loopOrAbsent: import("../src/engine/commands.generated").DemoState["loop"] = null;
// @ts-expect-error Skipped outer Options are omitted, not serialized as null.
demoState.position = null;
// @ts-expect-error Playback states always declare their active flag.
const missingActive: import("../src/engine/commands.generated").DemoState = { id: null };
// @ts-expect-error The held playback kind follows the wire enum.
demoState.kind = "substitution";
// @ts-expect-error A finger note has an explicit nullable finger.
const missingFinger: import("../src/engine/commands.generated").DemoFingerNote = { track: 1, index: 0, pitch: 60, part: "right", held: true, changed: false };
void idleDemo; void loopOrAbsent;
