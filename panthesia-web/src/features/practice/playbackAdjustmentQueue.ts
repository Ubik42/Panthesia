import type { Snapshot } from "../../api";
import {
  capturePlaybackSource,
  samePlaybackSource,
  type PlaybackAdjustmentCommand,
  type PlaybackAdjustmentSource,
} from "./playbackCommands";

type Pending = {
  command: PlaybackAdjustmentCommand;
  source: PlaybackAdjustmentSource;
  createdAtMs: number;
  generation: number;
  resolve: (state: Snapshot | null) => void;
  reject: (error: unknown) => void;
};

/** Realtime controls serialize independently of file/edit operations. Pending gestures coalesce. */
export class PlaybackAdjustmentQueue {
  private pending = new Map<string, Pending>();
  private running = false;
  private generation = 0;
  constructor(
    private read: () => Snapshot,
    private send: (
      source: PlaybackAdjustmentSource,
      command: PlaybackAdjustmentCommand,
      createdAtMs: number,
    ) => Promise<Snapshot>,
  ) {}
  enqueue(
    command: PlaybackAdjustmentCommand,
    createdAtMs = Date.now(),
  ): Promise<Snapshot | null> {
    const source = capturePlaybackSource(this.read());
    return new Promise((resolve, reject) => {
      this.pending.get(command.type)?.resolve(null);
      this.pending.set(command.type, {
        command,
        source,
        createdAtMs,
        generation: this.generation,
        resolve,
        reject,
      });
      void this.drain();
    });
  }
  cancel() {
    this.generation++;
    for (const item of this.pending.values()) item.resolve(null);
    this.pending.clear();
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.size) {
        const [key, item] = this.pending.entries().next().value!;
        this.pending.delete(key);
        if (
          item.generation !== this.generation ||
          !samePlaybackSource(item.source, this.read())
        ) {
          item.resolve(null);
          continue;
        }
        try {
          const result = await this.send(
            item.source,
            item.command,
            item.createdAtMs,
          );
          item.resolve(
            item.generation === this.generation &&
              samePlaybackSource(item.source, this.read()) &&
              samePlaybackSource(item.source, result)
              ? result
              : null,
          );
        } catch (error) {
          if (
            item.generation === this.generation &&
            samePlaybackSource(item.source, this.read())
          )
            item.reject(error);
          else item.resolve(null);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
