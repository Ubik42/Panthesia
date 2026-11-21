import { api, type PracticeEditScope, type PracticeDemoCommand } from "../api";
import type { CommandOf, DemoState, HeldContext } from "./commands.generated";
export type LiveDemoState = DemoState & Required<Pick<DemoState,
  "position" | "start" | "end" | "rate" | "paused" | "history" | "loop" | "loopRounds">> & { id: string };
export function isLiveDemo(state: DemoState): state is LiveDemoState {
  return typeof state.id === "string" && state.id.length > 0 &&
    typeof state.position === "number" && Number.isFinite(state.position) &&
    typeof state.start === "number" && Number.isFinite(state.start) &&
    typeof state.end === "number" && Number.isFinite(state.end) &&
    typeof state.rate === "number" && Number.isFinite(state.rate) &&
    typeof state.paused === "boolean" && typeof state.history === "boolean" &&
    state.loop !== undefined && typeof state.loopRounds === "number";
}
export const demoApi = {
  state: (): Promise<DemoState> => api.command<DemoState>({ type: "fingerDemoState" }),
  start: (song: PracticeEditScope, command: PracticeDemoCommand, requestId: string): Promise<DemoState> => api.startPracticeDemo<DemoState>(song, command, requestId),
  control: (input: Omit<CommandOf<"fingerDemoControl">, "type">): Promise<DemoState> => api.command<DemoState>({ type: "fingerDemoControl", ...input }),
  heldContext: (song: PracticeEditScope, input: Omit<CommandOf<"heldFingerDemoContext">, "type">): Promise<HeldContext> => api.readPractice<HeldContext>(song, { type: "heldFingerDemoContext", ...input }),
};
