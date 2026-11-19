import { api, type PracticeEditScope } from "../api";
import type { PlanRequest, PlanResult, HeldPlanResult, CommandOf, AcceptanceReview, PairReview, PairPart, PairSaved } from "./commands.generated";

// Response types come from the Rust structures actually serialized by these commands.
export const fingeringApi = {
  review: (song: PracticeEditScope, input: Omit<CommandOf<"reviewFingerAcceptance">, "type">): Promise<AcceptanceReview> =>
    api.readPractice<AcceptanceReview>(song, { type: "reviewFingerAcceptance", ...input }),
  acceptPair: (song: PracticeEditScope, selection: PairSelection): Promise<PairSaved> =>
    api.editPractice<PairSaved>(song, { type: "fingerPair", ...selection }),
  reviewPair: (song: PracticeEditScope, parts: PairPart[]): Promise<PairReview> =>
    api.readPractice<PairReview>(song, { type: "fingerPair", parts, proof: null, acknowledged: false }),
  plans: (song: PracticeEditScope, request: PlanRequest): Promise<PlanResult> =>
    api.readPractice<PlanResult>(song, { type: "suggestFingerPlans", request }),
  heldPlans: (song: PracticeEditScope, request: PlanRequest): Promise<HeldPlanResult> =>
    api.readPractice<HeldPlanResult>(song, { type: "suggestHeldFingerPlans", request }),
};

export type PairSelection = Pick<CommandOf<"startPairFingerDemo">, "parts" | "proof" | "acknowledged">;
