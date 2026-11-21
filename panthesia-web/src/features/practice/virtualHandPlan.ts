import type { LoadedSong } from "../../engine/sessionTypes";
export type Contact = {
    start: number;
    end: number;
    pitch: number;
    finger: number;
    velocity: number;
    key: string;
    substitution: boolean;
};
export type HandTrack = {
    side: "left" | "right";
    fingers: Contact[][];
    notes: Contact[];
    crossings: {
        start: number;
        end: number;
    }[];
};
export type HandPlan = {
    hands: HandTrack[];
    missing: number;
    conflicts: number;
    rate: number;
};
/** Independent read-only motion plan from Panthesia annotations. No inferred hand/finger assignments. */
export function planHands(notes: LoadedSong["notes"], actions: LoadedSong["fingerActions"], rate: number): HandPlan {
    const byNote = new Map<string, NonNullable<LoadedSong["fingerActions"]>>();
    for (const action of actions ?? []) {
        if (!action.valid || Math.abs(action.validationRate - rate) > 0.0001)
            continue;
        const key = `${action.track}:${action.index}`, rows = byNote.get(key) ?? [];
        rows.push(action);
        byNote.set(key, rows);
    }
    for (const rows of byNote.values())
        rows.sort((a, b) => a.at - b.at);
    const hands: HandTrack[] = ["left", "right"].map((side) => ({
        side: side as "left" | "right",
        fingers: Array.from({ length: 5 }, () => []),
        notes: [],
        crossings: [],
    }));
    let missing = 0, conflicts = 0;
    for (const note of notes) {
        if (note.part !== "left" && note.part !== "right")
            continue;
        const hand = hands[note.part === "left" ? 0 : 1], key = `${note.track}:${note.index}`, changes = byNote.get(key) ?? [];
        let finger = note.finger ?? changes[0]?.from, start = note.start, substitution = false;
        const end = note.start + note.duration;
        if (!finger || finger < 1 || finger > 5) {
            missing++;
            continue;
        }
        const append = (finish: number) => {
            if (finish <= start)
                return;
            const c = {
                start,
                end: finish,
                pitch: note.pitch,
                finger: finger!,
                velocity: note.velocity,
                key,
                substitution,
            };
            hand.fingers[finger! - 1].push(c);
            hand.notes.push(c);
        };
        for (const action of changes) {
            if (action.at <= start ||
                action.at >= end ||
                action.from !== finger ||
                action.to < 1 ||
                action.to > 5)
                continue;
            append(action.at);
            start = action.at;
            finger = action.to;
            substitution = true;
        }
        append(end);
    }
    for (const hand of hands) {
        hand.notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
        for (const contacts of hand.fingers) {
            contacts.sort((a, b) => a.start - b.start);
            for (let i = 1; i < contacts.length; i++)
                if (contacts[i - 1].end > contacts[i].start + 0.01)
                    conflicts++;
        }
        const sign = hand.side === "right" ? 1 : -1;
        for (let i = 1; i < hand.notes.length; i++) {
            const a = hand.notes[i - 1], b = hand.notes[i], up = (b.pitch - a.pitch) * sign;
            if (b.start - a.start > 0.7 * rate || b.start === a.start)
                continue;
            if ((a.finger > 1 && b.finger === 1 && up > 0) ||
                (a.finger === 1 && b.finger > 1 && up < 0))
                hand.crossings.push({
                    start: b.start - 0.24 * rate,
                    end: b.start + 0.14 * rate,
                });
        }
    }
    return { hands, missing, conflicts, rate };
}
