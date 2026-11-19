import { test, expect } from "@playwright/test";
import { emptyState } from "../src/api";
import { createPlaybackStore } from "../src/features/practice/playbackStore";

test("播放进度和按键变化保持控制状态稳定，成绩订阅只接收成绩变化", () => {
  const store = createPlaybackStore(structuredClone(emptyState));
  const original = store.getControls();
  const score = store.select(["score"]);
  const initialScore = score();
  store.update((state) => ({
    ...state,
    position: 2,
    practiceMs: 2000,
    measure: 2,
    pressed: [60],
  }));
  expect(store.getControls()).toBe(original);
  expect(score()).toBe(initialScore);
  store.update((state) => ({
    ...state,
    score: { ...state.score, matched_notes: 1 },
  }));
  expect(score()).not.toBe(initialScore);
  expect(score().score.matched_notes).toBe(1);
  expect(store.getControls()).toBe(original);
  store.update((state) => ({ ...state, speed: 0.75 }));
  expect(store.getControls()).not.toBe(original);
  expect(store.getControls().speed).toBe(0.75);
});

test("相同网络快照不重复通知，取消订阅后停止通知", () => {
  const store = createPlaybackStore(structuredClone(emptyState));
  let calls = 0;
  const unsubscribe = store.subscribe(() => {
    calls++;
  });
  const initial = store.getSnapshot();
  store.update(structuredClone(initial));
  expect(store.getSnapshot()).toBe(initial);
  expect(calls).toBe(0);
  store.update({ ...initial, pedal: 127 });
  expect(calls).toBe(1);
  unsubscribe();
  store.update({ ...initial, pedal: 0 });
  expect(calls).toBe(1);
});

test("曲目和完成结果保留在控制状态，独立会话不共享快照", () => {
  const store = createPlaybackStore(structuredClone(emptyState));
  const other = createPlaybackStore(structuredClone(emptyState));
  const before = store.getControls();
  store.update((state) => ({
    ...state,
    contentId: "song-b",
    status: "finished",
    saved: true,
    currentHistoryId: "take-b",
  }));
  expect(store.getControls()).not.toBe(before);
  expect(store.getControls()).toMatchObject({
    contentId: "song-b",
    status: "finished",
    saved: true,
    currentHistoryId: "take-b",
  });
  expect(other.getSnapshot()).toEqual(emptyState);
});
