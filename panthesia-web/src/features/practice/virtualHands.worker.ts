import { planHands } from "./virtualHandPlan";
import type { LoadedSong } from "../../engine/sessionTypes";
self.onmessage = (event: MessageEvent<{
    notes: LoadedSong["notes"];
    actions: LoadedSong["fingerActions"];
    rate: number;
    sustain?: LoadedSong["sustain"];
}>) => {
    const { notes, actions, rate, sustain } = event.data;
    self.postMessage(planHands(notes, actions, rate, sustain ?? []));
};
