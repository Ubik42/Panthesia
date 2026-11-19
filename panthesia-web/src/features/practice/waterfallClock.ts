import type { Snapshot } from "../../engine/sessionTypes";

type Frame = Pick<
  Snapshot,
  | "position"
  | "status"
  | "wait"
  | "required"
  | "speed"
  | "duration"
  | "noteEpoch"
> & { passage?: { end: number } | null };

/** Display-only clock. The engine remains authoritative for sound, waiting and scoring. */
export class WaterfallClock {
  private source = "";
  private epoch: number | undefined;
  private frame: Frame | undefined;
  private received = 0;
  private drawnAt = 0;
  private position = 0;

  update(frame: Frame, source: string, now: number) {
    const previous = this.frame;
    const elapsed = Math.max(0, (now - this.received) / 1000);
    const jump =
      previous &&
      (frame.position < previous.position - 0.001 ||
        frame.position - previous.position > elapsed * previous.speed + 0.25);
    const reset =
      !previous ||
      source !== this.source ||
      frame.noteEpoch !== this.epoch ||
      jump;
    const moving =
      frame.status === "playing" && !(frame.wait && frame.required.length > 0);
    if (reset || !moving || !this.moving) {
      this.position = frame.position;
      this.drawnAt = now;
    }
    // Repeated copies of the same backend position must not restart extrapolation.
    if (
      reset ||
      !previous ||
      frame.position !== previous.position ||
      moving !== this.moving ||
      frame.speed !== previous.speed
    )
      this.received = now;
    this.frame = frame;
    this.source = source;
    this.epoch = frame.noteEpoch;
  }

  get moving() {
    return (
      !!this.frame &&
      this.frame.status === "playing" &&
      !(this.frame.wait && this.frame.required.length > 0)
    );
  }

  synchronize(now: number) {
    if (!this.frame) return;
    this.position =
      this.frame.position +
      (this.moving
        ? Math.min(0.12, Math.max(0, (now - this.received) / 1000)) *
          this.frame.speed
        : 0);
    this.position = Math.min(
      this.position,
      this.frame.duration || Infinity,
      this.frame.passage?.end ?? Infinity,
    );
    this.drawnAt = now;
  }

  sample(now: number) {
    const frame = this.frame;
    if (!frame) return 0;
    if (!this.moving) return frame.position;
    if (now - this.drawnAt > 500) {
      this.synchronize(now);
      return this.position;
    }
    const elapsed = Math.max(0, (now - this.drawnAt) / 1000);
    this.drawnAt = now;
    const lead = 0.12 * frame.speed;
    const target =
      frame.position +
      Math.min(0.12, Math.max(0, (now - this.received) / 1000)) * frame.speed;
    const advance = Math.min(0.12, elapsed) * frame.speed;
    const predicted = this.position + advance;
    // Correct small transport jitter gradually, without moving a falling note backwards.
    const adjustment = Math.max(
      -advance * 0.15,
      Math.min(
        advance * 0.15,
        (target - predicted) * Math.min(1, elapsed / 0.18),
      ),
    );
    this.position = Math.min(
      frame.duration || Infinity,
      frame.passage?.end ?? Infinity,
      Math.max(this.position, frame.position + lead),
      Math.max(this.position, predicted + adjustment),
    );
    return this.position;
  }
}
