import type { LoadedSong } from "../../engine/sessionTypes";
import type { HandPlan } from "./virtualHandPlan";
import { handPose, arrangeHands, type HandPose } from "./virtualHandPose";
import { HandDrawing } from "./virtualHandDrawing";
import { reportDiagnostic } from "../../app/diagnostics";
/** Read-only overlay. The Rust playback clock owns all musical state. */
export class VirtualHands {
    private song: LoadedSong | null = null;
    private rate = 0;
    private worker: Worker | null = null;
    private plan: HandPlan | null = null;
    private generation = 0;
    private drawing: HandDrawing;
    private disposed = false;
    constructor(private canvas: HTMLCanvasElement, private wake: () => void) {
        this.drawing = new HandDrawing(canvas);
    }
    dispose() {
        this.disposed = true;
        this.clear();
        this.drawing?.dispose();
    }
    configure(song: LoadedSong | null, rate: number, enabled: boolean) {
        if (this.disposed) return;
        if (!enabled || !song) {
            if (this.song || this.worker) {
                this.clear();
            }
            return;
        }
        if (this.song === song && this.rate === rate)
            return;
        this.clear();
        this.song = song;
        this.rate = rate;
        const generation = this.generation;
        try {
            const worker = new Worker(new URL("./virtualHands.worker.ts", import.meta.url), { type: "module" });
            this.worker = worker;
            worker.onmessage = (event: MessageEvent<HandPlan>) => {
                if (generation !== this.generation)
                    return;
                this.plan = event.data;
                worker.terminate();
                this.worker = null;
                this.wake();
            };
            worker.onerror = (event) => {
                if (this.worker !== worker)
                    return;
                reportDiagnostic("双手动作准备", event.message);
                worker.terminate();
                if (this.worker === worker)
                    this.worker = null;
            };
            worker.postMessage({
                notes: song.notes,
                actions: song.fingerActions,
                rate,
            });
        }
        catch (error) {
            this.worker?.terminate();
            this.worker = null;
            reportDiagnostic("双手动作准备", error);
        }
    }
    clear() {
        this.drawing?.hide();
        this.generation++;
        this.worker?.terminate();
        this.worker = null;
        this.plan = null;
        this.song = null;
        this.rate = 0;
    }
    paint(time: number, baseline: number, height: number, width: number, geometry: (pitch: number) => {
        x: number;
        w: number;
    } | undefined, opacity: number) {
        const plan = this.plan;
        if (!plan) {
            this.drawing?.hide();
            return {
                hands: 0,
                thumbUnder: 0,
                substitution: 0,
                crossed: false,
                missing: 0,
            };
        }
        const poses = plan.hands
            .map((track) => handPose(track, time, plan.rate, baseline, height, geometry))
            .filter((p): p is HandPose => !!p);
        const crossed = poses.length === 2 && poses[0].wrist.x > poses[1].wrist.x;
        const ordered = arrangeHands(poses);
        this.drawing?.draw(ordered, width, baseline + height, baseline, opacity);
        return {
            hands: poses.length,
            thumbUnder: poses.filter((p) => p.thumbUnder).length,
            substitution: poses
                .flatMap((p) => p.fingers)
                .filter((f) => f.substitution && f.pressed).length,
            crossed,
            missing: plan.missing,
        };
    }
    get ready() {
        return !!this.plan;
    }
}
