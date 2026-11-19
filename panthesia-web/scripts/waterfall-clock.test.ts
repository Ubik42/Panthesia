import { test } from "node:test";
import assert from "node:assert/strict";
import { WaterfallClock } from "../src/features/practice/waterfallClock.ts";

const frame = (position: number, patch: Record<string, unknown> = {}) => ({
  position,
  status: "playing",
  wait: false,
  required: [60],
  speed: 1,
  duration: 120,
  noteEpoch: 1,
  ...patch,
});

test("continuous practice animates between 80ms snapshots even with pending judgements", () => {
  const clock = new WaterfallClock();
  clock.update(frame(10), "song", 0);
  let previous = 10;
  for (let i = 1; i <= 60; i++) {
    const now = (i * 1000) / 60;
    if (i % 5 === 0) clock.update(frame(10 + now / 1000 - 0.008), "song", now);
    const value = clock.sample(now);
    assert(value > previous, "every display frame must advance");
    assert(value - previous < 0.025);
    previous = value;
  }
});
test("transport jitter and repeated snapshots do not move notes backwards", () => {
  const clock = new WaterfallClock();
  clock.update(frame(20), "song", 0);
  let previous = 20;
  for (let i = 1; i < 120; i++) {
    const now = (i * 1000) / 60;
    if (i % 5 === 0)
      clock.update(
        frame(20 + now / 1000 - (i % 10 === 0 ? 0.025 : 0)),
        "song",
        now,
      );
    const value = clock.sample(now);
    assert(value >= previous);
    previous = value;
  }
});
test("waiting freezes exactly at the target, then resumes without a visual jump", () => {
  const clock = new WaterfallClock();
  clock.update(frame(3, { wait: true }), "song", 0);
  assert.equal(clock.sample(1000), 3);
  clock.update(frame(3, { wait: true, required: [] }), "song", 1000);
  const value = clock.sample(1016);
  assert(value > 3 && value < 3.025);
  clock.update(frame(3.1, { wait: true }), "song", 1100);
  assert.equal(clock.sample(2000), 3.1);
});
test("seek, loop and pause retain the engine position; stale data has bounded lead", () => {
  const clock = new WaterfallClock();
  clock.update(frame(8), "song", 0);
  assert(clock.sample(1000) <= 8.12);
  clock.update(frame(2, { noteEpoch: 2 }), "song", 1000);
  assert.equal(clock.sample(1000), 2);
  clock.update(frame(1), "song", 1100);
  assert.equal(clock.sample(1100), 1);
  clock.update(frame(1.05, { status: "paused" }), "song", 1200);
  assert.equal(clock.sample(5000), 1.05);
});

test("returning from a hidden window catches up to the current song, rather than replaying stale visuals", () => {
  const clock = new WaterfallClock();
  clock.update(frame(1), "song", 0);
  clock.sample(16);
  for (let time = 80; time <= 10000; time += 80)
    clock.update(frame(1 + time / 1000), "song", time);
  const value = clock.sample(10016);
  assert(value >= 11 && value < 11.12);
  clock.update(frame(11.04, { speed: 0.5 }), "song", 10040);
  assert(clock.sample(10048) >= value);
});
