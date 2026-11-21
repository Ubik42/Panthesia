import { planHands } from "./virtualHandPlan";
import type { LoadedSong } from "../../engine/sessionTypes";
self.onmessage = (event: MessageEvent<{
    notes: LoadedSong["notes"];
    actions: LoadedSong["fingerActions"];
    rate: number;
}>) => {
    const { notes, actions, rate } = event.data;
    self.postMessage(planHands(notes, actions, rate));
};
