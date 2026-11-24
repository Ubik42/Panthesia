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
        missing += playable(hand, rate);
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

/** Widest chord one hand holds at once, in semitones (a ninth; the hands reach about a tenth). */
const HAND_SPAN = 14;
/** Delay between the parts of a rolled chord, in song seconds at normal speed. */
const ROLL_STEP = 0.07;

/** What one hand can actually do with each chord (as a pianist would; the sound is unchanged):
 * one key per finger at a time, and a chord wider than the hand rolled from the bottom up,
 * each part let go (the pedal keeps it) when the hand moves on. Returns the notes dropped. */
function playable(hand: HandTrack, rate: number): number {
    let dropped = 0;
    const keep: Contact[] = [];
    for (let i = 0; i < hand.notes.length; ) {
        let j = i + 1;
        while (j < hand.notes.length && hand.notes[j].start - hand.notes[i].start < 0.03) j++;
        const group = hand.notes.slice(i, j);
        i = j;
        // One key per finger: keep the outer notes of the chord first (they shape the hand).
        const byFinger = new Map<number, Contact>();
        const order = [...group].sort((a, b) => Math.abs(b.pitch - group[0].pitch) - Math.abs(a.pitch - group[0].pitch));
        for (const c of order) if (!byFinger.has(c.finger)) byFinger.set(c.finger, c);
        dropped += group.length - byFinger.size;
        const chord = [...byFinger.values()].sort((a, b) => a.pitch - b.pitch);
        // Parts of at most a hand's span, from the bottom.
        let part = 0,
            low = chord[0]?.pitch ?? 0;
        const parts: Contact[][] = [[]];
        for (const c of chord) {
            if (c.pitch - low > HAND_SPAN) {
                parts.push([]);
                part++;
                low = c.pitch;
            }
            parts[part].push(c);
        }
        parts.forEach((members, k) => {
            const start = members[0].start + k * ROLL_STEP * rate;
            const next = k + 1 < parts.length ? members[0].start + (k + 1) * ROLL_STEP * rate : Infinity;
            for (const c of members) {
                c.start = start;
                // Released as the hand moves to the next part.
                c.end = Math.max(start + 0.03 * rate, Math.min(c.end, next - 0.01 * rate));
                keep.push(c);
            }
        });
    }
    keep.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    hand.notes = keep;
    const kept = new Set(keep);
    for (let f = 0; f < 5; f++) hand.fingers[f] = hand.fingers[f].filter((c) => kept.has(c)).sort((a, b) => a.start - b.start);
    return dropped;
}
