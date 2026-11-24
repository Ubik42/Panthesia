import { createPersistentSession } from "../../lib/createPersistentSession";
import { api, type LoadedSong, type MeterMap } from "../../api";
import { capturePracticeScope } from "../../engine/useCatalogRead";
import { practiceScopeKey } from "./practiceEditorStore";
import {
  meterForm,
  meterFromSong,
  nativeMeterValue,
  meterValueKey,
  meterFormKey,
  type MeterForm,
} from "./meterEditorModel";
import { activitySignal } from "../activity/activitySignal";
interface State {
  version: 1;
  contentId: string;
  title: string;
  path: string;
  source: string;
  form: MeterForm;
  baseForm: string;
  baseNative: string;
  mode: "custom" | "original";
  receipt: {
    phase: "sending" | "acknowledged" | "uncertain";
    value: string;
  } | null;
  section: "signature" | "lengths" | "preview";
  segmentPage: number;
  lengthPage: number;
  page: number;
  jump: string;
  busy: boolean;
  storageError: string;
  notice: string;
}
const slots = new Map<string, ReturnType<typeof createSession>>();
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 512): value is string =>
  typeof value === "string" && value.length <= max;
const validForm = (value: unknown): value is MeterForm =>
  object(value) &&
  text(value.pickup) &&
  Array.isArray(value.segments) &&
  value.segments.length > 0 &&
  value.segments.length <= 1024 &&
  value.segments.every(
    (row) =>
      object(row) &&
      [row.key, row.measure, row.numerator, row.denominator, row.display].every(
        (item) => text(item),
      ),
  ) &&
  Array.isArray(value.lengths) &&
  value.lengths.length <= 1024 &&
  value.lengths.every(
    (row) =>
      object(row) &&
      [row.key, row.measure, row.beats].every((item) => text(item)),
  );
export const meterDraftDirty = (state: State) =>
  state.mode === "original"
    ? state.baseNative !== "null"
    : meterFormKey(state.form) !== state.baseForm;
export const meterHasInput = (state: State) =>
  meterDraftDirty(state) || meterFormKey(state.form) !== state.baseForm;
function createSession(song: LoadedSong) {
  const source = practiceScopeKey(song),
    form = meterForm(meterFromSong(song), song.ppq);
  const session = createPersistentSession<State>(
    (raw) => {
      const initial: State = {
        version: 1,
        contentId: song.contentId,
        title: song.title,
        path: song.sourcePath,
        source,
        form,
        baseForm: meterFormKey(form),
        baseNative: meterValueKey(nativeMeterValue(song)),
        mode: "custom",
        receipt: null,
        section: "signature",
        segmentPage: 0,
        lengthPage: 0,
        page: 0,
        jump: "1",
        busy: false,
        storageError: "",
        notice: "",
      };
      if (raw === null) return initial;
      try {
        if (raw.length > 1_500_000)
          throw new Error("小节输入超过读取容量，原文已保留。");
        const value: unknown = JSON.parse(raw);
        if (
          !object(value) ||
          value.version !== 1 ||
          value.contentId !== song.contentId ||
          !text(value.title, 1024) ||
          !text(value.path, 65536) ||
          !text(value.source) ||
          !validForm(value.form) ||
          !text(value.baseForm, 400000) ||
          !text(value.baseNative, 400000) ||
          !["custom", "original"].includes(String(value.mode)) ||
          !["signature", "lengths", "preview"].includes(
            String(value.section),
          ) ||
          ![value.page, value.segmentPage, value.lengthPage].every(
            (item) =>
              Number.isSafeInteger(item) &&
              Number(item) >= 0 &&
              Number(item) <= 50000,
          ) ||
          !text(value.jump) ||
          (value.receipt !== null &&
            (!object(value.receipt) ||
              !["sending", "acknowledged", "uncertain"].includes(
                String(value.receipt.phase),
              ) ||
              !text(value.receipt.value, 400000)))
        )
          throw new Error("小节草稿格式无法读取，原文已保留。");
        const receipt = value.receipt as State["receipt"];
        return {
          ...initial,
          title: value.title,
          path: value.path,
          source: value.source,
          form: value.form,
          baseForm: value.baseForm,
          baseNative: value.baseNative,
          mode: value.mode as State["mode"],
          section: value.section as State["section"],
          page: Number(value.page),
          segmentPage: Number(value.segmentPage),
          lengthPage: Number(value.lengthPage),
          jump: value.jump,
          receipt: receipt
            ? {
                ...receipt,
                phase:
                  receipt.phase === "sending" ? "uncertain" : receipt.phase,
              }
            : null,
        };
      } catch (error) {
        return {
          ...initial,
          storageError: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      key: `panthesia.meter-editor.v1:${song.contentId}`,
      maxCharacters: 1_500_000,
      failureMessage: "小节草稿尚未暂存，请复制输入或保留窗口。",
    },
  );
  let subscribers = 0;
  const release = session.subscribe(activitySignal.changed);
  const check = () => {
    const state = session.getSnapshot();
    if (state.busy || state.receipt)
      throw new Error("请先读取上一次保存结果。");
  };
  return {
    ...session,
    dispose: release,
    unused: () =>
      !subscribers &&
      !session.getSnapshot().storageError &&
      !session.getSnapshot().receipt &&
      !session.getSnapshot().busy,
    subscribe(listener: () => void) {
      subscribers++;
      const stop = session.subscribe(listener);
      return () => {
        subscribers--;
        stop();
      };
    },
    edit(form: MeterForm) {
      check();
      session.update({ form, mode: "custom", notice: "" });
    },
    adopt(current: LoadedSong, keep = false) {
      if (current.contentId !== song.contentId)
        throw new Error("曲目已切换，请返回原曲目。");
      const form = meterForm(meterFromSong(current), current.ppq),
        state = session.getSnapshot();
      session.update({
        title: current.title,
        path: current.sourcePath,
        source: practiceScopeKey(current),
        baseNative: meterValueKey(nativeMeterValue(current)),
        baseForm: meterFormKey(form),
        form: keep ? state.form : form,
        mode: keep ? state.mode : "custom",
        receipt: null,
        notice: keep
          ? "已保留输入，请重新预览后保存。"
          : "已读取当前小节网格。",
      });
    },
    async save(current: LoadedSong, value: MeterMap | null, proof: string) {
      check();
      const state = session.getSnapshot();
      if (state.source !== practiceScopeKey(current))
        throw new Error("曲目或网格已变化，请先核对草稿。");
      const receipt: NonNullable<State["receipt"]> = {
        phase: "sending",
        value: meterValueKey(value),
      };
      session.update({ receipt, busy: true });
      if (session.getSnapshot().storageError) {
        session.update({ receipt: null, busy: false });
        throw new Error("保存内容尚未暂存，请先处理暂存问题。");
      }
      try {
        await api.editPractice(capturePracticeScope(current), {
          type: "saveMeterMap",
          content_id: current.contentId,
          value,
          proof,
        });
        session.update({
          receipt: { ...receipt, phase: "acknowledged" },
          notice: "网格保存回复已收到，请读取当前结果。",
        });
      } catch (error) {
        session.update({ receipt: { ...receipt, phase: "uncertain" } });
        throw error;
      } finally {
        session.update({ busy: false });
      }
    },
  };
}
export function getMeterEditor(song: LoadedSong) {
  let slot = slots.get(song.contentId);
  if (!slot) {
    if (slots.size >= 16)
      for (const [key, candidate] of slots)
        if (candidate.unused()) {
          candidate.dispose();
          slots.delete(key);
          break;
        }
    slot = createSession(song);
    slots.set(song.contentId, slot);
    activitySignal.changed();
  }
  return slot;
}
export const meterEditorSessions = () =>
  [...slots.entries()].map(([key, store]) => ({
    key,
    store,
    state: store.getSnapshot(),
  }));
export const flushMeterEditors = () => {
  for (const slot of slots.values()) slot.retrySave();
};
export const pendingMeterEditors = () => {
  for (const slot of slots.values()) {
    const state = slot.getSnapshot();
    if (state.busy) return "小节网格仍在保存，请等待结束。";
    if (state.storageError && (meterHasInput(state) || state.receipt))
      return state.storageError;
  }
  return null;
};
